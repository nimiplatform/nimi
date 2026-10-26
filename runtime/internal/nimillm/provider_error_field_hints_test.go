package nimillm

import (
	"reflect"
	"strings"
	"testing"
)

func TestProviderErrorFieldHintsNeverReturnProviderText(t *testing.T) {
	payload := map[string]any{"error": map[string]any{"message": "Invalid max_completion_tokens; request carried private-user-text and sk-private-key"}}
	hints := providerErrorFieldHints(payload)
	if !reflect.DeepEqual(hints, []string{"max_completion_tokens", "token", "invalid"}) {
		t.Fatalf("unexpected hints: %v", hints)
	}
	if strings.Contains(strings.Join(hints, " "), "private") {
		t.Fatal("provider content leaked into diagnostic hints")
	}
	if len(providerErrorFieldHints(map[string]any{"message": "secret only"})) != 0 {
		t.Fatal("unrecognized text became a diagnostic value")
	}
}
