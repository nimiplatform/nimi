package pagination

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestEncodeDecode_Roundtrip(t *testing.T) {
	token := Encode("cursor-123", "digest-abc")
	cursor, digest, err := Decode(token)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if cursor != "cursor-123" {
		t.Errorf("expected cursor cursor-123, got %s", cursor)
	}
	if digest != "digest-abc" {
		t.Errorf("expected digest digest-abc, got %s", digest)
	}
}

func TestDecode_EmptyToken(t *testing.T) {
	cursor, digest, err := Decode("")
	if err != nil {
		t.Fatalf("Decode empty: %v", err)
	}
	if cursor != "" || digest != "" {
		t.Errorf("expected empty cursor and digest, got %q %q", cursor, digest)
	}
}

func TestDecode_InvalidBase64(t *testing.T) {
	_, _, err := Decode("!!!invalid!!!")
	if err == nil {
		t.Fatal("expected error for invalid base64")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_PAGE_TOKEN_INVALID {
		t.Errorf("expected PAGE_TOKEN_INVALID, got %v (ok=%v)", reason, ok)
	}
}

func TestDecode_InvalidJSON(t *testing.T) {
	// Valid base64 but invalid JSON
	_, _, err := Decode("bm90anNvbg") // "notjson" in base64url
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_PAGE_TOKEN_INVALID {
		t.Errorf("expected PAGE_TOKEN_INVALID, got %v (ok=%v)", reason, ok)
	}
}

func TestValidatePageToken_MatchingDigest(t *testing.T) {
	digest := FilterDigest("kind", "local")
	token := Encode("cursor-5", digest)
	cursor, err := ValidatePageToken(token, digest)
	if err != nil {
		t.Fatalf("ValidatePageToken: %v", err)
	}
	if cursor != "cursor-5" {
		t.Errorf("expected cursor cursor-5, got %s", cursor)
	}
}

func TestValidatePageToken_MismatchedDigest(t *testing.T) {
	token := Encode("cursor-5", "old-digest")
	_, err := ValidatePageToken(token, "new-digest")
	if err == nil {
		t.Fatal("expected error for mismatched digest")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_PAGE_TOKEN_INVALID {
		t.Errorf("expected PAGE_TOKEN_INVALID, got %v (ok=%v)", reason, ok)
	}
}

func TestValidatePageToken_EmptyToken(t *testing.T) {
	cursor, err := ValidatePageToken("", "any-digest")
	if err != nil {
		t.Fatalf("ValidatePageToken empty: %v", err)
	}
	if cursor != "" {
		t.Errorf("expected empty cursor, got %s", cursor)
	}
}

func TestFilterDigest_Deterministic(t *testing.T) {
	d1 := FilterDigest("a", "b", "c")
	d2 := FilterDigest("a", "b", "c")
	if d1 != d2 {
		t.Errorf("expected deterministic digest, got %s != %s", d1, d2)
	}
	d3 := FilterDigest("a", "b")
	if d1 == d3 {
		t.Error("different inputs should produce different digests")
	}
}

func TestEncode_OpaqueFormat(t *testing.T) {
	token := Encode("123", "")
	// Token should not contain raw integers — it's opaque
	if token == "123" {
		t.Error("token should be opaque, not raw integer")
	}
}
