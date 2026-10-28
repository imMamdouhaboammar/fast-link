package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
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
}

type Server struct {
	config       Config
	policyEngine *core.RoutePolicyEngine
	rewriter     *proxy.HTMLRewriter
	clientJS     string
	telemetryMu  sync.RWMutex
	telemetryLog []TelemetryRecord
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

type ResolveRequest struct {
	Context core.InteractionContext `json:"context"`
	Anchor  core.AnchorAttributes  `json:"anchor"`
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
		}
		rp.ModifyResponse = func(resp *http.Response) error {
			contentType := resp.Header.Get("Content-Type")
			if strings.Contains(contentType, "text/html") && cfg.AutoInjectClient {
				bodyBytes, err := io.ReadAll(resp.Body)
				if err != nil {
					return err
				}
				_ = resp.Body.Close()
				rewritten := rewriter.Rewrite(string(bodyBytes))
				resp.Body = io.NopCloser(strings.NewReader(rewritten))
				resp.ContentLength = int64(len(rewritten))
				resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(rewritten)))
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
		"version": "0.1.0",
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
	targetURL := r.URL.Query().Get("url")
	if targetURL == "" {
		http.Error(w, "missing 'url' parameter", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=60")
	w.Header().Set("X-FastLink-Prefetch", "speculative-hit")
	w.WriteHeader(http.StatusOK)

	_ = json.NewEncoder(w).Encode(map[string]any{
		"url":          targetURL,
		"status":       "ready",
		"prewarmed":    true,
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

func (s *Server) handleAddPolicy(w http.ResponseWriter, r *http.Request) {
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
	avgHold := float64(0)
	if count > 0 {
		avgHold = float64(totalHold) / float64(count)
	}
	s.telemetryMu.RUnlock()

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "# HELP fastlink_telemetry_samples_total Total number of telemetry samples ingested\n")
	fmt.Fprintf(w, "# TYPE fastlink_telemetry_samples_total counter\n")
	fmt.Fprintf(w, "fastlink_telemetry_samples_total %d\n", count)
	fmt.Fprintf(w, "# HELP fastlink_mouse_hold_duration_ms_avg Average mouse hold duration in milliseconds\n")
	fmt.Fprintf(w, "# TYPE fastlink_mouse_hold_duration_ms_avg gauge\n")
	fmt.Fprintf(w, "fastlink_mouse_hold_duration_ms_avg %.2f\n", avgHold)
}

func (s *Server) handleFallback(w http.ResponseWriter, r *http.Request) {
	if s.proxyHandler != nil && s.config.EnableProxy {
		s.proxyHandler.ServeHTTP(w, r)
		return
	}
	http.NotFound(w, r)
}
