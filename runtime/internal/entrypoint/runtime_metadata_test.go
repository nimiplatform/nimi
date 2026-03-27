package entrypoint

import (
	"context"
	"testing"

	"google.golang.org/grpc/metadata"
)

func TestWithNimiOutgoingMetadataDefault(t *testing.T) {
	ctx := withNimiOutgoingMetadata(context.Background(), "nimi.desktop", nil)
	md, ok := metadata.FromOutgoingContext(ctx)
	if !ok {
		t.Fatalf("outgoing metadata missing")
	}
	if got := firstMDValue(md, "x-nimi-caller-kind"); got != cliCallerKind {
		t.Fatalf("caller kind mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-caller-id"); got != cliCallerID {
		t.Fatalf("caller id mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-surface-id"); got != cliSurfaceID {
		t.Fatalf("surface id mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-app-id"); got != "nimi.desktop" {
		t.Fatalf("app id mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-trace-id"); got != "" {
		t.Fatalf("trace id should be empty by default, got=%q", got)
	}
	if got := firstMDValue(md, "x-nimi-key-source"); got != "" {
		t.Fatalf("key source should be omitted by default, got=%q", got)
	}
}

func TestWithNimiOutgoingMetadataOverride(t *testing.T) {
	ctx := withNimiOutgoingMetadata(context.Background(), "nimi.desktop", &ClientMetadata{
		CallerKind:   "third-party-app",
		CallerID:     "app:novelizer",
		SurfaceID:    "chat-export",
		TraceID:      "trace-123",
		ProviderType: "gemini",
	})
	md, ok := metadata.FromOutgoingContext(ctx)
	if !ok {
		t.Fatalf("outgoing metadata missing")
	}
	if got := firstMDValue(md, "x-nimi-caller-kind"); got != "third-party-app" {
		t.Fatalf("caller kind mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-caller-id"); got != "app:novelizer" {
		t.Fatalf("caller id mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-surface-id"); got != "chat-export" {
		t.Fatalf("surface id mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-trace-id"); got != "trace-123" {
		t.Fatalf("trace id mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-provider-type"); got != "gemini" {
		t.Fatalf("provider type mismatch: %q", got)
	}
}

func TestWithNimiOutgoingMetadataOverrideAllSupportedFields(t *testing.T) {
	ctx := withNimiOutgoingMetadata(context.Background(), "nimi.desktop", &ClientMetadata{
		ProtocolVersion:            "2026-03",
		ParticipantProtocolVersion: "2026-03-client",
		ParticipantID:              "participant-1",
		Domain:                     "workflow",
		IdempotencyKey:             "idem-123",
		CallerKind:                 "third-party-app",
		CallerID:                   "app:novelizer",
		SurfaceID:                  "chat-export",
		TraceID:                    "trace-123",
		CredentialSource:           "  INLINE  ",
		ProviderType:               "gemini",
		ProviderEndpoint:           "https://example.invalid/v1",
		ProviderAPIKey:             "sk-test",
		AccessTokenID:              "token-1",
		AccessTokenSecret:          "secret-1",
		SessionID:                  "session-1",
		SessionToken:               "session-token-1",
	})
	md, ok := metadata.FromOutgoingContext(ctx)
	if !ok {
		t.Fatalf("outgoing metadata missing")
	}
	if got := firstMDValue(md, "x-nimi-protocol-version"); got != "2026-03" {
		t.Fatalf("protocol version mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-participant-protocol-version"); got != "2026-03-client" {
		t.Fatalf("participant protocol version mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-participant-id"); got != "participant-1" {
		t.Fatalf("participant id mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-domain"); got != "workflow" {
		t.Fatalf("domain mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-idempotency-key"); got != "idem-123" {
		t.Fatalf("idempotency key mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-key-source"); got != "inline" {
		t.Fatalf("credential source mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-provider-endpoint"); got != "https://example.invalid/v1" {
		t.Fatalf("provider endpoint mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-provider-api-key"); got != "sk-test" {
		t.Fatalf("provider api key mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-access-token-id"); got != "token-1" {
		t.Fatalf("access token id mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-access-token-secret"); got != "secret-1" {
		t.Fatalf("access token secret mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-session-id"); got != "session-1" {
		t.Fatalf("session id mismatch: %q", got)
	}
	if got := firstMDValue(md, "x-nimi-session-token"); got != "session-token-1" {
		t.Fatalf("session token mismatch: %q", got)
	}
}

func TestFirstMetadataOverride(t *testing.T) {
	if got := firstMetadataOverride(); got != nil {
		t.Fatalf("expected nil override")
	}
	overrides := &ClientMetadata{CallerID: "abc"}
	if got := firstMetadataOverride(overrides); got != overrides {
		t.Fatalf("override pointer mismatch")
	}
}

func TestInsecureGRPCTargetIsLocal(t *testing.T) {
	tests := []struct {
		addr string
		want bool
	}{
		{addr: "127.0.0.1:50051", want: true},
		{addr: "localhost:50051", want: true},
		{addr: "[::1]:50051", want: true},
		{addr: "dns:///localhost:50051", want: true},
		{addr: "unix:///tmp/nimi-runtime.sock", want: true},
		{addr: "192.168.1.44:50051", want: false},
		{addr: "grpc.example.com:50051", want: false},
	}
	for _, tt := range tests {
		if got := insecureGRPCTargetIsLocal(tt.addr); got != tt.want {
			t.Fatalf("insecureGRPCTargetIsLocal(%q) = %v, want %v", tt.addr, got, tt.want)
		}
	}
}

func TestPrepareInsecureOutgoingContextRejectsProviderKeyOnNonLoopback(t *testing.T) {
	_, err := prepareInsecureOutgoingContext(context.Background(), "grpc.example.com:50051", "nimi.desktop", &ClientMetadata{
		ProviderAPIKey: "sk-test",
	})
	if err == nil {
		t.Fatal("expected non-loopback insecure target to be rejected")
	}
	if err.Error() != "provider_api_key requires loopback or unix gRPC target when using insecure transport" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPrepareInsecureOutgoingContextAllowsProviderKeyOnLoopback(t *testing.T) {
	ctx, err := prepareInsecureOutgoingContext(context.Background(), "127.0.0.1:50051", "nimi.desktop", &ClientMetadata{
		ProviderAPIKey: "sk-test",
	})
	if err != nil {
		t.Fatalf("prepareInsecureOutgoingContext: %v", err)
	}
	md, ok := metadata.FromOutgoingContext(ctx)
	if !ok {
		t.Fatalf("outgoing metadata missing")
	}
	if got := firstMDValue(md, "x-nimi-provider-api-key"); got != "sk-test" {
		t.Fatalf("provider api key mismatch: %q", got)
	}
}

func firstMDValue(md metadata.MD, key string) string {
	values := md.Get(key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}
