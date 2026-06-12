package auditredaction

import (
	"strings"

	"google.golang.org/protobuf/types/known/structpb"
)

var sensitiveKeyPatterns = []string{
	"api_key",
	"credential",
	"secret",
	"authorization",
	"password",
	"private_key",
	"privatekey",
	"passphrase",
	"cookie",
	"bearer",
	"signature",
	"session_id",
	"sessionid",
}

var exemptTokenKeys = map[string]bool{
	"authorization_verdict_id": true,
	"token_id":                 true,
	"parent_token_id":          true,
	"page_token":               true,
	"next_page_token":          true,
}

// IsSensitiveKey reports whether a payload key matches K-AUDIT-017 sensitive
// patterns after applying structural token-id exemptions.
func IsSensitiveKey(key string) bool {
	lower := strings.ToLower(key)
	if exemptTokenKeys[lower] {
		return false
	}
	for _, pattern := range sensitiveKeyPatterns {
		if strings.Contains(lower, pattern) {
			return true
		}
	}
	return strings.Contains(lower, "token")
}

// MaskValue masks a sensitive string value per K-AUDIT-017.
func MaskValue(value string) string {
	if len(value) >= 8 {
		return value[:4] + "***" + value[len(value)-4:]
	}
	return "***"
}

// MaskSensitiveFields recursively walks structpb fields and masks string values
// whose keys match K-AUDIT-017 sensitive patterns.
func MaskSensitiveFields(fields map[string]*structpb.Value) {
	for key, val := range fields {
		if val == nil {
			continue
		}
		switch v := val.GetKind().(type) {
		case *structpb.Value_StringValue:
			if IsSensitiveKey(key) {
				fields[key] = structpb.NewStringValue(MaskValue(v.StringValue))
			}
		case *structpb.Value_StructValue:
			if v.StructValue != nil {
				MaskSensitiveFields(v.StructValue.GetFields())
			}
		case *structpb.Value_ListValue:
			if v.ListValue != nil {
				for _, item := range v.ListValue.GetValues() {
					if sv := item.GetStructValue(); sv != nil {
						MaskSensitiveFields(sv.GetFields())
					}
				}
			}
		}
	}
}
