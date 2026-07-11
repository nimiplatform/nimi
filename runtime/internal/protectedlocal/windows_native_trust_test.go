package protectedlocal

import "testing"

func TestWindowsNativeSignerPolicyRequiresExactLowercaseSHA256(t *testing.T) {
	digest := "ab"
	for len(digest) < 64 {
		digest += "ab"
	}
	if _, err := decodeWindowsSignerCertSHA256(digest); err != nil {
		t.Fatalf("valid signer digest rejected: %v", err)
	}
	for _, invalid := range []string{"", "ab", digest[:63], digest + "00", "AB" + digest[2:]} {
		if _, err := decodeWindowsSignerCertSHA256(invalid); err == nil {
			t.Fatalf("invalid signer digest %q accepted", invalid)
		}
	}
}
