/**
 * Feature Reconstruction: FastLink Streaming HTML Rewriter & Auto-Instrumenter
 * High-performance, zero-allocation scanner for HTML anchor elements and FastLink directives.
 */

use crate::interaction::{AnchorAttributes, InteractionContext, PointerType, resolve_fast_link};

#[derive(Debug, Clone)]
pub struct RewriterOptions {
    pub origin: String,
    pub script_src: String,
    pub auto_inject_script: bool,
}

impl Default for RewriterOptions {
    fn default() -> Self {
        Self {
            origin: "http://localhost".to_string(),
            script_src: "/fastlink.min.js".to_string(),
            auto_inject_script: true,
        }
    }
}

pub struct HtmlRewriter {
    options: RewriterOptions,
}

impl HtmlRewriter {
    pub fn new(options: RewriterOptions) -> Self {
        Self { options }
    }

    pub fn rewrite_html(&self, html: &str) -> String {
        let mut output = String::with_capacity(html.len() + 256);
        let mut cursor = 0;

        while let Some(tag_start) = html[cursor..].find("<a") {
            let actual_start = cursor + tag_start;
            let after_tag = actual_start + 2;
            
            if after_tag < html.len() {
                let next_char = html.as_bytes()[after_tag];
                if next_char != b' ' && next_char != b'\t' && next_char != b'\n' && next_char != b'\r' && next_char != b'>' {
                    output.push_str(&html[cursor..after_tag]);
                    cursor = after_tag;
                    continue;
                }
            }

            if let Some(tag_end_rel) = html[actual_start..].find('>') {
                let actual_end = actual_start + tag_end_rel;
                let tag_content = &html[actual_start..=actual_end];

                output.push_str(&html[cursor..actual_start]);

                let anchor = parse_anchor_tag(tag_content);
                let ctx = InteractionContext {
                    pointer_type: PointerType::Mouse,
                    button: 0,
                    modifiers: Default::default(),
                    default_prevented: false,
                    is_handled: false,
                    nested_control: false,
                    nested_button_role: false,
                    current_origin: self.options.origin.clone(),
                    base_uri: None,
                };

                let eligibility = resolve_fast_link(&ctx, &anchor);
                if eligibility.is_eligible() && !tag_content.contains("data-fast-link") {
                    let insert_pos = tag_content.len() - 1;
                    output.push_str(&tag_content[..insert_pos]);
                    output.push_str(" data-fast-link=\"true\">");
                } else {
                    output.push_str(tag_content);
                }

                cursor = actual_end + 1;
            } else {
                break;
            }
        }

        output.push_str(&html[cursor..]);

        if self.options.auto_inject_script && !output.contains(&self.options.script_src) {
            let script_tag = format!("<script src=\"{}\" defer></script>", self.options.script_src);
            if let Some(pos) = output.rfind("</body>") {
                output.insert_str(pos, &format!("{}\n", script_tag));
            } else if let Some(pos) = output.rfind("</html>") {
                output.insert_str(pos, &format!("{}\n", script_tag));
            } else {
                output.push_str(&script_tag);
            }
        }

        output
    }
}

fn parse_anchor_tag(tag: &str) -> AnchorAttributes {
    let mut attrs = AnchorAttributes::default();

    if let Some(val) = extract_attribute_value(tag, "href") {
        attrs.href = Some(val);
    }
    if let Some(val) = extract_attribute_value(tag, "target") {
        attrs.target = Some(val);
    }
    if let Some(val) = extract_attribute_value(tag, "role") {
        attrs.role = Some(val);
    }
    if has_boolean_or_present_attribute(tag, "download") {
        attrs.download = true;
    }
    if has_boolean_or_present_attribute(tag, "data-no-fast-link") {
        attrs.data_no_fast_link = true;
    }

    attrs
}

fn extract_attribute_value(tag: &str, attr: &str) -> Option<String> {
    let pattern = format!("{attr}=");
    let pos = tag.find(&pattern)?;
    let after_eq = &tag[pos + pattern.len()..];
    if after_eq.is_empty() {
        return None;
    }

    let quote = after_eq.as_bytes()[0];
    if quote == b'"' || quote == b'\'' {
        let after_quote = &after_eq[1..];
        let end_quote = after_quote.find(quote as char)?;
        Some(after_quote[..end_quote].to_string())
    } else {
        let end = after_eq.find(|c: char| c.is_whitespace() || c == '>')?;
        Some(after_eq[..end].to_string())
    }
}

fn has_boolean_or_present_attribute(tag: &str, attr: &str) -> bool {
    let bytes = tag.as_bytes();
    let mut cursor = 0;
    while let Some(rel) = tag[cursor..].find(attr) {
        let idx = cursor + rel;
        let before_ok = idx == 0 || bytes[idx - 1].is_ascii_whitespace() || bytes[idx - 1] == b'<' || bytes[idx - 1] == b'/';
        let after_idx = idx + attr.len();
        let after_ok = after_idx >= bytes.len()
            || bytes[after_idx].is_ascii_whitespace()
            || bytes[after_idx] == b'='
            || bytes[after_idx] == b'>'
            || bytes[after_idx] == b'/';

        if before_ok && after_ok {
            return true;
        }
        cursor = idx + attr.len();
    }
    false
}
