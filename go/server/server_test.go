package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
		"priority": 50,
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
