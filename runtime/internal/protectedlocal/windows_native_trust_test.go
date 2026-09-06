package protectedlocal

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"testing"
	"time"
)

func TestWindowsNativeSignerPolicyRequiresExactLowercaseSPKISHA256(t *testing.T) {
	digest := "ab"
	for len(digest) < 64 {
		digest += "ab"
	}
	if _, err := decodeWindowsSignerSPKISHA256(digest); err != nil {
		t.Fatalf("valid signer digest rejected: %v", err)
	}
	for _, invalid := range []string{"", "ab", digest[:63], digest + "00", "AB" + digest[2:]} {
		if _, err := decodeWindowsSignerSPKISHA256(invalid); err == nil {
			t.Fatalf("invalid signer digest %q accepted", invalid)
		}
	}
}

func TestWindowsSignerSPKIIdentitySurvivesCertificateReissueWithSameKey(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate signer key: %v", err)
	}
	now := time.Date(2026, time.September, 4, 0, 0, 0, 0, time.UTC)
	issue := func(serial int64, commonName string) []byte {
		t.Helper()
		template := &x509.Certificate{
			SerialNumber: big.NewInt(serial),
			Subject:      pkix.Name{CommonName: commonName},
			NotBefore:    now,
			NotAfter:     now.AddDate(1, 0, 0),
			KeyUsage:     x509.KeyUsageDigitalSignature,
			ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageCodeSigning},
		}
		encoded, createErr := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
		if createErr != nil {
			t.Fatalf("issue signer certificate: %v", createErr)
		}
		return encoded
	}

	first := issue(1, "Nimi release signer 1")
	second := issue(2, "Nimi release signer 2")
	if sha256.Sum256(first) == sha256.Sum256(second) {
		t.Fatal("test certificates unexpectedly have identical DER")
	}
	firstSPKI, err := windowsSignerSPKISHA256FromCertificateDER(first)
	if err != nil {
		t.Fatalf("hash first signer SPKI: %v", err)
	}
	secondSPKI, err := windowsSignerSPKISHA256FromCertificateDER(second)
	if err != nil {
		t.Fatalf("hash second signer SPKI: %v", err)
	}
	if firstSPKI != secondSPKI {
		t.Fatal("same public key produced different SPKI identities")
	}
	if _, err := windowsSignerSPKISHA256FromCertificateDER([]byte("not a certificate")); err == nil {
		t.Fatal("invalid certificate DER produced an SPKI identity")
	}
}
