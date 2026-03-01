package auditlog

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestIsSensitiveKey(t *testing.T) {
	tests := []struct {
		key      string
		expected bool
	}{
		// Sensitive patterns
		{"api_key", true},
		{"my_api_key_value", true},
		{"credential", true},
		{"user_credential", true},
		{"secret", true},
		{"client_secret", true},
		{"authorization", true},
		{"Authorization", true},
		{"password", true},
		{"user_password", true},
		{"access_token", true},
		{"bearer_token", true},
		{"refresh_token", true},

		// Exempt token keys
		{"token_id", false},
		{"page_token", false},
		{"next_page_token", false},

		// Non-sensitive keys
		{"username", false},
		{"app_id", false},
		{"model_id", false},
		{"status", false},
		{"endpoint", false},
	}

	for _, tt := range tests {
		got := isSensitiveKey(tt.key)
		if got != tt.expected {
			t.Errorf("isSensitiveKey(%q) = %v, want %v", tt.key, got, tt.expected)
		}
	}
}

func TestMaskValue(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		// len >= 8: first4 + "***" + last4
		{"12345678", "1234***5678"},
		{"abcdefghijklmnop", "abcd***mnop"},
		{"sk-1234567890abcdef", "sk-1***cdef"},

		// len < 8: "***"
		{"short", "***"},
		{"1234567", "***"},
		{"", "***"},
		{"a", "***"},
	}

	for _, tt := range tests {
		got := maskValue(tt.input)
		if got != tt.expected {
			t.Errorf("maskValue(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestMaskSensitiveFields_TopLevel(t *testing.T) {
	fields := map[string]*structpb.Value{
		"api_key":  structpb.NewStringValue("sk-1234567890abcdef"),
		"username": structpb.NewStringValue("user-001"),
		"password": structpb.NewStringValue("short"),
	}
	maskSensitiveFields(fields)

	if got := fields["api_key"].GetStringValue(); got != "sk-1***cdef" {
		t.Errorf("api_key masked = %q, want %q", got, "sk-1***cdef")
	}
	if got := fields["username"].GetStringValue(); got != "user-001" {
		t.Errorf("username should not be masked: got %q", got)
	}
	if got := fields["password"].GetStringValue(); got != "***" {
		t.Errorf("password masked = %q, want %q", got, "***")
	}
}

func TestMaskSensitiveFields_Nested(t *testing.T) {
	inner, _ := structpb.NewStruct(map[string]any{
		"secret":     "my-secret-value-1234",
		"token_id":   "tid-001",
		"page_token": "abc",
	})
	fields := map[string]*structpb.Value{
		"config": structpb.NewStructValue(inner),
	}
	maskSensitiveFields(fields)

	innerFields := fields["config"].GetStructValue().GetFields()
	if got := innerFields["secret"].GetStringValue(); got != "my-s***1234" {
		t.Errorf("nested secret masked = %q, want %q", got, "my-s***1234")
	}
	if got := innerFields["token_id"].GetStringValue(); got != "tid-001" {
		t.Errorf("token_id should be exempt: got %q", got)
	}
	if got := innerFields["page_token"].GetStringValue(); got != "abc" {
		t.Errorf("page_token should be exempt: got %q", got)
	}
}

func TestMaskSensitiveFields_ListOfStructs(t *testing.T) {
	item1, _ := structpb.NewStruct(map[string]any{
		"credential": "cred-12345678",
		"name":       "test",
	})
	fields := map[string]*structpb.Value{
		"items": structpb.NewListValue(&structpb.ListValue{
			Values: []*structpb.Value{structpb.NewStructValue(item1)},
		}),
	}
	maskSensitiveFields(fields)

	items := fields["items"].GetListValue().GetValues()
	got := items[0].GetStructValue().GetFields()["credential"].GetStringValue()
	if got != "cred***5678" {
		t.Errorf("credential in list masked = %q, want %q", got, "cred***5678")
	}
	name := items[0].GetStructValue().GetFields()["name"].GetStringValue()
	if name != "test" {
		t.Errorf("name in list should not be masked: got %q", name)
	}
}

func TestAppendEventMasksPayload(t *testing.T) {
	store := New(100, 100)
	payload, _ := structpb.NewStruct(map[string]any{
		"api_key":    "sk-1234567890abcdef",
		"model_id":   "gpt-4",
		"secret":     "tiny",
		"token_id":   "tok-123",
		"page_token": "pt-456",
	})
	store.AppendEvent(&runtimev1.AuditEventRecord{
		Domain:    "runtime.ai",
		Operation: "generate",
		Payload:   payload,
	})

	events := store.ListEvents(&runtimev1.ListAuditEventsRequest{})
	if len(events.Events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events.Events))
	}
	fields := events.Events[0].Payload.GetFields()
	if got := fields["api_key"].GetStringValue(); got != "sk-1***cdef" {
		t.Errorf("api_key should be masked: got %q", got)
	}
	if got := fields["model_id"].GetStringValue(); got != "gpt-4" {
		t.Errorf("model_id should not be masked: got %q", got)
	}
	if got := fields["secret"].GetStringValue(); got != "***" {
		t.Errorf("secret (short) should be masked: got %q", got)
	}
	if got := fields["token_id"].GetStringValue(); got != "tok-123" {
		t.Errorf("token_id should be exempt: got %q", got)
	}
	if got := fields["page_token"].GetStringValue(); got != "pt-456" {
		t.Errorf("page_token should be exempt: got %q", got)
	}
}
