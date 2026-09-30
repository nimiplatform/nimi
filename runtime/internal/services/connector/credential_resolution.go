package connector

import (
	"encoding/json"
	"strings"
	"time"
)

type ResolvedCredential struct {
	APIKey  string
	Headers map[string]string
}

func ResolveCredential(record ConnectorRecord, secretPayload string) ResolvedCredential {
	if IsChatGPTPlanRecord(record) {
		// Only a captured request-scoped token is usable; the sealed SIWC
		// record itself is opened solely by the renewal owner.
		token, err := ChatGPTPlanRequestAccessToken(secretPayload, time.Now().UTC())
		if err != nil {
			return ResolvedCredential{}
		}
		return ResolvedCredential{APIKey: token}
	}
	resolved := ResolvedCredential{
		APIKey: strings.TrimSpace(extractAPIKeyFromSecretPayload(secretPayload)),
	}
	if resolved.APIKey == "" {
		return resolved
	}
	profile, ok := LookupProviderAuthProfile(record.ProviderAuthProfile)
	if !ok {
		profile, ok = LookupProviderAuthProfile(record.Provider)
	}
	if ok && profile.ResolveHeaders != nil {
		resolved.Headers = profile.ResolveHeaders(resolved.APIKey)
	}
	return resolved
}

func anthropicCredentialHeaders(accessToken string) map[string]string {
	headers := map[string]string{
		"anthropic-version": "2023-06-01",
	}
	if !isAnthropicOAuthToken(accessToken) {
		return headers
	}
	headers["anthropic-beta"] = "fine-grained-tool-streaming-2025-05-14,claude-code-20250219,oauth-2025-04-20"
	headers["user-agent"] = "claude-cli/2.1.74 (external, cli)"
	headers["x-app"] = "cli"
	return headers
}

func isAnthropicOAuthToken(token string) bool {
	normalized := strings.TrimSpace(token)
	if normalized == "" {
		return false
	}
	if strings.HasPrefix(normalized, "sk-ant-api") {
		return false
	}
	return strings.HasPrefix(normalized, "sk-ant-") || strings.HasPrefix(normalized, "eyJ")
}

func extractAPIKeyFromSecretPayload(payload string) string {
	trimmed := strings.TrimSpace(payload)
	if trimmed == "" {
		return ""
	}
	if !strings.HasPrefix(trimmed, "{") {
		return trimmed
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(trimmed), &raw); err != nil {
		return ""
	}
	for _, key := range []string{"api_key", "access_token", "token"} {
		value, _ := raw[key].(string)
		if normalized := strings.TrimSpace(value); normalized != "" {
			return normalized
		}
	}
	return ""
}
