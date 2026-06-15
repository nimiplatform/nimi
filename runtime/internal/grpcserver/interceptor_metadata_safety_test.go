package grpcserver

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
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

func TestStreamCredentialScrubAndAuditPreserveAuthzContextAddedDuringRecv(t *testing.T) {
	authorizer := &authzTestAuthorizer{allow: true, reason: runtimev1.ReasonCode_ACTION_EXECUTED}
	interceptor := chainStreamInterceptors(
		newStreamAuthzInterceptor(authorizer),
		newStreamCredentialScrubInterceptor(),
		newStreamAuditInterceptor(auditlog.New(8, 8)),
	)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-access-token-id", "tok-chat-1",
		"x-nimi-access-token-secret", "sec-chat-1",
		"x-nimi-key-source", "inline",
		"x-nimi-provider-endpoint", "https://api.openai.com",
		"x-nimi-provider-api-key", "sk-test",
	))
	stream := &authzTestStream{
		ctx: ctx,
		requests: []proto.Message{
			&runtimev1.SubscribeAppMessagesRequest{
				AppId:      "nimi.avatar",
				FromAppIds: []string{"runtime.agent"},
			},
		},
	}
	info := &grpc.StreamServerInfo{
		FullMethod:     "/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages",
		IsServerStream: true,
	}

	err := interceptor(nil, stream, info, func(_ any, ss grpc.ServerStream) error {
		var got runtimev1.SubscribeAppMessagesRequest
		if err := ss.RecvMsg(&got); err != nil {
			return err
		}
		if !envelope.HasValidatedProtectedCapability(ss.Context(), "nimi.avatar", "runtime.agent.turn.read") {
			t.Fatal("expected scrubbed stream context to retain validated protected capability")
		}
		md, ok := metadata.FromIncomingContext(ss.Context())
		if !ok {
			t.Fatal("expected incoming metadata in scrubbed stream context")
		}
		if got := firstMetadata(md, "x-nimi-provider-api-key"); got != "" {
			t.Fatalf("expected raw provider api key to be scrubbed, got %q", got)
		}
		credentialMeta, parseErr := envelope.ParseCredentialMetadataFromContext(ss.Context())
		if parseErr != nil {
			t.Fatalf("parse scrubbed credential metadata: %v", parseErr)
		}
		if credentialMeta.APIKey != "sk-test" {
			t.Fatalf("expected scrubbed credential api key to remain available privately, got %q", credentialMeta.APIKey)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("interceptor returned error: %v", err)
	}
}
