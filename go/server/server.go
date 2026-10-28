package server

import (
	"compress/gzip"
	"compress/zlib"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	pathpkg "path"
	"strings"
	"sync"
	"time"

	"github.com/fastlink/fastlink/core"
	"github.com/fastlink/fastlink/proxy"
)

type Config struct {
	UpstreamOrigin   string
	EnableProxy      bool
	AutoInjectClient bool
	ScriptSrc        string
	AdminKey         string
}

type Server struct {
	config       Config
	policyEngine *core.RoutePolicyEngine
	rewriter     *proxy.HTMLRewriter
	clientJS     string
	telemetryMu  sync.RWMutex
	telemetryLog []TelemetryRecord
	eventMu      sync.RWMutex
	eventLog     []EventRecord
	recentEvents map[string]bool
	mux          *http.ServeMux
	proxyHandler http.Handler
}

type TelemetryRecord struct {
	SessionID           string `json:"session_id,omitempty"`
	SourcePath          string `json:"source_path"`
	DestinationPath     string `json:"destination_path"`
	PressDurationMS     int64  `json:"press_duration_ms"`
	NavigationLatencyMS int64  `json:"navigation_latency_ms,omitempty"`
	ClickSuppressed     bool   `json:"click_suppressed"`
	WasAborted          bool   `json:"was_aborted"`
	RecordedAt          string `json:"recorded_at"`
}

type EventRecord struct {
	EventID         string         `json:"event_id"`
	EventName       string         `json:"event_name"`
	TimestampMS     int64          `json:"timestamp_ms"`
	URL             string         `json:"url,omitempty"`
	Mode            string         `json:"mode,omitempty"`
	CTA             string         `json:"cta,omitempty"`
	PressDurationMS int64          `json:"press_duration_ms,omitempty"`
	WasAborted      bool           `json:"was_aborted,omitempty"`
	ClickSuppressed bool           `json:"click_suppressed,omitempty"`
	Prefetched      bool           `json:"prefetched,omitempty"`
	PrefetchMethod  string         `json:"prefetch_method,omitempty"`
	Verified        bool           `json:"verified,omitempty"`
	Properties      map[string]any `json:"properties,omitempty"`
}

type ResolveRequest struct {
	Context core.InteractionContext `json:"context"`
	Anchor  core.AnchorAttributes   `json:"anchor"`
}

type ResolveResponse struct {
	Eligible bool                        `json:"eligible"`
	Intent   *core.FastLinkIntent        `json:"intent,omitempty"`
	Decision core.FastNavigationDecision `json:"decision"`
	Reason   core.IneligibilityReason    `json:"reason,omitempty"`
}

func NewServer(cfg Config) (*Server, error) {
	if cfg.ScriptSrc == "" {
		cfg.ScriptSrc = "/fastlink.min.js"
	}
	if cfg.AdminKey == "" {
		cfg.AdminKey = os.Getenv("FASTLINK_ADMIN_KEY")
	}

	engine := core.NewRoutePolicyEngine(core.FastNavigationDecision{Kind: core.DecisionKindRouter})
	engine.AddRule(core.RoutePolicyRule{
		Pattern:  "/api/",
		Decision: core.FastNavigationDecision{Kind: core.DecisionKindDocument, DocumentMethod: core.DocumentMethodAssign},
		Priority: 100,
		IsPrefix: true,
	})

	rewriter := proxy.NewHTMLRewriter(proxy.RewriterOptions{
		Origin:           cfg.UpstreamOrigin,
		ScriptSrc:        cfg.ScriptSrc,
		AutoInjectScript: cfg.AutoInjectClient,
	})

	clientJSContent := ""
	if b, err := os.ReadFile("../client/fastlink.js"); err == nil {
		clientJSContent = string(b)
	} else if b, err := os.ReadFile("client/fastlink.js"); err == nil {
		clientJSContent = string(b)
	}

	s := &Server{
		config:       cfg,
		policyEngine: engine,
		rewriter:     rewriter,
		clientJS:     clientJSContent,
		telemetryLog: make([]TelemetryRecord, 0, 1000),
		eventLog:     make([]EventRecord, 0, 1000),
		recentEvents: make(map[string]bool),
		mux:          http.NewServeMux(),
	}

	if cfg.UpstreamOrigin != "" {
		targetURL, err := url.Parse(cfg.UpstreamOrigin)
		if err != nil {
			return nil, fmt.Errorf("invalid upstream origin: %w", err)
		}
		rp := httputil.NewSingleHostReverseProxy(targetURL)
		originalDirector := rp.Director
		rp.Director = func(req *http.Request) {
			originalDirector(req)
			req.Host = targetURL.Host
			// The proxy may rewrite HTML; avoid passing through browser-only encodings.
			req.Header.Set("Accept-Encoding", "gzip")
		}
		rp.ModifyResponse = func(resp *http.Response) error {
			contentType := resp.Header.Get("Content-Type")
			if strings.Contains(contentType, "text/html") && cfg.AutoInjectClient &&
				resp.StatusCode == http.StatusOK && resp.Request.Method != http.MethodHead {
				var reader io.ReadCloser = resp.Body
				switch strings.ToLower(resp.Header.Get("Content-Encoding")) {
				case "", "identity":
				case "gzip":
					gz, err := gzip.NewReader(resp.Body)
					if err != nil {
						return err
					}
					reader = gz
				case "deflate":
					zr, err := zlib.NewReader(resp.Body)
					if err != nil {
						return err
					}
					reader = zr
				default:
					return nil // Preserve unsupported encodings instead of corrupting HTML.
				}
				bodyBytes, err := io.ReadAll(reader)
				if reader != resp.Body {
					_ = reader.Close()
				}
				if err != nil {
					return err
				}
				_ = resp.Body.Close()
				rewritten := rewriter.Rewrite(string(bodyBytes))
				resp.Body = io.NopCloser(strings.NewReader(rewritten))
				resp.ContentLength = int64(len(rewritten))
				resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(rewritten)))
				resp.Header.Del("Content-Encoding")
				resp.Header.Del("ETag")
				resp.Header.Del("Content-MD5")
			}
			return nil
		}
		s.proxyHandler = rp
	}

	s.routes()
	return s, nil
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /fastlink.min.js", s.handleClientJS)
	s.mux.HandleFunc("POST /api/v1/resolve", s.handleResolve)
	s.mux.HandleFunc("GET /api/v1/prefetch", s.handlePrefetch)
	s.mux.HandleFunc("POST /api/v1/telemetry", s.handleTelemetry)
	s.mux.HandleFunc("POST /api/v1/events", s.handleEvents)
	s.mux.HandleFunc("POST /api/fastlink/events", s.handleEvents)
	s.mux.HandleFunc("POST /api/v1/policies", s.handleAddPolicy)
	s.mux.HandleFunc("GET /metrics", s.handleMetrics)
	s.mux.HandleFunc("/", s.handleFallback)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":  "healthy",
		"service": "fastlink-go",
		"version": "1.0.0",
	})
}

func (s *Server) handleClientJS(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(s.clientJS))
}

func (s *Server) handleResolve(w http.ResponseWriter, r *http.Request) {
	var req ResolveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON payload", http.StatusBadRequest)
		return
	}

	eligibility := core.ResolveFastLink(req.Context, req.Anchor)
	w.Header().Set("Content-Type", "application/json")

	if eligibility.Eligible {
		decision := s.policyEngine.Resolve(eligibility.Intent)
		_ = json.NewEncoder(w).Encode(ResolveResponse{
			Eligible: true,
			Intent:   eligibility.Intent,
			Decision: decision,
		})
	} else {
		_ = json.NewEncoder(w).Encode(ResolveResponse{
			Eligible: false,
			Decision: core.FastNavigationDecision{Kind: core.DecisionKindDocument, DocumentMethod: core.DocumentMethodAssign},
			Reason:   eligibility.Reason,
		})
	}
}

func (s *Server) handlePrefetch(w http.ResponseWriter, r *http.Request) {
	targetURLStr := r.URL.Query().Get("url")
	if targetURLStr == "" {
		http.Error(w, "missing 'url' parameter", http.StatusBadRequest)
		return
	}

	parsedURL, err := url.Parse(targetURLStr)
	if err != nil || (parsedURL.Scheme != "https" && parsedURL.Scheme != "http") || parsedURL.Host == "" {
		http.Error(w, "invalid 'url' parameter", http.StatusBadRequest)
		return
	}

	// Invariant: Reject sensitive mutation, admin, and logout routes
	path := pathpkg.Clean(parsedURL.Path)
	unsafeQuery := false
	for key := range parsedURL.Query() {
		switch strings.ToLower(key) {
		case "add-to-cart", "wc-ajax", "action", "logout", "_wpnonce", "remove_item":
			unsafeQuery = true
		}
	}
	if unsafeQuery || strings.HasPrefix(path, "/api/") ||
		strings.HasPrefix(path, "/auth/") ||
		strings.HasPrefix(path, "/admin") ||
		path == "/logout" {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-FastLink-Prefetch", "excluded")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"url":          targetURLStr,
			"status":       "excluded_sensitive_route",
			"prewarmed":    false,
			"timestamp_ms": time.Now().UnixMilli(),
		})
		return
	}

	// Attempt real prefetch if upstream is configured
	if s.config.UpstreamOrigin != "" {
		client := &http.Client{Timeout: 1500 * time.Millisecond}
		upstreamURL := strings.TrimRight(s.config.UpstreamOrigin, "/") + path
		upstreamReq, err := http.NewRequestWithContext(r.Context(), http.MethodGet, upstreamURL, nil)
		if err != nil {
			http.Error(w, "invalid upstream request", http.StatusBadGateway)
			return
		}
		resp, err := client.Do(upstreamReq)
		if err == nil {
			defer resp.Body.Close()
		}
		if r.Context().Err() != nil {
			http.Error(w, "request cancelled", http.StatusRequestTimeout)
			return
		}
		if err == nil {
			// Drain the small response when possible so keep-alive connections are reusable.
			_, _ = io.Copy(io.Discard, resp.Body)
		}
		if err == nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
			cc := resp.Header.Get("Cache-Control")
			if strings.Contains(cc, "no-store") || strings.Contains(cc, "private") {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("X-FastLink-Prefetch", "non-cacheable")
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"url":          targetURLStr,
					"status":       "non_cacheable",
					"prewarmed":    false,
					"timestamp_ms": time.Now().UnixMilli(),
				})
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "public, max-age=60")
			w.Header().Set("X-FastLink-Prefetch", "speculative-hit")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"url":          targetURLStr,
				"status":       "ready",
				"prewarmed":    true,
				"timestamp_ms": time.Now().UnixMilli(),
			})
			return
		}
		status := "upstream_unavailable"
		if err == nil {
			status = fmt.Sprintf("upstream_status_%d", resp.StatusCode)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-FastLink-Prefetch", "upstream-error")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"url": targetURLStr, "status": status, "prewarmed": false,
			"timestamp_ms": time.Now().UnixMilli(),
		})
		return
	}

	// Truthful reporting when upstream is not active or warming didn't happen
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=60")
	w.Header().Set("X-FastLink-Prefetch", "no-upstream")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"url":          targetURLStr,
		"status":       "no_upstream_configured",
		"prewarmed":    false,
		"timestamp_ms": time.Now().UnixMilli(),
	})
}

func (s *Server) handleTelemetry(w http.ResponseWriter, r *http.Request) {
	var record TelemetryRecord
	if err := json.NewDecoder(r.Body).Decode(&record); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	record.RecordedAt = time.Now().UTC().Format(time.RFC3339)

	s.telemetryMu.Lock()
	if len(s.telemetryLog) >= 10000 {
		s.telemetryLog = s.telemetryLog[1:]
	}
	s.telemetryLog = append(s.telemetryLog, record)
	count := len(s.telemetryLog)
	s.telemetryMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":         "recorded",
		"active_samples": count,
	})
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
	var record EventRecord
	if err := json.NewDecoder(r.Body).Decode(&record); err != nil {
		var limitErr *http.MaxBytesError
		if errors.As(err, &limitErr) {
			http.Error(w, "event payload too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	if strings.TrimSpace(record.EventID) == "" || len(record.EventID) > 128 {
		http.Error(w, "missing or empty 'event_id'", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(record.EventName) == "" || len(record.EventName) > 64 {
		http.Error(w, "missing or empty 'event_name'", http.StatusBadRequest)
		return
	}
	if record.TimestampMS == 0 {
		http.Error(w, "invalid 'timestamp_ms'", http.StatusBadRequest)
		return
	}

	s.eventMu.Lock()
	if s.recentEvents[record.EventID] {
		s.eventMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":   "deduplicated",
			"event_id": record.EventID,
		})
		return
	}

	if len(s.recentEvents) >= 10000 {
		s.recentEvents = make(map[string]bool)
	}
	s.recentEvents[record.EventID] = true

	if len(s.eventLog) >= 10000 {
		s.eventLog = s.eventLog[1:]
	}
	s.eventLog = append(s.eventLog, record)
	s.eventMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":   "received",
		"event_id": record.EventID,
	})
}

func (s *Server) handleAddPolicy(w http.ResponseWriter, r *http.Request) {
	// Authorization check: Bearer <FASTLINK_ADMIN_KEY>
	authHeader := r.Header.Get("Authorization")
	expectedAuth := "Bearer " + s.config.AdminKey
	if strings.TrimSpace(s.config.AdminKey) == "" || authHeader != expectedAuth {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error":   "unauthorized",
			"message": "Valid Bearer authorization token required to mutate route policies",
		})
		return
	}

	var rule core.RoutePolicyRule
	if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	s.policyEngine.AddRule(rule)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":  "policy_added",
		"pattern": rule.Pattern,
	})
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	s.telemetryMu.RLock()
	count := len(s.telemetryLog)
	var totalHold int64
	for _, rec := range s.telemetryLog {
		totalHold += rec.PressDurationMS
	}
	s.telemetryMu.RUnlock()

	avgHold := float64(0)
	if count > 0 {
		avgHold = float64(totalHold) / float64(count)
	}

	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprintf(w, "# HELP fastlink_telemetry_events_total Total telemetry events received\n")
	_, _ = fmt.Fprintf(w, "# TYPE fastlink_telemetry_events_total counter\n")
	_, _ = fmt.Fprintf(w, "fastlink_telemetry_events_total %d\n", count)
	_, _ = fmt.Fprintf(w, "# HELP fastlink_avg_hold_duration_ms Average press duration\n")
	_, _ = fmt.Fprintf(w, "# TYPE fastlink_avg_hold_duration_ms gauge\n")
	_, _ = fmt.Fprintf(w, "fastlink_avg_hold_duration_ms %.2f\n", avgHold)
}

func (s *Server) handleFallback(w http.ResponseWriter, r *http.Request) {
	if s.proxyHandler != nil && s.config.EnableProxy {
		s.proxyHandler.ServeHTTP(w, r)
		return
	}
	http.NotFound(w, r)
}
