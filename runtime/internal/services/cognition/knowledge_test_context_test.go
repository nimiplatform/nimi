package cognition

import (
	"context"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/metadata"
)

func testKnowledgeEnvelopeContext(appID string) context.Context {
	appID = strings.TrimSpace(appID)
	ctx := envelope.WithMetadata(context.Background(), envelope.Metadata{
		AppID:         appID,
		AppInstanceID: testKnowledgeAppInstanceID(appID),
	})
	return withTestKnowledgeAuthorization(ctx, appID, "acct-1")
}

func withTestKnowledgeAuthorization(ctx context.Context, appID string, accountID string) context.Context {
	appID = strings.TrimSpace(appID)
	ctx = authn.WithIdentity(ctx, &authn.Identity{SubjectUserID: strings.TrimSpace(accountID)})
	for _, capability := range []string{
		"runtime.memory.admin",
		"runtime.memory.read",
		"runtime.memory.write",
		"runtime.knowledge.admin",
		"runtime.knowledge.read",
		"runtime.knowledge.write",
	} {
		ctx = envelope.WithValidatedProtectedCapability(ctx, appID, capability)
	}
	return ctx
}

func testKnowledgeGRPCContext(appID string) context.Context {
	appID = strings.TrimSpace(appID)
	return metadata.NewOutgoingContext(context.Background(), metadata.Pairs(
		"x-nimi-protocol-version", envelope.PlatformProtocolVersion,
		"x-nimi-participant-protocol-version", envelope.PlatformProtocolVersion,
		"x-nimi-participant-id", "cognition-test-participant",
		"x-nimi-domain", "runtime.knowledge",
		"x-nimi-app-id", appID,
		"x-nimi-app-instance-id", testKnowledgeAppInstanceID(appID),
	))
}

func testKnowledgeAppInstanceID(appID string) string {
	appID = strings.TrimSpace(appID)
	if appID == "" {
		return ""
	}
	return appID + ".instance"
}
