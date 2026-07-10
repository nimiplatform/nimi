package account

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

var realmBrokerJWTValuePattern = regexp.MustCompile(`(?i)(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{3,}(?:$|[^A-Za-z0-9_-])`)

var realmBrokerCredentialKeys = map[string]struct{}{
	"accesstoken":       {},
	"authorization":     {},
	"credential":        {},
	"idtoken":           {},
	"refreshtoken":      {},
	"sessiontoken":      {},
	"signedcredential":  {},
	"subjecttoken":      {},
	"tokenendpointauth": {},
	"jwt":               {},
	"secret":            {},
}

func scanRealmBrokerResponseForCredentials(headers http.Header, body []byte) error {
	for key, values := range headers {
		normalized := normalizeRealmBrokerCredentialKey(key)
		if _, forbidden := realmBrokerCredentialKeys[normalized]; forbidden || normalized == "setcookie" {
			return fmt.Errorf("credential-bearing response header is forbidden")
		}
		for _, value := range values {
			if realmBrokerCredentialValue(value) {
				return fmt.Errorf("credential-like response header value is forbidden")
			}
		}
	}
	var decoded any
	if err := json.Unmarshal(body, &decoded); err != nil {
		return fmt.Errorf("credential scan requires a valid JSON response")
	}
	if scanRealmBrokerJSONValue(decoded) {
		return fmt.Errorf("credential-like Realm broker response is forbidden")
	}
	return nil
}

func scanRealmBrokerJSONValue(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if _, forbidden := realmBrokerCredentialKeys[normalizeRealmBrokerCredentialKey(key)]; forbidden {
				return true
			}
			if scanRealmBrokerJSONValue(child) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if scanRealmBrokerJSONValue(child) {
				return true
			}
		}
	case string:
		return realmBrokerCredentialValue(typed)
	}
	return false
}

func normalizeRealmBrokerCredentialKey(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.NewReplacer("-", "", "_", "", ".", "", " ", "").Replace(value)
}

func realmBrokerCredentialValue(value string) bool {
	trimmed := strings.TrimSpace(value)
	return strings.HasPrefix(strings.ToLower(trimmed), "bearer ") || realmBrokerJWTValuePattern.MatchString(trimmed)
}

func realmUnaryCredentialRejected(message string) *runtimev1.InvokeRealmUnaryResponse {
	return realmUnaryFailure(runtimev1.ReasonCode_AI_OUTPUT_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CREDENTIAL_RESPONSE_FORBIDDEN, message, 0)
}
