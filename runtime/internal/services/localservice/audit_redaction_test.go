package localservice

import (
	"testing"

	"google.golang.org/protobuf/types/known/structpb"
)

func TestMaskLocalAuditFieldsUsesRuntimeAuditRedactionContract(t *testing.T) {
	fields := map[string]*structpb.Value{
		"api_key":         structpb.NewStringValue("12345678"),
		"parent_token_id": structpb.NewStringValue("parent-token-1"),
		"nested": structpb.NewStructValue(&structpb.Struct{Fields: map[string]*structpb.Value{
			"refresh_token": structpb.NewStringValue("abcdefghijklmnop"),
		}}),
	}

	maskLocalAuditFields(fields)

	if got := fields["api_key"].GetStringValue(); got != "1234***5678" {
		t.Fatalf("api_key masked = %q", got)
	}
	if got := fields["parent_token_id"].GetStringValue(); got != "parent-token-1" {
		t.Fatalf("parent_token_id should be exempt, got %q", got)
	}
	nested := fields["nested"].GetStructValue().GetFields()
	if got := nested["refresh_token"].GetStringValue(); got != "abcd***mnop" {
		t.Fatalf("nested refresh_token masked = %q", got)
	}
}
