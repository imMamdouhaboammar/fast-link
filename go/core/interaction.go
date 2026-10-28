// Package core implements FastLink early navigation, link eligibility, and coordination invariants in Go.
package core

import (
	"fmt"
	"net/url"
	"strings"
)

type PointerType string

const (
	PointerTypeMouse PointerType = "mouse"
	PointerTypeTouch PointerType = "touch"
	PointerTypePen   PointerType = "pen"
)

type ModifierKeys struct {
	Alt   bool `json:"alt"`
	Ctrl  bool `json:"ctrl"`
	Meta  bool `json:"meta"`
	Shift bool `json:"shift"`
}

func (m ModifierKeys) HasAny() bool {
	return m.Alt || m.Ctrl || m.Meta || m.Shift
}

type AnchorAttributes struct {
	Href           string `json:"href"`
	Target         string `json:"target"`
	Download       bool   `json:"download"`
	Role           string `json:"role"`
	DataNoFastLink bool   `json:"data_no_fast_link"`
}

type InteractionContext struct {
	PointerType      PointerType  `json:"pointer_type"`
	Button           int          `json:"button"`
	Modifiers        ModifierKeys `json:"modifiers"`
	DefaultPrevented bool         `json:"default_prevented"`
	IsHandled        bool         `json:"is_handled"`
	NestedControl    bool         `json:"nested_control"`
	NestedButtonRole bool         `json:"nested_button_role"`
	CurrentOrigin    string       `json:"current_origin"`
	BaseURI          string       `json:"base_uri"`
}

type FastLinkIntent struct {
	RawHref     string `json:"raw_href"`
	ResolvedURL string `json:"resolved_url"`
	Pathname    string `json:"pathname"`
	Search      string `json:"search"`
	Hash        string `json:"hash"`
	Origin      string `json:"origin"`
}

type IneligibilityReason string

const (
	ReasonDefaultPrevented          IneligibilityReason = "default_prevented"
	ReasonNonPrimaryButton          IneligibilityReason = "non_primary_button"
	ReasonNonMousePointer           IneligibilityReason = "non_mouse_pointer"
	ReasonModifierKeyPressed        IneligibilityReason = "modifier_key_pressed"
	ReasonAlreadyHandled            IneligibilityReason = "already_handled"
	ReasonAnchorOptedOut            IneligibilityReason = "anchor_opted_out"
	ReasonAnchorRoleNotLink         IneligibilityReason = "anchor_role_not_link"
	ReasonNestedControlTag          IneligibilityReason = "nested_control_tag"
	ReasonNestedButtonRole          IneligibilityReason = "nested_button_role"
	ReasonTargetNotSelf             IneligibilityReason = "target_not_self"
	ReasonDownloadAttributePresent  IneligibilityReason = "download_attribute_present"
	ReasonEmptyOrFragmentHref       IneligibilityReason = "empty_or_fragment_href"
	ReasonCrossOrigin               IneligibilityReason = "cross_origin"
	ReasonInvalidURL                IneligibilityReason = "invalid_url"
)

type EligibilityResult struct {
	Eligible bool                `json:"eligible"`
	Intent   *FastLinkIntent     `json:"intent,omitempty"`
	Reason   IneligibilityReason `json:"reason,omitempty"`
	Message  string              `json:"message,omitempty"`
}

func ResolveFastLink(ctx InteractionContext, anchor AnchorAttributes) EligibilityResult {
	if ctx.DefaultPrevented {
		return EligibilityResult{Eligible: false, Reason: ReasonDefaultPrevented}
	}
	if ctx.Button != 0 {
		return EligibilityResult{Eligible: false, Reason: ReasonNonPrimaryButton}
	}
	if ctx.PointerType != PointerTypeMouse {
		return EligibilityResult{Eligible: false, Reason: ReasonNonMousePointer}
	}
	if ctx.Modifiers.HasAny() {
		return EligibilityResult{Eligible: false, Reason: ReasonModifierKeyPressed}
	}
	if ctx.IsHandled {
		return EligibilityResult{Eligible: false, Reason: ReasonAlreadyHandled}
	}
	if anchor.DataNoFastLink {
		return EligibilityResult{Eligible: false, Reason: ReasonAnchorOptedOut}
	}

	trimmedRole := strings.TrimSpace(anchor.Role)
	if trimmedRole != "" && !strings.EqualFold(trimmedRole, "link") {
		return EligibilityResult{Eligible: false, Reason: ReasonAnchorRoleNotLink}
	}

	if ctx.NestedControl {
		return EligibilityResult{Eligible: false, Reason: ReasonNestedControlTag}
	}
	if ctx.NestedButtonRole {
		return EligibilityResult{Eligible: false, Reason: ReasonNestedButtonRole}
	}

	trimmedTarget := strings.TrimSpace(anchor.Target)
	if trimmedTarget != "" && trimmedTarget != "_self" {
		return EligibilityResult{Eligible: false, Reason: ReasonTargetNotSelf}
	}
	if anchor.Download {
		return EligibilityResult{Eligible: false, Reason: ReasonDownloadAttributePresent}
	}

	href := strings.TrimSpace(anchor.Href)
	if href == "" || strings.HasPrefix(href, "#") {
		return EligibilityResult{Eligible: false, Reason: ReasonEmptyOrFragmentHref}
	}

	baseStr := ctx.BaseURI
	if baseStr == "" {
		baseStr = ctx.CurrentOrigin
	}
	baseURL, err := url.Parse(baseStr)
	if err != nil {
		return EligibilityResult{Eligible: false, Reason: ReasonInvalidURL, Message: err.Error()}
	}

	parsedHref, err := url.Parse(href)
	if err != nil {
		return EligibilityResult{Eligible: false, Reason: ReasonInvalidURL, Message: err.Error()}
	}

	resolvedURL := baseURL.ResolveReference(parsedHref)

	expectedOrigin := getOrigin(baseURL)
	actualOrigin := getOrigin(resolvedURL)

	if actualOrigin != expectedOrigin {
		return EligibilityResult{
			Eligible: false,
			Reason:   ReasonCrossOrigin,
			Message:  fmt.Sprintf("expected %s, got %s", expectedOrigin, actualOrigin),
		}
	}

	search := ""
	if resolvedURL.RawQuery != "" {
		search = "?" + resolvedURL.RawQuery
	}
	hash := ""
	if resolvedURL.Fragment != "" {
		hash = "#" + resolvedURL.Fragment
	}

	return EligibilityResult{
		Eligible: true,
		Intent: &FastLinkIntent{
			RawHref:     href,
			ResolvedURL: resolvedURL.String(),
			Pathname:    resolvedURL.Path,
			Search:      search,
			Hash:        hash,
			Origin:      actualOrigin,
		},
	}
}

func getOrigin(u *url.URL) string {
	if u.Scheme == "" || u.Host == "" {
		return ""
	}
	return fmt.Sprintf("%s://%s", u.Scheme, u.Host)
}
