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
		UpstreamOrigin:   "https://example.com",
		EnableProxy:      false,
		AutoInjectClient: true,
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

	// 3. Prefetch endpoint
	resp, err = http.Get(ts.URL + "/api/v1/prefetch?url=https%3A%2F%2Fexample.com%2Fdocs%2Fpage")
	if err != nil {
		t.Fatalf("prefetch failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	// 4. Telemetry endpoint
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

	// 5. Metrics endpoint
	resp, err = http.Get(ts.URL + "/metrics")
	if err != nil {
		t.Fatalf("metrics failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}
