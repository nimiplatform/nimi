package account

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
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
	if err := scanRealmBrokerResponseHeadersForCredentials(headers); err != nil {
		return err
	}
	return scanRealmBrokerResponseBodyForCredentials(body)
}

func scanRealmBrokerResponseHeadersForCredentials(headers http.Header) error {
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
	return nil
}

func scanRealmBrokerResponseBodyForCredentials(body []byte) error {
	var decoded any
	if err := json.Unmarshal(body, &decoded); err != nil {
		if scanMalformedRealmBrokerBodyForCredentials(body) {
			return fmt.Errorf("credential-like malformed Realm broker response is forbidden")
		}
		return nil
	}
	if scanRealmBrokerJSONValue(decoded) {
		return fmt.Errorf("credential-like Realm broker response is forbidden")
	}
	return nil
}

func scanRealmPersonaSuccessTopLevelForCredentials(body []byte) error {
	var decoded any
	if err := json.Unmarshal(body, &decoded); err != nil {
		return nil
	}
	check := func(value any) bool {
		object, ok := value.(map[string]any)
		if !ok {
			return false
		}
		for key := range object {
			normalized := normalizeRealmBrokerCredentialKey(key)
			if _, forbidden := realmBrokerCredentialKeys[normalized]; forbidden || normalized == "token" {
				return true
			}
		}
		return false
	}
	if values, ok := decoded.([]any); ok {
		for _, value := range values {
			if check(value) {
				return fmt.Errorf("credential-bearing Persona response field is forbidden")
			}
		}
		return nil
	}
	if check(decoded) {
		return fmt.Errorf("credential-bearing Persona response field is forbidden")
	}
	return nil
}

func scanMalformedRealmBrokerBodyForCredentials(body []byte) bool {
	raw := strings.ToLower(strings.TrimSpace(string(body)))
	if realmBrokerCredentialValue(raw) {
		return true
	}
	normalized := strings.NewReplacer("-", "", "_", "", ".", "", " ", "").Replace(raw)
	for key := range realmBrokerCredentialKeys {
		if strings.Contains(normalized, `"`+key+`"`) {
			return true
		}
	}
	return false
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
