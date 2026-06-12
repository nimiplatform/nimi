package cognition

import (
	"context"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/metadata"
)

func testKnowledgeEnvelopeContext(appID string) context.Context {
	appID = strings.TrimSpace(appID)
	return envelope.WithMetadata(context.Background(), envelope.Metadata{
		AppID:         appID,
		AppInstanceID: testKnowledgeAppInstanceID(appID),
	})
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
