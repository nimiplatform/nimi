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

func TestFirstMetadataOverride(t *testing.T) {
	if got := firstMetadataOverride(); got != nil {
		t.Fatalf("expected nil override")
	}
	overrides := &ClientMetadata{CallerID: "abc"}
	if got := firstMetadataOverride(overrides); got != overrides {
		t.Fatalf("override pointer mismatch")
	}
}

func firstMDValue(md metadata.MD, key string) string {
	values := md.Get(key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}
