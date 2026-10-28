package server_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/fastlink/fastlink/core"
	"github.com/fastlink/fastlink/server"
)

func TestServerEndpoints(t *testing.T) {
	srv, err := server.NewServer(server.Config{
		UpstreamOrigin:   "", // No upstream origin
		EnableProxy:      false,
		AutoInjectClient: true,
		AdminKey:         "test-admin-secret",
	})
	if err != nil {
		t.Fatalf("failed to create server: %v", err)
	}

	ts := httptest.NewServer(srv)
	defer ts.Close()

	// 1. Health check
	resp, err := http.Get(ts.URL + "/health")
	if err != nil {
		t.Fatalf("health check failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	// 2. Resolve endpoint
	resolveReq := server.ResolveRequest{
		Context: core.InteractionContext{
			PointerType:   core.PointerTypeMouse,
			Button:        0,
			CurrentOrigin: "https://example.com",
			BaseURI:       "https://example.com/docs",
		},
		Anchor: core.AnchorAttributes{
			Href: "/docs/page",
		},
	}
	reqBytes, _ := json.Marshal(resolveReq)
	resp, err = http.Post(ts.URL+"/api/v1/resolve", "application/json", bytes.NewReader(reqBytes))
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	var resolveResp server.ResolveResponse
	_ = json.NewDecoder(resp.Body).Decode(&resolveResp)
	if !resolveResp.Eligible {
		t.Fatalf("expected eligible, got reason %v", resolveResp.Reason)
	}

	// 3. Prefetch endpoint - truthful reporting without upstream
	resp, err = http.Get(ts.URL + "/api/v1/prefetch?url=https%3A%2F%2Fexample.com%2Fdocs%2Fpage")
	if err != nil {
		t.Fatalf("prefetch failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	var prefetchResp map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&prefetchResp)
	if prefetchResp["prewarmed"] != false {
		t.Errorf("expected prewarmed false without active upstream, got %v", prefetchResp["prewarmed"])
	}

	// 4. Prefetch endpoint - rejects sensitive routes
	resp, err = http.Get(ts.URL + "/api/v1/prefetch?url=https%3A%2F%2Fexample.com%2Fapi%2Fusers")
	if err != nil {
		t.Fatalf("prefetch sensitive check failed: %v", err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for sensitive route, got %d", resp.StatusCode)
	}

	// 5. Telemetry endpoint
	telemetryPayload := map[string]any{
		"source_path":       "/",
		"destination_path":  "/docs/page",
		"press_duration_ms": 84,
		"click_suppressed":  true,
		"was_aborted":       false,
	}
	tBytes, _ := json.Marshal(telemetryPayload)
	resp, err = http.Post(ts.URL+"/api/v1/telemetry", "application/json", bytes.NewReader(tBytes))
	if err != nil {
		t.Fatalf("telemetry failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	// 6. Events collector endpoint & idempotency deduplication
	eventPayload := map[string]any{
		"event_id":     "fl_go_evt_101",
		"event_name":   "Contact",
		"timestamp_ms": 1700000000000,
		"url":          "https://example.com/landing",
		"mode":         "safe",
	}
	eBytes, _ := json.Marshal(eventPayload)
	// First receipt
	resp, err = http.Post(ts.URL+"/api/v1/events", "application/json", bytes.NewReader(eBytes))
	if err != nil {
		t.Fatalf("events post failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	var eResp1 map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&eResp1)
	if eResp1["status"] != "received" {
		t.Errorf("expected 'received', got %v", eResp1["status"])
	}

	// Duplicate receipt
	resp, err = http.Post(ts.URL+"/api/v1/events", "application/json", bytes.NewReader(eBytes))
	if err != nil {
		t.Fatalf("events post duplicate failed: %v", err)
	}
	var eResp2 map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&eResp2)
	if eResp2["status"] != "deduplicated" {
		t.Errorf("expected 'deduplicated', got %v", eResp2["status"])
	}

	// 7. Policies endpoint authorization
	policyPayload := map[string]any{
		"pattern": "/checkout",
		"decision": map[string]any{
			"kind":   "document",
			"method": "assign",
		},
		"priority":  50,
		"is_prefix": true,
	}
	pBytes, _ := json.Marshal(policyPayload)

	// Unauthenticated request
	unauthReq, _ := http.NewRequest("POST", ts.URL+"/api/v1/policies", bytes.NewReader(pBytes))
	unauthReq.Header.Set("Content-Type", "application/json")
	unauthResp, err := http.DefaultClient.Do(unauthReq)
	if err != nil {
		t.Fatalf("unauth policy failed: %v", err)
	}
	if unauthResp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 for unauthenticated policy request, got %d", unauthResp.StatusCode)
	}

	// Authenticated request
	authReq, _ := http.NewRequest("POST", ts.URL+"/api/v1/policies", bytes.NewReader(pBytes))
	authReq.Header.Set("Content-Type", "application/json")
	authReq.Header.Set("Authorization", "Bearer test-admin-secret")
	authResp, err := http.DefaultClient.Do(authReq)
	if err != nil {
		t.Fatalf("auth policy failed: %v", err)
	}
	if authResp.StatusCode != http.StatusCreated {
		t.Errorf("expected 201 for authenticated policy request, got %d", authResp.StatusCode)
	}

	// 8. Metrics endpoint
	resp, err = http.Get(ts.URL + "/metrics")
	if err != nil {
		t.Fatalf("metrics failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func TestPolicyFailsClosedWhenAdminKeyMissing(t *testing.T) {
	t.Setenv("FASTLINK_ADMIN_KEY", "")
	srv, err := server.NewServer(server.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, auth := range []string{"", "Bearer fastlink-admin-secret", "Bearer "} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/policies", bytes.NewBufferString(`{"pattern":"/checkout","decision":{"kind":"router"},"priority":5,"is_prefix":false}`))
		req.Header.Set("Authorization", auth)
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		srv.ServeHTTP(res, req)
		if res.Code != http.StatusUnauthorized {
			t.Errorf("missing key must deny %q: got %d", auth, res.Code)
		}
	}
}

func TestPrefetchRejectsMutationQueries(t *testing.T) {
	srv, err := server.NewServer(server.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{
		"https://example.com/?add-to-cart=123", "https://example.com/?wc-ajax=add_to_cart",
		"https://example.com/?_wpnonce=x", "https://example.com/public/../admin/settings",
		"https://example.com//admin/settings",
	} {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/prefetch?url="+url.QueryEscape(target), nil)
		res := httptest.NewRecorder()
		srv.ServeHTTP(res, req)
		if res.Code != http.StatusBadRequest {
			t.Errorf("unsafe prefetch %q returned %d", target, res.Code)
		}
	}
}

func TestPrefetchPropagatesCancellation(t *testing.T) {
	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Header().Set("Cache-Control", "public, max-age=60")
		w.Write([]byte("ok"))
	}))
	defer upstream.Close()
	srv, err := server.NewServer(server.Config{UpstreamOrigin: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/prefetch?url=https%3A%2F%2Fexample.com%2Fdocs", nil).WithContext(ctx)
	srv.ServeHTTP(httptest.NewRecorder(), req)
	if got := requests.Load(); got != 0 {
		t.Fatalf("cancelled request contacted upstream %d times", got)
	}
}

func TestPrefetchReusesUpstreamConnections(t *testing.T) {
	var connections atomic.Int32
	upstream := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=60")
		w.Write([]byte("ok"))
	}))
	upstream.Config.ConnState = func(c net.Conn, state http.ConnState) {
		if state == http.StateNew {
			connections.Add(1)
		}
	}
	upstream.Start()
	defer upstream.Close()
	srv, err := server.NewServer(server.Config{UpstreamOrigin: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 8; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/prefetch?url=https%3A%2F%2Fexample.com%2Fdocs", nil)
		res := httptest.NewRecorder()
		srv.ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("prefetch %d failed: %d", i, res.Code)
		}
	}
	if got := connections.Load(); got > 2 {
		t.Fatalf("upstream connections not reused: %d for 8 requests", got)
	}
}

func TestPrefetchPreservesSafeQueryOnActualUpstreamRequest(t *testing.T) {
	var requested string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested = r.URL.RequestURI()
		w.Header().Set("Cache-Control", "public, max-age=60")
		_, _ = w.Write([]byte("ok"))
	}))
	defer upstream.Close()
	srv, err := server.NewServer(server.Config{UpstreamOrigin: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	target := "https://example.com/catalog?page=2&sort=price"
	req := httptest.NewRequest(http.MethodGet, "/api/v1/prefetch?url="+url.QueryEscape(target), nil)
	res := httptest.NewRecorder()
	srv.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", res.Code)
	}
	if requested != "/catalog?page=2&sort=price" {
		t.Fatalf("prefetch fetched a different resource: %q", requested)
	}
}

func TestProxyRewritesCompressedHTMLWithoutStaleEncoding(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("X-Upstream", "preserved")
		gz := gzip.NewWriter(w)
		_, _ = gz.Write([]byte("<html><body><a href='/page'>Next</a></body></html>"))
		_ = gz.Close()
	}))
	defer upstream.Close()
	srv, err := server.NewServer(server.Config{UpstreamOrigin: upstream.URL, EnableProxy: true, AutoInjectClient: true})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/page", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	res := httptest.NewRecorder()
	srv.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("got status %d", res.Code)
	}
	if !strings.Contains(res.Body.String(), `/fastlink.min.js`) {
		t.Fatalf("compressed HTML was not rewritten: %q", res.Body.String())
	}
	if got := res.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("rewritten body has stale encoding: %q", got)
	}
	if got := res.Header().Get("X-Upstream"); got != "preserved" {
		t.Fatalf("lost upstream header: %q", got)
	}
}

func TestPrefetchReportsUpstreamFailureWithoutClaimingNoUpstream(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "offline", http.StatusServiceUnavailable)
	}))
	defer upstream.Close()
	srv, err := server.NewServer(server.Config{UpstreamOrigin: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/prefetch?url=https%3A%2F%2Fexample.com%2Fpage", nil)
	res := httptest.NewRecorder()
	srv.ServeHTTP(res, req)
	var result map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["status"] != "upstream_status_503" || result["prewarmed"] != false {
		t.Fatalf("incorrect upstream failure report: %v", result)
	}
}

func TestEventsRejectOversizedPublicPayloads(t *testing.T) {
	srv, err := server.NewServer(server.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, payload := range []string{
		`{"event_id":"` + strings.Repeat("x", 129) + `","event_name":"Contact","timestamp_ms":1}`,
		`{"event_id":"one","event_name":"Contact","timestamp_ms":1,"properties":{"big":"` + strings.Repeat("x", 70*1024) + `"}}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(payload))
		res := httptest.NewRecorder()
		srv.ServeHTTP(res, req)
		if res.Code != http.StatusBadRequest && res.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("invalid public payload accepted with status %d", res.Code)
		}
	}
}
