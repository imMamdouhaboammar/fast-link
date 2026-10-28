package core

import "strings"

type DecisionKind string

const (
	DecisionKindRouter   DecisionKind = "router"
	DecisionKindDocument DecisionKind = "document"
)

type DocumentMethod string

const (
	DocumentMethodAssign  DocumentMethod = "assign"
	DocumentMethodReplace DocumentMethod = "replace"
)

type FastNavigationDecision struct {
	Kind           DecisionKind   `json:"kind"`
	Scroll         *bool          `json:"scroll,omitempty"`
	DocumentMethod DocumentMethod `json:"method,omitempty"`
}

type RoutePolicyRule struct {
	Pattern  string                 `json:"pattern"`
	Decision FastNavigationDecision `json:"decision"`
	Priority int                    `json:"priority"`
	IsPrefix bool                   `json:"is_prefix"`
}

type RoutePolicyEngine struct {
	rules           []RoutePolicyRule
	defaultDecision FastNavigationDecision
}

func NewRoutePolicyEngine(defaultDecision FastNavigationDecision) *RoutePolicyEngine {
	return &RoutePolicyEngine{
		rules:           make([]RoutePolicyRule, 0),
		defaultDecision: defaultDecision,
	}
}

func (e *RoutePolicyEngine) AddRule(rule RoutePolicyRule) {
	e.rules = append(e.rules, rule)
	for i := len(e.rules) - 1; i > 0; i-- {
		if e.rules[i].Priority > e.rules[i-1].Priority {
			e.rules[i], e.rules[i-1] = e.rules[i-1], e.rules[i]
		}
	}
}

func (e *RoutePolicyEngine) Resolve(intent *FastLinkIntent) FastNavigationDecision {
	if intent == nil {
		return e.defaultDecision
	}
	path := intent.Pathname
	for _, rule := range e.rules {
		if rule.IsPrefix {
			if strings.HasPrefix(path, rule.Pattern) {
				return rule.Decision
			}
		} else if path == rule.Pattern {
			return rule.Decision
		}
	}
	return e.defaultDecision
}
