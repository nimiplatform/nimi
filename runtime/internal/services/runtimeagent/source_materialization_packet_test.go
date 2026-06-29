package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestSourceMaterializationCanonicalHashMatchesForgeVector(t *testing.T) {
	t.Parallel()

	hash, err := hashCanonicalJSON(map[string]any{
		"b": float64(2),
		"a": map[string]any{
			"y": true,
			"x": []any{"z"},
		},
	})
	if err != nil {
		t.Fatalf("hashCanonicalJSON: %v", err)
	}
	if hash != "e3431fd26fd4f62fd6d0957200a753ea3cc464e9798f50013e2b0d5f4f06f329" {
		t.Fatalf("canonical hash mismatch: %s", hash)
	}
}

func TestInitializeAgentConsumesSourceMaterializationPacketWithoutPersistingPayload(t *testing.T) {
	t.Setenv(sourceMaterializationHMACSecretEnv, "unit-test-source-packet-secret")
	svc := newRuntimeAgentTestService(t)
	ownerID := "user-source"
	runtimeSourceRef := "runtime-source:worldCharacter:world-1:source-1:hash-1"
	packet := testSourceMaterializationPacket(t, ownerID, runtimeSourceRef, "nonce-1", time.Now().UTC().Add(5*time.Minute), sourceMaterializationAudienceDesktop)
	metadata := testSourceMaterializationMetadata(t, packet)

	resp, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId:            "runtime-agent-source-packet-test",
			SubjectUserId:    ownerID,
			OwnerUserId:      ownerID,
			RuntimeSourceRef: runtimeSourceRef,
		},
		OwnerUserId:      ownerID,
		RuntimeSourceRef: runtimeSourceRef,
		DisplayName:      "Source Fork",
		Metadata:         metadata,
	})
	if err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	fields := resp.GetAgent().GetMetadata().GetFields()
	if fields[sourceMaterializationPacketMetadataKey] != nil {
		t.Fatalf("packet payload persisted in agent metadata: %#v", fields[sourceMaterializationPacketMetadataKey])
	}
	sourceMaterialization := fields[sourceMaterializationMetadataKey].GetStructValue()
	if sourceMaterialization == nil {
		t.Fatalf("source materialization provenance missing: %#v", fields)
	}
	if got := sourceMaterialization.GetFields()["packetHash"].GetStringValue(); got != packet["packetHash"] {
		t.Fatalf("packetHash provenance = %q, want %q", got, packet["packetHash"])
	}
	if got := sourceMaterialization.GetFields()["runtimeSourceRef"].GetStringValue(); got != runtimeSourceRef {
		t.Fatalf("runtimeSourceRef provenance = %q, want %q", got, runtimeSourceRef)
	}
}

func TestInitializeAgentGeneratesOpaqueLocalAgentRefForSourceMaterialization(t *testing.T) {
	t.Setenv(sourceMaterializationHMACSecretEnv, "unit-test-source-packet-secret")
	svc := newRuntimeAgentTestService(t)
	ownerID := "user-source"
	runtimeSourceRef := "runtime-source:worldCharacter:world-1:source-1:hash-1"
	packet := testSourceMaterializationPacket(t, ownerID, runtimeSourceRef, "nonce-runtime-generated-local-agent", time.Now().UTC().Add(5*time.Minute), sourceMaterializationAudienceDesktop)

	resp, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId:            "runtime-agent-source-packet-test",
			SubjectUserId:    ownerID,
			OwnerUserId:      ownerID,
			RuntimeSourceRef: runtimeSourceRef,
		},
		OwnerUserId:      ownerID,
		RuntimeSourceRef: runtimeSourceRef,
		DisplayName:      "Runtime Generated Source Fork",
		Metadata:         testSourceMaterializationMetadata(t, packet),
	})
	if err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	localAgentRef := resp.GetAgent().GetLocalAgentRef()
	if !strings.HasPrefix(localAgentRef, localAgentRefPrefix) {
		t.Fatalf("localAgentRef = %q, want Runtime local-agent prefix", localAgentRef)
	}
	if localAgentRef == runtimeSourceRef || strings.Contains(localAgentRef, ownerID) || strings.Contains(localAgentRef, runtimeSourceRef) {
		t.Fatalf("localAgentRef is not opaque: %q", localAgentRef)
	}
	if resp.GetAgent().GetAgentId() != localAgentRef {
		t.Fatalf("agent id = %q, want localAgentRef %q", resp.GetAgent().GetAgentId(), localAgentRef)
	}
}

func TestInitializeAgentRejectsCallerAuthoredLocalAgentRefForSourceMaterialization(t *testing.T) {
	t.Setenv(sourceMaterializationHMACSecretEnv, "unit-test-source-packet-secret")
	svc := newRuntimeAgentTestService(t)
	ownerID := "user-source"
	runtimeSourceRef := "runtime-source:worldCharacter:world-1:source-1:hash-1"
	packet := testSourceMaterializationPacket(t, ownerID, runtimeSourceRef, "nonce-caller-authored-local-ref", time.Now().UTC().Add(5*time.Minute), sourceMaterializationAudienceDesktop)

	_, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:          testSourceMaterializationContext(ownerID, runtimeSourceRef, "local-agent:caller-authored-source-1"),
		LocalAgentRef:    "local-agent:caller-authored-source-1",
		OwnerUserId:      ownerID,
		RuntimeSourceRef: runtimeSourceRef,
		DisplayName:      "Caller Authored Source Fork",
		Metadata:         testSourceMaterializationMetadata(t, packet),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status.Code = %s, want %s (%v)", status.Code(err), codes.InvalidArgument, err)
	}
}

func TestInitializeAgentRejectsForgedSourceMaterializationPacketProof(t *testing.T) {
	t.Setenv(sourceMaterializationHMACSecretEnv, "unit-test-source-packet-secret")
	svc := newRuntimeAgentTestService(t)
	ownerID := "user-source"
	runtimeSourceRef := "runtime-source:worldCharacter:world-1:source-1:hash-1"
	packet := testSourceMaterializationPacket(t, ownerID, runtimeSourceRef, "nonce-forged", time.Now().UTC().Add(5*time.Minute), sourceMaterializationAudienceDesktop)
	packet["packetProof"] = "hmac-sha256:forged"

	_, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:          testSourceMaterializationContext(ownerID, runtimeSourceRef, ""),
		OwnerUserId:      ownerID,
		RuntimeSourceRef: runtimeSourceRef,
		DisplayName:      "Forged Source Fork",
		Metadata:         testSourceMaterializationMetadata(t, packet),
	})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("status.Code = %s, want %s (%v)", status.Code(err), codes.PermissionDenied, err)
	}
}

func TestInitializeAgentRejectsSourceMaterializationPacketReplay(t *testing.T) {
	t.Setenv(sourceMaterializationHMACSecretEnv, "unit-test-source-packet-secret")
	svc := newRuntimeAgentTestService(t)
	ownerID := "user-source"
	runtimeSourceRef := "runtime-source:worldCharacter:world-1:source-1:hash-1"
	packet := testSourceMaterializationPacket(t, ownerID, runtimeSourceRef, "nonce-replay", time.Now().UTC().Add(5*time.Minute), sourceMaterializationAudienceDesktop)

	if _, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:          testSourceMaterializationContext(ownerID, runtimeSourceRef, ""),
		OwnerUserId:      ownerID,
		RuntimeSourceRef: runtimeSourceRef,
		DisplayName:      "Replay Source Fork A",
		Metadata:         testSourceMaterializationMetadata(t, packet),
	}); err != nil {
		t.Fatalf("first InitializeAgent: %v", err)
	}

	_, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:          testSourceMaterializationContext(ownerID, runtimeSourceRef, ""),
		OwnerUserId:      ownerID,
		RuntimeSourceRef: runtimeSourceRef,
		DisplayName:      "Replay Source Fork B",
		Metadata:         testSourceMaterializationMetadata(t, packet),
	})
	if status.Code(err) != codes.AlreadyExists {
		t.Fatalf("status.Code = %s, want %s (%v)", status.Code(err), codes.AlreadyExists, err)
	}
}

func TestInitializeAgentRejectsExpiredSourceMaterializationPacket(t *testing.T) {
	t.Setenv(sourceMaterializationHMACSecretEnv, "unit-test-source-packet-secret")
	svc := newRuntimeAgentTestService(t)
	ownerID := "user-source"
	runtimeSourceRef := "runtime-source:worldCharacter:world-1:source-1:hash-1"
	packet := testSourceMaterializationPacket(t, ownerID, runtimeSourceRef, "nonce-expired-packet", time.Now().UTC().Add(-time.Minute), sourceMaterializationAudienceDesktop)

	_, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:          testSourceMaterializationContext(ownerID, runtimeSourceRef, ""),
		OwnerUserId:      ownerID,
		RuntimeSourceRef: runtimeSourceRef,
		DisplayName:      "Expired Source Fork",
		Metadata:         testSourceMaterializationMetadata(t, packet),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status.Code = %s, want %s (%v)", status.Code(err), codes.InvalidArgument, err)
	}
}

func TestInitializeAgentRejectsWrongSourceMaterializationAudience(t *testing.T) {
	t.Setenv(sourceMaterializationHMACSecretEnv, "unit-test-source-packet-secret")
	svc := newRuntimeAgentTestService(t)
	ownerID := "user-source"
	runtimeSourceRef := "runtime-source:worldCharacter:world-1:source-1:hash-1"
	packet := testSourceMaterializationPacket(t, ownerID, runtimeSourceRef, "nonce-wrong-audience", time.Now().UTC().Add(5*time.Minute), "other.runtime")

	_, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:          testSourceMaterializationContext(ownerID, runtimeSourceRef, ""),
		OwnerUserId:      ownerID,
		RuntimeSourceRef: runtimeSourceRef,
		DisplayName:      "Wrong Audience Source Fork",
		Metadata:         testSourceMaterializationMetadata(t, packet),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status.Code = %s, want %s (%v)", status.Code(err), codes.InvalidArgument, err)
	}
}

func TestInitializeAgentRejectsUnadmittedSourceMaterializationSourceKind(t *testing.T) {
	t.Setenv(sourceMaterializationHMACSecretEnv, "unit-test-source-packet-secret")
	svc := newRuntimeAgentTestService(t)
	ownerID := "user-source"
	runtimeSourceRef := "runtime-source:worldCharacter:world-1:source-1:hash-1"
	packet := testSourceMaterializationPacket(t, ownerID, runtimeSourceRef, "nonce-bad-source-kind", time.Now().UTC().Add(5*time.Minute), sourceMaterializationAudienceDesktop)
	packet["sourceKind"] = "feedPost"
	refreshTestSourceMaterializationPacketSignature(t, packet, ownerID)

	_, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:          testSourceMaterializationContext(ownerID, runtimeSourceRef, ""),
		OwnerUserId:      ownerID,
		RuntimeSourceRef: runtimeSourceRef,
		DisplayName:      "Bad Source Kind Fork",
		Metadata:         testSourceMaterializationMetadata(t, packet),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status.Code = %s, want %s (%v)", status.Code(err), codes.InvalidArgument, err)
	}
}

func TestInitializeAgentRejectsSourceMaterializationPayloadContentHashMismatch(t *testing.T) {
	t.Setenv(sourceMaterializationHMACSecretEnv, "unit-test-source-packet-secret")
	svc := newRuntimeAgentTestService(t)
	ownerID := "user-source"
	runtimeSourceRef := "runtime-source:worldCharacter:world-1:source-1:hash-1"
	packet := testSourceMaterializationPacket(t, ownerID, runtimeSourceRef, "nonce-payload-content-hash-mismatch", time.Now().UTC().Add(5*time.Minute), sourceMaterializationAudienceDesktop)
	payload := packet["payload"].(map[string]any)
	payload["contentHash"] = "different-payload-content-hash"
	refreshTestSourceMaterializationPacketSignature(t, packet, ownerID)

	_, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:          testSourceMaterializationContext(ownerID, runtimeSourceRef, ""),
		OwnerUserId:      ownerID,
		RuntimeSourceRef: runtimeSourceRef,
		DisplayName:      "Bad Payload Content Hash Fork",
		Metadata:         testSourceMaterializationMetadata(t, packet),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status.Code = %s, want %s (%v)", status.Code(err), codes.InvalidArgument, err)
	}
}

func TestInitializeAgentRejectsMismatchedSourceMaterializationPayloadSchema(t *testing.T) {
	t.Setenv(sourceMaterializationHMACSecretEnv, "unit-test-source-packet-secret")
	svc := newRuntimeAgentTestService(t)
	ownerID := "user-source"
	runtimeSourceRef := "runtime-source:worldCharacter:world-1:source-1:hash-1"
	packet := testSourceMaterializationPacket(t, ownerID, runtimeSourceRef, "nonce-bad-payload-schema", time.Now().UTC().Add(5*time.Minute), sourceMaterializationAudienceDesktop)
	payload := packet["payload"].(map[string]any)
	payload["schemaVersion"] = "realm.persona/v1"
	refreshTestSourceMaterializationPacketSignature(t, packet, ownerID)

	_, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:          testSourceMaterializationContext(ownerID, runtimeSourceRef, ""),
		OwnerUserId:      ownerID,
		RuntimeSourceRef: runtimeSourceRef,
		DisplayName:      "Bad Payload Schema Fork",
		Metadata:         testSourceMaterializationMetadata(t, packet),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status.Code = %s, want %s (%v)", status.Code(err), codes.InvalidArgument, err)
	}
}

func testSourceMaterializationContext(ownerID string, runtimeSourceRef string, localAgentRef string) *runtimev1.AgentRequestContext {
	return &runtimev1.AgentRequestContext{
		AppId:            "runtime-agent-source-packet-test",
		SubjectUserId:    ownerID,
		OwnerUserId:      ownerID,
		RuntimeSourceRef: runtimeSourceRef,
		LocalAgentRef:    localAgentRef,
	}
}

func testSourceMaterializationMetadata(t *testing.T, packet map[string]any) *structpb.Struct {
	t.Helper()
	metadata, err := structpb.NewStruct(map[string]any{
		sourceMaterializationPacketMetadataKey: packet,
		"callerNote":                           "retained metadata",
	})
	if err != nil {
		t.Fatalf("NewStruct(metadata): %v", err)
	}
	return metadata
}

func testSourceMaterializationPacket(
	t *testing.T,
	ownerID string,
	runtimeSourceRef string,
	nonce string,
	expiresAt time.Time,
	audience string,
) map[string]any {
	t.Helper()
	issuedAt := expiresAt.Add(-5 * time.Minute).UTC().Format(time.RFC3339Nano)
	unsigned := map[string]any{
		"packetSchemaVersion":     sourceMaterializationPacketSchema,
		"packetId":                "packet-" + nonce,
		"sourceKind":              "worldCharacter",
		"sourceId":                "source-1",
		"sourceWorldId":           "world-1",
		"sourceContentRevision":   float64(7),
		"sourceContentHash":       "hash-1",
		"issuedAt":                issuedAt,
		"expiresAt":               expiresAt.UTC().Format(time.RFC3339Nano),
		"nonce":                   nonce,
		"intendedRuntimeAudience": audience,
		"runtimeSourceRef":        runtimeSourceRef,
		"sourceDisplayMetadata": map[string]any{
			"identity": map[string]any{"name": "Source One"},
		},
		"payload": map[string]any{
			"sourceRef": map[string]any{
				"kind":              "worldCharacter",
				"worldId":           "world-1",
				"sourceId":          "source-1",
				"sourceContentHash": "hash-1",
			},
			"schemaVersion":   "realm.world-character-core/v1",
			"contentRevision": float64(7),
			"contentHash":     "hash-1",
			"core": map[string]any{
				"identity": map[string]any{"name": "Source One"},
			},
		},
	}
	packetHash, err := hashCanonicalJSON(unsigned)
	if err != nil {
		t.Fatalf("hashCanonicalJSON(packet): %v", err)
	}
	packetProof, err := signSourceMaterializationPacketProof(packetHash, ownerID, nonce, audience)
	if err != nil {
		t.Fatalf("signSourceMaterializationPacketProof: %v", err)
	}
	packet := map[string]any{}
	for key, value := range unsigned {
		packet[key] = value
	}
	packet["packetHash"] = packetHash
	packet["packetProof"] = packetProof
	return packet
}

func refreshTestSourceMaterializationPacketSignature(t *testing.T, packet map[string]any, ownerID string) {
	t.Helper()
	unsigned := map[string]any{}
	for key, value := range packet {
		if key == "packetHash" || key == "packetProof" {
			continue
		}
		unsigned[key] = value
	}
	packetHash, err := hashCanonicalJSON(unsigned)
	if err != nil {
		t.Fatalf("hashCanonicalJSON(packet): %v", err)
	}
	audience, ok := packet["intendedRuntimeAudience"].(string)
	if !ok {
		t.Fatalf("intendedRuntimeAudience must be a string")
	}
	nonce, ok := packet["nonce"].(string)
	if !ok {
		t.Fatalf("nonce must be a string")
	}
	packetProof, err := signSourceMaterializationPacketProof(packetHash, ownerID, nonce, audience)
	if err != nil {
		t.Fatalf("signSourceMaterializationPacketProof: %v", err)
	}
	packet["packetHash"] = packetHash
	packet["packetProof"] = packetProof
}
