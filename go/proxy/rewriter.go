package proxy

import (
	"fmt"
	"strings"

	"github.com/fastlink/fastlink/core"
)

type RewriterOptions struct {
	Origin           string
	ScriptSrc        string
	AutoInjectScript bool
}

func DefaultRewriterOptions(origin string) RewriterOptions {
	return RewriterOptions{
		Origin:           origin,
		ScriptSrc:        "/fastlink.min.js",
		AutoInjectScript: true,
	}
}

type HTMLRewriter struct {
	options RewriterOptions
}

func NewHTMLRewriter(opts RewriterOptions) *HTMLRewriter {
	return &HTMLRewriter{options: opts}
}

func (r *HTMLRewriter) Rewrite(htmlInput string) string {
	var output strings.Builder
	output.Grow(len(htmlInput) + 256)

	cursor := 0
	lower := strings.ToLower(htmlInput)

	for {
		tagStart := strings.Index(lower[cursor:], "<a")
		if tagStart == -1 {
			break
		}
		actualStart := cursor + tagStart
		afterTag := actualStart + 2

		if afterTag < len(htmlInput) {
			b := htmlInput[afterTag]
			if b != ' ' && b != '\t' && b != '\n' && b != '\r' && b != '>' {
				output.WriteString(htmlInput[cursor:afterTag])
				cursor = afterTag
				continue
			}
		}

		tagEndRel := strings.IndexByte(htmlInput[actualStart:], '>')
		if tagEndRel == -1 {
			break
		}
		actualEnd := actualStart + tagEndRel
		tagContent := htmlInput[actualStart : actualEnd+1]

		output.WriteString(htmlInput[cursor:actualStart])

		anchor := parseAnchor(tagContent)
		ctx := core.InteractionContext{
			PointerType:   core.PointerTypeMouse,
			Button:        0,
			CurrentOrigin: r.options.Origin,
		}

		res := core.ResolveFastLink(ctx, anchor)
		if res.Eligible && !strings.Contains(tagContent, "data-fast-link") {
			insertPos := len(tagContent) - 1
			output.WriteString(tagContent[:insertPos])
			output.WriteString(` data-fast-link="true">`)
		} else {
			output.WriteString(tagContent)
		}

		cursor = actualEnd + 1
	}

	output.WriteString(htmlInput[cursor:])
	result := output.String()

	if r.options.AutoInjectScript && !strings.Contains(result, r.options.ScriptSrc) {
		scriptTag := fmt.Sprintf(`<script src="%s" defer></script>`, r.options.ScriptSrc)
		if idx := strings.LastIndex(result, "</body>"); idx != -1 {
			result = result[:idx] + scriptTag + "\n" + result[idx:]
		} else if idx := strings.LastIndex(result, "</html>"); idx != -1 {
			result = result[:idx] + scriptTag + "\n" + result[idx:]
		} else {
			result += scriptTag
		}
	}

	return result
}

func parseAnchor(tag string) core.AnchorAttributes {
	var attrs core.AnchorAttributes

	attrs.Href = extractAttribute(tag, "href")
	attrs.Target = extractAttribute(tag, "target")
	attrs.Role = extractAttribute(tag, "role")
	attrs.Download = hasAttribute(tag, "download")
	attrs.DataNoFastLink = hasAttribute(tag, "data-no-fast-link")

	return attrs
}

func extractAttribute(tag, attr string) string {
	pattern := attr + "="
	idx := strings.Index(strings.ToLower(tag), pattern)
	if idx == -1 {
		return ""
	}
	after := tag[idx+len(pattern):]
	if len(after) == 0 {
		return ""
	}

	quote := after[0]
	if quote == '"' || quote == '\'' {
		after = after[1:]
		end := strings.IndexByte(after, quote)
		if end != -1 {
			return after[:end]
		}
		return after
	}

	end := strings.IndexAny(after, " \t\r\n>")
	if end != -1 {
		return after[:end]
	}
	return after
}

func hasAttribute(tag, attr string) bool {
	lowerTag := strings.ToLower(tag)
	idx := strings.Index(lowerTag, strings.ToLower(attr))
	if idx == -1 {
		return false
	}
	beforeOk := idx == 0 || tag[idx-1] == ' ' || tag[idx-1] == '\t' || tag[idx-1] == '<' || tag[idx-1] == '/'
	afterIdx := idx + len(attr)
	afterOk := afterIdx >= len(tag) || tag[afterIdx] == ' ' || tag[afterIdx] == '\t' || tag[afterIdx] == '=' || tag[afterIdx] == '>' || tag[afterIdx] == '/'
	return beforeOk && afterOk
}
