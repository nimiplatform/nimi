package riskcontrol

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"math/big"
	"strings"
	"testing"
)

func TestCompleteRules(t *testing.T) {
	d := New()
	_, ed, _ := ed25519.GenerateKey(rand.Reader)
	ec, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pkcs8, _ := x509.MarshalPKCS8PrivateKey(ed)
	sec1, _ := x509.MarshalECPrivateKey(ec)
	for kind, der := range map[string][]byte{"PRIVATE KEY": pkcs8, "EC PRIVATE KEY": sec1, "RSA PRIVATE KEY": x509.MarshalPKCS1PrivateKey(rsaKey)} {
		value := string(pem.EncodeToMemory(&pem.Block{Type: kind, Bytes: der}))
		if d.Text("legitimate local analysis:\n"+value) != PrivateKeyRule {
			t.Errorf("missed %s", kind)
		}
	}
	pub, _ := x509.MarshalPKIXPublicKey(ed.Public())
	cert, err := x509.CreateCertificate(rand.Reader, &x509.Certificate{SerialNumber: big.NewInt(1)}, &x509.Certificate{SerialNumber: big.NewInt(1)}, ed.Public(), ed)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{
		"", "token: string", "password: <redacted>", "token = null", "Bearer example", "approved: true",
		strings.Repeat("a", 64), "AKIA" + strings.Repeat("A", 16), "https://example.test/?X-Amz-Signature=" + strings.Repeat("a", 64),
		"-----BEGIN PRIVATE KEY-----", "-----BEGIN PRIVATE KEY-----\n<redacted>\n-----END PRIVATE KEY-----",
		string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub})),
		string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert})),
		"ghp_<redacted>", "ghp_" + strings.Repeat("_", 36),
	} {
		if rule := d.Text(value); rule != "" {
			t.Errorf("normal content matched %s", rule)
		}
	}
}

func TestIncrementalBoundaries(t *testing.T) {
	token := "ghp_" + strings.Repeat("aB3", 12) // Synthetic format, no issued credential.
	for _, split := range []int{1, 4, 21, 39, 40} {
		var s Stream
		if s.Feed(token[:split]) != "" || s.Feed(token[split:]) != "" {
			t.Fatal("chunk end became value end")
		}
		if s.Finish() != TokenRule {
			t.Fatal("empty logical completion missed candidate")
		}
	}
	for _, suffix := range []string{"x", "_", "中"} {
		var s Stream
		s.Feed(token)
		if s.Feed(suffix+" ") != "" || s.Finish() != "" {
			t.Fatal("long identifier blocked")
		}
	}
	var s Stream
	s.Feed(strings.Repeat("x", 1000000))
	if s.Feed(token+" ") != "" {
		t.Fatal("truncation invented left boundary")
	}
	if s.Feed(token+".") != TokenRule {
		t.Fatal("real delimiter did not match")
	}
	var a, b Stream
	a.Feed(token[:20])
	b.Feed(token[20:])
	if a.Finish() != "" || b.Finish() != "" {
		t.Fatal("independent values joined")
	}
}

func BenchmarkText(b *testing.B) {
	text := strings.Repeat("ordinary text token: string; password: <redacted> 中文\n", 2048)
	d := New()
	b.SetBytes(int64(len(text)))
	b.ReportAllocs()
	for b.Loop() {
		d.Text(text)
	}
}

func BenchmarkIncremental(b *testing.B) {
	text := strings.Repeat("normal streaming text ", 64)
	b.SetBytes(int64(len(text)))
	b.ReportAllocs()
	var s Stream
	for b.Loop() {
		s.Feed(text)
	}
}
