package core_test

import (
	"testing"

	"github.com/fastlink/fastlink/core"
)

func baseContext() core.InteractionContext {
	return core.InteractionContext{
		PointerType:      core.PointerTypeMouse,
		Button:           0,
		Modifiers:        core.ModifierKeys{},
		DefaultPrevented: false,
		IsHandled:        false,
		NestedControl:    false,
		NestedButtonRole: false,
		CurrentOrigin:    "https://example.com",
		BaseURI:          "https://example.com/docs/intro",
	}
}

func baseAnchor() core.AnchorAttributes {
	return core.AnchorAttributes{
		Href:           "/docs/setup",
		Target:         "",
		Download:       false,
		Role:           "",
		DataNoFastLink: false,
	}
}

func TestEligibleSameOriginPrimaryMouse(t *testing.T) {
	ctx := baseContext()
	anchor := baseAnchor()
	res := core.ResolveFastLink(ctx, anchor)

	if !res.Eligible {
		t.Fatalf("expected eligible, got ineligibility reason: %v", res.Reason)
	}
	if res.Intent.RawHref != "/docs/setup" {
		t.Errorf("expected raw_href '/docs/setup', got '%s'", res.Intent.RawHref)
	}
	if res.Intent.ResolvedURL != "https://example.com/docs/setup" {
		t.Errorf("expected resolved_url 'https://example.com/docs/setup', got '%s'", res.Intent.ResolvedURL)
	}
}

func TestRejectTouchPointer(t *testing.T) {
	ctx := baseContext()
	ctx.PointerType = core.PointerTypeTouch
	res := core.ResolveFastLink(ctx, baseAnchor())

	if res.Eligible {
		t.Fatal("expected touch pointer to be ineligible")
	}
	if res.Reason != core.ReasonNonMousePointer {
		t.Errorf("expected %v, got %v", core.ReasonNonMousePointer, res.Reason)
	}
}

func TestRejectModifierKeys(t *testing.T) {
	ctx := baseContext()
	ctx.Modifiers.Meta = true
	res := core.ResolveFastLink(ctx, baseAnchor())

	if res.Eligible {
		t.Fatal("expected modifier keys to be ineligible")
	}
	if res.Reason != core.ReasonModifierKeyPressed {
		t.Errorf("expected %v, got %v", core.ReasonModifierKeyPressed, res.Reason)
	}
}

func TestRejectOptOut(t *testing.T) {
	ctx := baseContext()
	anchor := baseAnchor()
	anchor.DataNoFastLink = true
	res := core.ResolveFastLink(ctx, anchor)

	if res.Eligible {
		t.Fatal("expected opted-out anchor to be ineligible")
	}
	if res.Reason != core.ReasonAnchorOptedOut {
		t.Errorf("expected %v, got %v", core.ReasonAnchorOptedOut, res.Reason)
	}
}

func TestRejectCrossOrigin(t *testing.T) {
	ctx := baseContext()
	anchor := baseAnchor()
	anchor.Href = "https://otherdomain.com/phish"
	res := core.ResolveFastLink(ctx, anchor)

	if res.Eligible {
		t.Fatal("expected cross-origin anchor to be ineligible")
	}
	if res.Reason != core.ReasonCrossOrigin {
		t.Errorf("expected %v, got %v", core.ReasonCrossOrigin, res.Reason)
	}
}

func TestRoutePolicyEngine(t *testing.T) {
	engine := core.NewRoutePolicyEngine(core.FastNavigationDecision{Kind: core.DecisionKindRouter})
	engine.AddRule(core.RoutePolicyRule{
		Pattern:  "/legacy",
		Decision: core.FastNavigationDecision{Kind: core.DecisionKindDocument, DocumentMethod: core.DocumentMethodAssign},
		Priority: 10,
		IsPrefix: true,
	})

	intent1 := &core.FastLinkIntent{Pathname: "/dashboard"}
	d1 := engine.Resolve(intent1)
	if d1.Kind != core.DecisionKindRouter {
		t.Errorf("expected router, got %v", d1.Kind)
	}

	intent2 := &core.FastLinkIntent{Pathname: "/legacy/billing"}
	d2 := engine.Resolve(intent2)
	if d2.Kind != core.DecisionKindDocument || d2.DocumentMethod != core.DocumentMethodAssign {
		t.Errorf("expected document assign, got %+v", d2)
	}
}

func TestCoordinationState(t *testing.T) {
	state := core.NewCoordinationState()
	anchorID := "a-123"
	eventID := "evt-ptr-1"

	state.RegisterAnchor(anchorID)
	if !state.HasAnchorOwner(anchorID) {
		t.Fatal("expected anchor to be owned")
	}

	state.MarkPointerDownHandled(eventID, anchorID, "ctrl-1")
	if !state.IsPointerDownHandled(eventID) {
		t.Fatal("expected pointerdown to be marked handled")
	}

	action := state.ConsumeClick("evt-clk-1", anchorID, 1)
	if action != core.ClickActionSuppress {
		t.Errorf("expected suppress, got %v", action)
	}

	// Keyboard Enter (detail 0) never suppressed
	kbAction := state.ConsumeClick("evt-clk-kb", anchorID, 0)
	if kbAction != core.ClickActionPassThroughNative {
		t.Errorf("expected pass through native, got %v", kbAction)
	}
}
