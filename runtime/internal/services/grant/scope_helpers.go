package grant

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"sort"
	"strings"
	"time"
)

func resolveScopes(req *runtimev1.AuthorizeExternalPrincipalRequest) []string {
	if req.GetPolicyMode() == runtimev1.PolicyMode_POLICY_MODE_CUSTOM {
		return normalizeScopes(req.GetScopes())
	}

	if req.GetPolicyMode() == runtimev1.PolicyMode_POLICY_MODE_PRESET {
		switch req.GetPreset() {
		case runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_READ_ONLY:
			return []string{"read:*"}
		case runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_FULL:
			return []string{"read:*", "write:*"}
		case runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_DELEGATE:
			return []string{"read:*", "write:*", "grant:delegate"}
		}
	}

	return normalizeScopes(req.GetScopes())
}

func normalizeScopes(input []string) []string {
	if len(input) == 0 {
		return nil
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(input))
	for _, raw := range input {
		scope := strings.TrimSpace(raw)
		if scope == "" || seen[scope] {
			continue
		}
		seen[scope] = true
		out = append(out, scope)
	}
	sort.Strings(out)
	return out
}

func hasRealmScope(scopes []string) bool {
	for _, raw := range scopes {
		if strings.HasPrefix(strings.TrimSpace(raw), "realm.") {
			return true
		}
	}
	return false
}

func scopesAllowed(effective []string, requested []string) bool {
	if len(requested) == 0 {
		return true
	}
	for _, req := range requested {
		req = strings.TrimSpace(req)
		if req == "" {
			continue
		}
		allowed := false
		for _, eff := range effective {
			eff = strings.TrimSpace(eff)
			if eff == req {
				allowed = true
				break
			}
			if strings.HasSuffix(eff, "*") {
				prefix := strings.TrimSuffix(eff, "*")
				if strings.HasPrefix(req, prefix) {
					allowed = true
					break
				}
			}
		}
		if !allowed {
			return false
		}
	}
	return true
}

func selectorsWithin(parent *runtimev1.ResourceSelectors, requested *runtimev1.ResourceSelectors) bool {
	if requested == nil {
		return true
	}
	if parent == nil {
		return true
	}

	if !sliceWithin(parent.GetConversationIds(), requested.GetConversationIds()) {
		return false
	}
	if !sliceWithin(parent.GetMessageIds(), requested.GetMessageIds()) {
		return false
	}
	if !sliceWithin(parent.GetDocumentIds(), requested.GetDocumentIds()) {
		return false
	}

	for k, v := range requested.GetLabels() {
		if parent.GetLabels()[k] != v {
			return false
		}
	}
	return true
}

func sliceWithin(parent []string, child []string) bool {
	if len(child) == 0 {
		return true
	}
	if len(parent) == 0 {
		return false
	}
	set := make(map[string]bool, len(parent))
	for _, v := range parent {
		set[v] = true
	}
	for _, v := range child {
		if !set[v] {
			return false
		}
	}
	return true
}

func cloneSelectors(input *runtimev1.ResourceSelectors) *runtimev1.ResourceSelectors {
	if input == nil {
		return nil
	}
	labels := make(map[string]string, len(input.GetLabels()))
	for k, v := range input.GetLabels() {
		labels[k] = v
	}
	return &runtimev1.ResourceSelectors{
		ConversationIds: append([]string(nil), input.GetConversationIds()...),
		MessageIds:      append([]string(nil), input.GetMessageIds()...),
		DocumentIds:     append([]string(nil), input.GetDocumentIds()...),
		Labels:          labels,
	}
}

func cloneConsent(input *runtimev1.ConsentRef) *runtimev1.ConsentRef {
	if input == nil {
		return nil
	}
	return &runtimev1.ConsentRef{
		SubjectUserId:  input.GetSubjectUserId(),
		ConsentId:      input.GetConsentId(),
		ConsentVersion: input.GetConsentVersion(),
	}
}

func resolveTTL(rawSeconds int32, fallbackSeconds int32) time.Duration {
	if rawSeconds <= 0 {
		return time.Duration(fallbackSeconds) * time.Second
	}
	return time.Duration(rawSeconds) * time.Second
}
