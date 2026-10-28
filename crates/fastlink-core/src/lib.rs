pub mod coordination;
pub mod html;
pub mod interaction;
pub mod navigation;

pub use coordination::{ClickAction, CoordinationState, FollowupClickEvent};
pub use html::{HtmlRewriter, RewriterOptions};
pub use interaction::{
    resolve_fast_link, AnchorAttributes, EligibilityResult, FastLinkIntent, IneligibilityReason,
    InteractionContext, ModifierKeys, PointerType,
};
pub use navigation::{
    DocumentMethod, FastNavigationDecision, FastRouterProposal, RoutePolicyEngine, RoutePolicyRule,
};

#[cfg(test)]
mod tests {
    use super::*;

    fn base_context() -> InteractionContext {
        InteractionContext {
            pointer_type: PointerType::Mouse,
            button: 0,
            modifiers: ModifierKeys::default(),
            default_prevented: false,
            is_handled: false,
            nested_control: false,
            nested_button_role: false,
            current_origin: "https://example.com".to_string(),
            base_uri: Some("https://example.com/docs/intro".to_string()),
        }
    }

    fn base_anchor() -> AnchorAttributes {
        AnchorAttributes {
            href: Some("/docs/setup".to_string()),
            target: None,
            download: false,
            role: None,
            data_no_fast_link: false,
        }
    }

    #[test]
    fn test_eligible_same_origin_primary_mouse() {
        let ctx = base_context();
        let anchor = base_anchor();
        let res = resolve_fast_link(&ctx, &anchor);

        assert!(res.is_eligible());
        let intent = res.intent().unwrap();
        assert_eq!(intent.raw_href, "/docs/setup");
        assert_eq!(intent.resolved_url, "https://example.com/docs/setup");
        assert_eq!(intent.pathname, "/docs/setup");
        assert_eq!(intent.origin, "https://example.com");
    }

    #[test]
    fn test_reject_touch_pointer() {
        let mut ctx = base_context();
        ctx.pointer_type = PointerType::Touch;
        let anchor = base_anchor();
        let res = resolve_fast_link(&ctx, &anchor);

        assert!(!res.is_eligible());
        assert_eq!(
            res,
            EligibilityResult::Ineligible {
                reason: IneligibilityReason::NonMousePointer {
                    pointer_type: PointerType::Touch
                }
            }
        );
    }

    #[test]
    fn test_reject_pen_pointer() {
        let mut ctx = base_context();
        ctx.pointer_type = PointerType::Pen;
        let anchor = base_anchor();
        let res = resolve_fast_link(&ctx, &anchor);

        assert!(!res.is_eligible());
        assert_eq!(
            res,
            EligibilityResult::Ineligible {
                reason: IneligibilityReason::NonMousePointer {
                    pointer_type: PointerType::Pen
                }
            }
        );
    }

    #[test]
    fn test_reject_non_primary_button() {
        let mut ctx = base_context();
        ctx.button = 1; // Middle click
        let anchor = base_anchor();
        let res = resolve_fast_link(&ctx, &anchor);

        assert!(!res.is_eligible());
        assert_eq!(
            res,
            EligibilityResult::Ineligible {
                reason: IneligibilityReason::NonPrimaryButton { button: 1 }
            }
        );
    }

    #[test]
    fn test_reject_modifier_keys() {
        let mut ctx = base_context();
        ctx.modifiers.meta = true; // Cmd+Click
        let anchor = base_anchor();
        let res = resolve_fast_link(&ctx, &anchor);

        assert!(!res.is_eligible());
        assert_eq!(
            res,
            EligibilityResult::Ineligible {
                reason: IneligibilityReason::ModifierKeyPressed
            }
        );
    }

    #[test]
    fn test_reject_opt_out() {
        let ctx = base_context();
        let mut anchor = base_anchor();
        anchor.data_no_fast_link = true;
        let res = resolve_fast_link(&ctx, &anchor);

        assert!(!res.is_eligible());
        assert_eq!(
            res,
            EligibilityResult::Ineligible {
                reason: IneligibilityReason::AnchorOptedOut
            }
        );
    }

    #[test]
    fn test_reject_non_link_role() {
        let ctx = base_context();
        let mut anchor = base_anchor();
        anchor.role = Some("button".to_string());
        let res = resolve_fast_link(&ctx, &anchor);

        assert!(!res.is_eligible());
        assert_eq!(
            res,
            EligibilityResult::Ineligible {
                reason: IneligibilityReason::AnchorRoleNotLink {
                    role: "button".to_string()
                }
            }
        );
    }

    #[test]
    fn test_accept_empty_or_link_role() {
        let ctx = base_context();
        let mut anchor = base_anchor();
        anchor.role = Some("link".to_string());
        let res = resolve_fast_link(&ctx, &anchor);
        assert!(res.is_eligible());

        anchor.role = Some("  ".to_string());
        let res2 = resolve_fast_link(&ctx, &anchor);
        assert!(res2.is_eligible());
    }

    #[test]
    fn test_reject_nested_control() {
        let mut ctx = base_context();
        ctx.nested_control = true;
        let anchor = base_anchor();
        let res = resolve_fast_link(&ctx, &anchor);

        assert!(!res.is_eligible());
        assert_eq!(
            res,
            EligibilityResult::Ineligible {
                reason: IneligibilityReason::NestedControlTag
            }
        );
    }

    #[test]
    fn test_reject_download_attribute() {
        let ctx = base_context();
        let mut anchor = base_anchor();
        anchor.download = true;
        let res = resolve_fast_link(&ctx, &anchor);

        assert!(!res.is_eligible());
        assert_eq!(
            res,
            EligibilityResult::Ineligible {
                reason: IneligibilityReason::DownloadAttributePresent
            }
        );
    }

    #[test]
    fn test_reject_target_blank() {
        let ctx = base_context();
        let mut anchor = base_anchor();
        anchor.target = Some("_blank".to_string());
        let res = resolve_fast_link(&ctx, &anchor);

        assert!(!res.is_eligible());
        assert_eq!(
            res,
            EligibilityResult::Ineligible {
                reason: IneligibilityReason::TargetNotSelf {
                    target: "_blank".to_string()
                }
            }
        );
    }

    #[test]
    fn test_reject_cross_origin() {
        let ctx = base_context();
        let mut anchor = base_anchor();
        anchor.href = Some("https://evil.com/phishing".to_string());
        let res = resolve_fast_link(&ctx, &anchor);

        assert!(!res.is_eligible());
        assert_eq!(
            res,
            EligibilityResult::Ineligible {
                reason: IneligibilityReason::CrossOrigin {
                    expected: "https://example.com".to_string(),
                    actual: "https://evil.com".to_string(),
                }
            }
        );
    }

    #[test]
    fn test_reject_hash_only_href() {
        let ctx = base_context();
        let mut anchor = base_anchor();
        anchor.href = Some("#section-heading".to_string());
        let res = resolve_fast_link(&ctx, &anchor);

        assert!(!res.is_eligible());
        assert_eq!(
            res,
            EligibilityResult::Ineligible {
                reason: IneligibilityReason::EmptyOrFragmentHref
            }
        );
    }

    #[test]
    fn test_navigation_decision_policy_engine() {
        let mut engine = RoutePolicyEngine::new(FastNavigationDecision::Router { scroll: None });
        engine.add_rule(RoutePolicyRule {
            pattern: "/external-app".to_string(),
            decision: FastNavigationDecision::Document {
                method: DocumentMethod::Assign,
            },
            priority: 10,
            is_prefix: true,
        });

        let mut intent = FastLinkIntent {
            raw_href: "/docs/page".to_string(),
            resolved_url: "https://example.com/docs/page".to_string(),
            pathname: "/docs/page".to_string(),
            search: "".to_string(),
            hash: "".to_string(),
            origin: "https://example.com".to_string(),
        };

        assert_eq!(
            engine.resolve(&intent),
            FastNavigationDecision::Router { scroll: None }
        );

        intent.pathname = "/external-app/dashboard".to_string();
        assert_eq!(
            engine.resolve(&intent),
            FastNavigationDecision::Document {
                method: DocumentMethod::Assign
            }
        );
    }

    #[test]
    fn test_coordination_click_suppression() {
        let mut state = CoordinationState::new();
        let anchor_id = "anchor-1";
        let event_id = "ptr-1";

        state.register_anchor(anchor_id);
        assert!(state.has_anchor_owner(anchor_id));

        state.mark_pointerdown_handled(event_id, anchor_id, "ctrl-1");
        assert!(state.is_pointerdown_handled(event_id));

        // Follow-up click with detail > 0 is suppressed
        let click_action = state.consume_click("clk-1", anchor_id, 1);
        assert_eq!(click_action, ClickAction::Suppress);

        // Subsequent click for same event is already suppressed
        let repeat_action = state.consume_click("clk-1", anchor_id, 1);
        assert_eq!(repeat_action, ClickAction::AlreadySuppressed);

        // Detail 0 (keyboard Enter activation) is never suppressed
        let kb_action = state.consume_click("clk-kb", anchor_id, 0);
        assert_eq!(kb_action, ClickAction::PassThroughNative);

        state.unregister_anchor(anchor_id);
        assert!(!state.has_anchor_owner(anchor_id));
    }

    #[test]
    fn test_html_rewriter_auto_instrumentation() {
        let rewriter = HtmlRewriter::new(RewriterOptions {
            origin: "https://example.com".to_string(),
            script_src: "/fastlink.min.js".to_string(),
            auto_inject_script: true,
        });

        let input_html = r#"
        <!DOCTYPE html>
        <html>
        <head><title>Test</title></head>
        <body>
            <nav>
                <a href="/about">About</a>
                <a href="/pricing" data-no-fast-link>Pricing</a>
                <a href="https://external.org">External</a>
                <a href="/download.zip" download>Download</a>
            </nav>
        </body>
        </html>
        "#;

        let rewritten = rewriter.rewrite_html(input_html);

        // /about is eligible -> data-fast-link added
        assert!(rewritten.contains(r#"<a href="/about" data-fast-link="true">"#));
        // Pricing is opted out -> unchanged
        assert!(rewritten.contains(r#"<a href="/pricing" data-no-fast-link>"#));
        // External -> unchanged
        assert!(rewritten.contains(r#"<a href="https://external.org">"#));
        // Download -> unchanged
        assert!(rewritten.contains(r#"<a href="/download.zip" download>"#));
        // Script injected before </body>
        assert!(rewritten.contains(r#"<script src="/fastlink.min.js" defer></script>"#));
    }
}
