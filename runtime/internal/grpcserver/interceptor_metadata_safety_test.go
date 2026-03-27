package grpcserver

import (
	"context"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

func TestUnaryCredentialScrubInterceptorRemovesRawAPIKeyFromMetadata(t *testing.T) {
	interceptor := newUnaryCredentialScrubInterceptor()
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-key-source", "inline",
		"x-nimi-provider-endpoint", "https://api.openai.com",
		"x-nimi-provider-api-key", "sk-test",
	))

	_, err := interceptor(ctx, struct{}{}, &grpc.UnaryServerInfo{}, func(nextCtx context.Context, _ any) (any, error) {
		md, ok := metadata.FromIncomingContext(nextCtx)
		if !ok {
			t.Fatal("expected incoming metadata in downstream context")
		}
		if got := firstMetadata(md, "x-nimi-provider-api-key"); got != "" {
			t.Fatalf("expected raw provider api key to be scrubbed, got %q", got)
		}

		credentialMeta, parseErr := envelope.ParseCredentialMetadataFromContext(nextCtx)
		if parseErr != nil {
			t.Fatalf("parse scrubbed credential metadata: %v", parseErr)
		}
		if credentialMeta.APIKey != "sk-test" {
			t.Fatalf("expected scrubbed credential api key to remain available privately, got %q", credentialMeta.APIKey)
		}
		return struct{}{}, nil
	})
	if err != nil {
		t.Fatalf("interceptor returned error: %v", err)
	}
}

func TestProviderCredentialMetadataUsesScrubbedCredentialContext(t *testing.T) {
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-key-source", "inline",
		"x-nimi-provider-endpoint", "https://api.openai.com",
		"x-nimi-provider-api-key", "sk-test",
	))

	source, endpoint, fingerprint := providerCredentialMetadata(envelope.ScrubIncomingCredentialMetadata(ctx))
	if source != "inline" {
		t.Fatalf("source mismatch: %q", source)
	}
	if endpoint != "https://api.openai.com" {
		t.Fatalf("endpoint mismatch: %q", endpoint)
	}
	if fingerprint == "" {
		t.Fatal("expected non-empty api key fingerprint")
	}
}
