package proxy_test

import (
	"strings"
	"testing"

	"github.com/fastlink/fastlink/proxy"
)

func TestHTMLRewriter(t *testing.T) {
	opts := proxy.DefaultRewriterOptions("https://example.com")
	rewriter := proxy.NewHTMLRewriter(opts)

	input := `
	<!DOCTYPE html>
	<html>
	<body>
		<nav>
			<a href="/products">Products</a>
			<a href="/checkout" data-no-fast-link>Checkout</a>
			<a href="https://external.com">External</a>
			<a href="/manual.pdf" download>Manual</a>
		</nav>
	</body>
	</html>
	`

	output := rewriter.Rewrite(input)

	if !strings.Contains(output, `<a href="/products" data-fast-link="true">`) {
		t.Errorf("expected /products to have data-fast-link, got: %s", output)
	}

	if !strings.Contains(output, `<a href="/checkout" data-no-fast-link>`) {
		t.Errorf("expected /checkout to remain unchanged, got: %s", output)
	}

	if !strings.Contains(output, `<a href="https://external.com">`) {
		t.Errorf("expected external link to remain unchanged, got: %s", output)
	}

	if !strings.Contains(output, `<a href="/manual.pdf" download>`) {
		t.Errorf("expected download link to remain unchanged, got: %s", output)
	}

	if !strings.Contains(output, `<script src="/fastlink.min.js" defer></script>`) {
		t.Errorf("expected script injection, got: %s", output)
	}
}
