package runtimeagent

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const sourceMaterializationTestPrivateKeyPEM = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDFMRcFGEgrdoru
HMfN9bdDGwXCbBV2uqlNht8scq4Oee+5GTods/8ZR7nAcVT7VFe7rsqcQDbSuTQe
tTj29jySzAiLZ8wt7vTTDsHreO4VfjFZw5F2ap81+OCip9GFnAYfZydaezlzWpRm
PMl4dYRfXG3xM13hiOf2aAF8fsYRqdhexBgHCAGJduZ6z5ohyvgxPigpXabbM0DI
3nPJxS7DuhidxOqX+NTSTZk7wEJoIuoBfiT/UIkkUDe6R6o9iEwO9ghzTPNmSLXN
85YbMHhucV5mwz2DX33eKEXJzeqSy20io1pTHHICJuaqZ7GVNxdwUXGltUiHz7zD
gwH9453LAgMBAAECggEAImF5PIOrzZwpA/QTqCbP0YzsF6ZlpaJM833w+lxyWYbM
E69A0T35W8yEJ/f6k6l0dH44yD5v8JSm8DWznWd4TzXwxXGPCXEw0X2wtOAMTsYG
T7rH6WgUo0Hl1KZC4zM9ZAtFssJqVWD1H9A4Zl7C+idw6c2FcFXA79bZb33hBeIT
Jv+Ovx3BEnUf9Z0hKsJY20mTcgHbpaseBGp2OsI2TChzFQFCpUGX4FbsyZHdqRp2
I1eN+1qjQMxZLANqwK3xesSKDmZhXq0YkJFm8X6WXIH3LXgLOn3reBQ7fk02stXU
+huV6VnayKgJBYyMQQvueswqtsK4vp1FD0xrnxRovQKBgQDtTkTNgzQuY/Vwj2kD
yzOEMGOBP1DoocMzm8o8hi7o4ilKqRnlg7AGMePVJbYfS2lE10kU4jQVYgNyidX0
qhlLVnklfPIcrUmR/o7GomKxZ1OG6Q7Qmw+14sI4VNAQnSIjdxTYZEzhsA3lg4kA
RckeSr5U3EBSE1ty/qXylatD9QKBgQDUudhGRtUWHmNUOsx5gbgX3/SLv1ofjAkZ
xDS+SdEPWkAzVcsN5RW77pL8kRzlOL/66NyMZvxg3NLy6Gbks2CdqAgZICDt7paB
7Qj8tT/RPe6WYuSzpcHOucXLcVLrbCfaPrGl2/OqNVW86DzfXBVuifbG0v3DBNNg
1/mBAcQCvwKBgQCr++Kfcyx5RpaWGkmIp1dRwWQMQuAXiU0YdRsP3EvZGjfE1WNg
VJ1ZEAVH8AnbCmNjsgdULFCFAsDu3PiEVlb4o9YvFiu+HtTIC05cpUmTuwftKbFD
/G1Za9tIyib1M3yPaXlhDugtVNPtd/Ptj6Yf3xmsFOhE06SeZfHNKy2xlQKBgQCx
asqhWkQwLWoEfwG4uWLTrrpjr1U4CHAyqDyhFCmjl08CQaSX0x98XS8ELPcfimQ7
nOkMxHvrQWFCrGfciGqlMtaGNhCgwKOQeyRKt9Qg7HlHvfUmi7GHe9MmqT5SESNv
12gMf9TKea8nXb4fP8q0JabHDoQMmcK9+4MhgFp9OwKBgQCXU6Z4fzGOZEUsRVKj
GxCNOE7NxRX9HqCTkWitiAf5WHml3rOGl+lspmLRVPigwYu2wkXhrlT7AzcqHO66
U+qGEl4IXDLMzmt5ruWvdvEotTj8iA6m29DhdkzpDiXwky6lReJgPILiCJehuTJb
B1AY9ySKWD3COR3uOf4/yjbk8w==
-----END PRIVATE KEY-----`

type sourceMaterializationTestJWKSProvider struct {
	documents []sourceMaterializationJWKSDocument
	calls     []bool
}

func (provider *sourceMaterializationTestJWKSProvider) SourceMaterializationJWKS(_ context.Context, _ string, refresh bool) (sourceMaterializationJWKSDocument, error) {
	provider.calls = append(provider.calls, refresh)
	index := len(provider.calls) - 1
	if index >= len(provider.documents) {
		index = len(provider.documents) - 1
	}
	return provider.documents[index], nil
}

func sourceMaterializationTestPrivateKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	block, _ := pem.Decode([]byte(sourceMaterializationTestPrivateKeyPEM))
	if block == nil {
		t.Fatal("decode deterministic RSA fixture")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("parse deterministic RSA fixture: %v", err)
	}
	return key.(*rsa.PrivateKey)
}

func sourceMaterializationTestJWK(t *testing.T, kid string) sourceMaterializationJWK {
	t.Helper()
	publicKey := sourceMaterializationTestPrivateKey(t).PublicKey
	exponent := []byte{byte(publicKey.E >> 16), byte(publicKey.E >> 8), byte(publicKey.E)}
	for len(exponent) > 1 && exponent[0] == 0 {
		exponent = exponent[1:]
	}
	return sourceMaterializationJWK{
		KeyID: kid, Use: "sig", Algorithm: "RS256", KeyType: "RSA",
		Modulus: base64.RawURLEncoding.EncodeToString(publicKey.N.Bytes()), Exponent: base64.RawURLEncoding.EncodeToString(exponent),
		Purpose: sourceMaterializationKeyPurpose,
	}
}

func sourceMaterializationTestProof(t *testing.T, kid string, packetHash string, extraHeader bool) string {
	t.Helper()
	header := map[string]any{"alg": "RS256", "kid": kid, "typ": sourceMaterializationKeyPurpose}
	if extraHeader {
		header["jku"] = "https://attacker.invalid/jwks"
	}
	headerJSON, err := canonicalizeSourceMaterializationJCS(header)
	if err != nil {
		t.Fatal(err)
	}
	headerEncoded := base64.RawURLEncoding.EncodeToString(headerJSON)
	payloadEncoded := base64.RawURLEncoding.EncodeToString([]byte(sourceMaterializationProofDomain + packetHash))
	digest := sha256.Sum256([]byte(headerEncoded + "." + payloadEncoded))
	signature, err := rsa.SignPKCS1v15(nil, sourceMaterializationTestPrivateKey(t), crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("sign deterministic proof: %v", err)
	}
	return headerEncoded + ".." + base64.RawURLEncoding.EncodeToString(signature)
}

func TestSourceMaterializationDetachedRS256ProofAndBoundedRefresh(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 7, 10, 5, 0, 0, 0, time.UTC)
	packetHash := strings.Repeat("a", 64)
	envelope := sourceMaterializationPacketEnvelopeV2{Issuer: "https://realm.test", KeyID: "materialization-key-1"}
	key := sourceMaterializationTestJWK(t, envelope.KeyID)
	provider := &sourceMaterializationTestJWKSProvider{documents: []sourceMaterializationJWKSDocument{
		{Issuer: envelope.Issuer, Keys: []sourceMaterializationJWK{}},
		{Issuer: envelope.Issuer, Keys: []sourceMaterializationJWK{key}},
	}}
	fingerprint, err := verifySourceMaterializationDetachedProof(context.Background(), provider, envelope, packetHash, sourceMaterializationTestProof(t, key.KeyID, packetHash, false), now)
	if err != nil {
		t.Fatalf("verifySourceMaterializationDetachedProof: %v", err)
	}
	if !isLowerSHA256(fingerprint) {
		t.Fatalf("fingerprint = %q", fingerprint)
	}
	if len(provider.calls) != 2 || provider.calls[0] || !provider.calls[1] {
		t.Fatalf("refresh calls = %#v", provider.calls)
	}
}

func TestSourceMaterializationDetachedProofFailsClosedWithoutRefreshForKnownInvalidKey(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 7, 10, 5, 0, 0, 0, time.UTC)
	packetHash := strings.Repeat("b", 64)
	envelope := sourceMaterializationPacketEnvelopeV2{Issuer: "https://realm.test", KeyID: "materialization-key-1"}
	for name, mutate := range map[string]func(*sourceMaterializationJWK){
		"wrong purpose":   func(key *sourceMaterializationJWK) { key.Purpose = "jwt" },
		"wrong algorithm": func(key *sourceMaterializationJWK) { key.Algorithm = "HS256" },
		"wrong use":       func(key *sourceMaterializationJWK) { key.Use = "enc" },
		"wrong key type":  func(key *sourceMaterializationJWK) { key.KeyType = "EC" },
		"revoked":         func(key *sourceMaterializationJWK) { key.revoked = true },
	} {
		t.Run(name, func(t *testing.T) {
			key := sourceMaterializationTestJWK(t, envelope.KeyID)
			mutate(&key)
			provider := &sourceMaterializationTestJWKSProvider{documents: []sourceMaterializationJWKSDocument{{Issuer: envelope.Issuer, Keys: []sourceMaterializationJWK{key}}}}
			if _, err := verifySourceMaterializationDetachedProof(context.Background(), provider, envelope, packetHash, sourceMaterializationTestProof(t, key.KeyID, packetHash, false), now); err == nil {
				t.Fatal("invalid key was admitted")
			}
			if len(provider.calls) != 1 {
				t.Fatalf("invalid known key caused refresh: %#v", provider.calls)
			}
		})
	}
	provider := &sourceMaterializationTestJWKSProvider{documents: []sourceMaterializationJWKSDocument{{Issuer: envelope.Issuer, Keys: []sourceMaterializationJWK{sourceMaterializationTestJWK(t, envelope.KeyID)}}}}
	if _, err := verifySourceMaterializationDetachedProof(context.Background(), provider, envelope, packetHash, sourceMaterializationTestProof(t, envelope.KeyID, packetHash, true), now); err == nil {
		t.Fatal("open protected header was admitted")
	}
	removed := &sourceMaterializationTestJWKSProvider{documents: []sourceMaterializationJWKSDocument{{Issuer: envelope.Issuer, Keys: []sourceMaterializationJWK{}}, {Issuer: envelope.Issuer, Keys: []sourceMaterializationJWK{}}}}
	if _, err := verifySourceMaterializationDetachedProof(context.Background(), removed, envelope, packetHash, sourceMaterializationTestProof(t, envelope.KeyID, packetHash, false), now); err == nil {
		t.Fatal("removed key was admitted")
	}
	if len(removed.calls) != 2 || removed.calls[0] || !removed.calls[1] {
		t.Fatalf("removed-key refresh was not exactly bounded: %#v", removed.calls)
	}
}

func TestSourceMaterializationVerifierConstructorFailsClosed(t *testing.T) {
	t.Parallel()
	fetcher := func(context.Context, string, bool) ([]byte, error) { return []byte(`{"keys":[]}`), nil }
	for _, test := range []struct{ name, issuer, endpoint string }{
		{"missing issuer", "", "https://realm.test" + sourceMaterializationJWKSPath},
		{"wrong path", "https://realm.test", "https://realm.test/.well-known/jwks.json"},
		{"insecure remote", "https://realm.test", "http://realm.test" + sourceMaterializationJWKSPath},
		{"query injection", "https://realm.test", "https://realm.test" + sourceMaterializationJWKSPath + "?target=other"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := newSourceMaterializationAdmissionVerifierWithFetcher(test.issuer, test.endpoint, fetcher); err == nil {
				t.Fatal("invalid verifier configuration was admitted")
			}
		})
	}
}

func TestSourceMaterializationJWKSHTTPIsFreshBoundedAndJSONOnly(t *testing.T) {
	t.Parallel()
	key := sourceMaterializationTestJWK(t, "materialization-key-1")
	var cacheControl, pragma string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		cacheControl = request.Header.Get("Cache-Control")
		pragma = request.Header.Get("Pragma")
		response.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(response).Encode(sourceMaterializationJWKSDocument{Keys: []sourceMaterializationJWK{key}})
	}))
	defer server.Close()
	verifier, err := NewSourceMaterializationAdmissionVerifier("https://realm.test", server.URL+sourceMaterializationJWKSPath, server.Client())
	if err != nil {
		t.Fatalf("newSourceMaterializationV2Verifier: %v", err)
	}
	document, err := verifier.SourceMaterializationJWKS(context.Background(), "https://realm.test", false)
	if err != nil {
		t.Fatalf("SourceMaterializationJWKS: %v", err)
	}
	if len(document.Keys) != 1 || cacheControl != "no-cache, no-store" || pragma != "no-cache" {
		t.Fatalf("fresh JWKS contract: keys=%d cache=%q pragma=%q", len(document.Keys), cacheControl, pragma)
	}

	bad := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "text/html")
		_, _ = response.Write([]byte(`{"keys":[]}`))
	}))
	defer bad.Close()
	badVerifier, err := NewSourceMaterializationAdmissionVerifier("https://realm.test", bad.URL+sourceMaterializationJWKSPath, bad.Client())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := badVerifier.SourceMaterializationJWKS(context.Background(), "https://realm.test", false); err == nil {
		t.Fatal("non-JSON JWKS content type was admitted")
	}
}
