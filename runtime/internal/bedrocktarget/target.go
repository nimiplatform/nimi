// Package bedrocktarget owns non-secret Bedrock invocation identity. Catalog
// model identity and an explicitly selected inference profile remain distinct.
package bedrocktarget

import (
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"
)

var runtimeHost = regexp.MustCompile(`^bedrock-runtime\.([a-z]{2}(?:-[a-z]+)+-[0-9]+)\.amazonaws\.com$`)
var modelID = regexp.MustCompile(`^[a-z][a-z0-9-]*\.[a-zA-Z0-9][a-zA-Z0-9.:-]*$`)

// Exact system-profile families reviewed from the current AWS model cards.
// An empty scope denotes native in-region access, never an automatic fallback.
var invocationScopes = map[string][]string{
	"anthropic.claude-haiku-5-5":  {"us", "ca", "eu", "au", "jp", "global"},
	"anthropic.claude-sonnet-5-5": {"us", "eu", "au", "global"},
	"anthropic.claude-opus-5-5":   {"", "us", "eu", "au", "jp", "global"},
	"anthropic.claude-fable-5-1":  {"us", "global"},
	"openai.gpt-6-astra":          {"us", "global", "us-gov"},
	"openai.gpt-6-luna":           {"us", "global", "us-gov"},
	"openai.gpt-6.1-sol":          {"us", "global", "us-gov"},
	"openai.gpt-6.1-terra":        {"us", "global", "us-gov"},
	"amazon.nova-2-lite-v1:0":     {"us", "eu", "jp", "global"},
	"amazon.nova-pro-v1:0":        {"", "us", "eu", "apac"},
	"amazon.nova-lite-v1:0":       {"", "us", "ca", "eu", "apac"},
	"amazon.nova-micro-v1:0":      {"", "us", "eu"},
}

// Endpoint accepts the reviewed Runtime resource root, including the native
// API bases users can copy from AWS. Mantle is a different product endpoint.
// Literal loopback still requires the existing outbound-security opt-in.
func Endpoint(raw string) (string, error) {
	u, err := url.Parse(raw)
	invalid := fmt.Errorf("use an AWS Bedrock Runtime resource endpoint")
	if err != nil || raw == "" || raw != strings.TrimSpace(raw) || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.RawPath != "" || u.Host == "" {
		return "", invalid
	}
	host := u.Hostname()
	local := host == "localhost" || net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback()
	if !local && (!runtimeHost.MatchString(host) || u.Port() != "") || u.Scheme != "https" && !(local && u.Scheme == "http") {
		return "", invalid
	}
	switch strings.TrimRight(u.Path, "/") {
	case "", "/openai/v1", "/anthropic", "/anthropic/v1":
	default:
		return "", invalid
	}
	u.Path = ""
	return u.String(), nil
}

// ControlEndpoint is the same AWS region's Bedrock control plane. Its native
// read-only foundation-models operation is distinct from inference /models,
// which Bedrock Runtime does not implement.
func ControlEndpoint(endpoint string) string {
	u, _ := url.Parse(endpoint) // Endpoint has already validated this value.
	if strings.HasPrefix(u.Host, "bedrock-runtime.") {
		u.Host = "bedrock." + strings.TrimPrefix(u.Host, "bedrock-runtime.")
	}
	u.Path = "/foundation-models"
	return u.String()
}

// ValidInvocation checks that a declaration addresses the selected base model.
// AWS still decides regional/profile/account availability. An arbitrary ARN,
// application profile or another model cannot masquerade as this identity.
func ValidInvocation(model, invocation string) bool {
	if len(model) > 256 || len(invocation) > 256 || !modelID.MatchString(model) {
		return false
	}
	for _, scope := range invocationScopes[model] {
		expected := model
		if scope != "" {
			expected = scope + "." + model
		}
		if invocation == expected {
			return true
		}
	}
	return false
}

// Opus 5.5 is the reviewed exception that allows a bare Claude model ID on
// Runtime, and only from London. Other source-region/profile availability is
// still decided by AWS; this never chooses a substitute geographic scope.
func InvocationRegionAllowed(endpoint, model, invocation string) bool {
	if model != "anthropic.claude-opus-5-5" || invocation != model {
		return true
	}
	u, err := url.Parse(endpoint)
	return err == nil && u.Hostname() == "bedrock-runtime.eu-west-2.amazonaws.com"
}
