package runtimeagent

import (
	"context"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	sourceMaterializationTransportTestAccount   = "account-materializer-1"
	sourceMaterializationTransportTestRuntimeID = "runtime-instance-materializer-1"
)

type sourceMaterializationTransportTestAdmission struct {
	beginErr  error
	commitErr error
	candidate localAgentSourceSnapshotCandidateV1
}

func (a *sourceMaterializationTransportTestAdmission) VerifySourceMaterializationBegin(_ context.Context, _ *runtimev1.SourceMaterializationBeginControl, _ sourceMaterializationChallengeBindingV2, _ time.Time) error {
	return a.beginErr
}

func (a *sourceMaterializationTransportTestAdmission) AdmitSourceMaterializationCommit(_ context.Context, _ *runtimev1.SourceMaterializationBeginControl, _ sourceMaterializationChallengeBindingV2, _ map[string][]byte, _ time.Time) (localAgentSourceSnapshotCandidateV1, error) {
	return a.candidate, a.commitErr
}
func openSourceMaterializationTransportTestService(t *testing.T, localStatePath string) (*Service, func()) {
	t.Helper()
	memorySvc, err := memoryservice.New(nil, config.Config{LocalStatePath: localStatePath, AIHTTPTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		_ = memorySvc.Close()
		t.Fatalf("runtimeagent.New: %v", err)
	}
	if err := svc.SetSourceMaterializationRuntimeIdentity(sourceMaterializationTransportTestRuntimeID); err != nil {
		svc.Close()
		_ = memorySvc.Close()
		t.Fatalf("SetSourceMaterializationRuntimeIdentity: %v", err)
	}
	var once sync.Once
	closeFn := func() {
		once.Do(func() {
			svc.Close()
			if err := memorySvc.Close(); err != nil {
				t.Fatalf("memory.Close: %v", err)
			}
		})
	}
	return svc, closeFn
}

func sourceMaterializationTransportTestContext(accountID string) context.Context {
	return authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: accountID})
}

func sourceMaterializationTransportTestSourceRef(sourceID string) *runtimev1.SourceMaterializationSourceRef {
	return &runtimev1.SourceMaterializationSourceRef{
		Kind:              runtimev1.AgentSourceMaterializationSourceKind_AGENT_SOURCE_MATERIALIZATION_SOURCE_KIND_WORLD_CHARACTER,
		WorldId:           "world-materialization-1",
		SourceId:          sourceID,
		SourceContentHash: sourceMaterializationBytesDigest([]byte("source:" + sourceID)),
	}
}

func sourceMaterializationTransportTestRequestContext(sourceRef *runtimev1.SourceMaterializationSourceRef) *runtimev1.AgentRequestContext {
	return &runtimev1.AgentRequestContext{
		AppId:            "runtime-materialization-test",
		SubjectUserId:    sourceMaterializationTransportTestAccount,
		OwnerUserId:      sourceMaterializationTransportTestAccount,
		RuntimeSourceRef: runtimeSourceRefForMaterialization(sourceRef),
	}
}

func sourceMaterializationTransportTestChallengeRequest(requestID string, sourceRef *runtimev1.SourceMaterializationSourceRef) *runtimev1.CreateSourceMaterializationChallengeRequest {
	return &runtimev1.CreateSourceMaterializationChallengeRequest{Context: sourceMaterializationTransportTestRequestContext(sourceRef), RequestId: requestID, SourceRef: sourceRef}
}

func sourceMaterializationTransportTestChallengeAndControl(t *testing.T, svc *Service, ctx context.Context, suffix string) (*runtimev1.CreateSourceMaterializationChallengeResponse, *runtimev1.SourceMaterializationBeginControl, []byte) {
	t.Helper()
	return sourceMaterializationTransportTestChallengeAndControlForSource(t, svc, ctx, suffix, sourceMaterializationTransportTestSourceRef("source-"+suffix))
}

func sourceMaterializationTransportTestChallengeAndControlForSource(t *testing.T, svc *Service, ctx context.Context, suffix string, sourceRef *runtimev1.SourceMaterializationSourceRef) (*runtimev1.CreateSourceMaterializationChallengeResponse, *runtimev1.SourceMaterializationBeginControl, []byte) {
	t.Helper()
	challenge, err := svc.CreateSourceMaterializationChallenge(ctx, sourceMaterializationTransportTestChallengeRequest("challenge-"+suffix, sourceRef))
	if err != nil {
		t.Fatalf("create challenge %s: %v", suffix, err)
	}
	record, found, err := svc.sourceMaterializationRepo.challenge(context.Background(), challenge.GetChallengeId())
	if err != nil || !found {
		t.Fatalf("load challenge %s: found=%v err=%v", suffix, found, err)
	}
	componentBytes := []byte(`{"component":"` + suffix + `"}`)
	componentHash := sourceMaterializationBytesDigest(componentBytes)
	manifest := &runtimev1.BundleTransportManifestV1{
		ManifestSchemaVersion:  runtimev1.AgentSourceMaterializationBundleManifestSchemaVersion_AGENT_SOURCE_MATERIALIZATION_BUNDLE_MANIFEST_SCHEMA_VERSION_V1,
		PayloadAssemblyVersion: runtimev1.AgentSourceMaterializationPayloadAssemblyVersion_AGENT_SOURCE_MATERIALIZATION_PAYLOAD_ASSEMBLY_VERSION_V1,
		PacketId:               "packet-" + suffix,
		ChallengeDigest:        challenge.GetChallengeDigest(),
		TotalCanonicalBytes:    uint64(len(componentBytes)),
		ComponentCount:         1,
		ChunkCount:             1,
		Components: []*runtimev1.SourceMaterializationBundleComponentDescriptorV1{{
			ComponentId:         "component-" + suffix,
			Kind:                runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_WORLD_CORE,
			SchemaVersion:       "realm.world-core/v1",
			Revision:            1,
			ContentHash:         componentHash,
			CanonicalBytesHash:  componentHash,
			CanonicalByteLength: uint64(len(componentBytes)),
		}},
		Chunks: []*runtimev1.SourceMaterializationBundleChunkDescriptorV1{{GlobalOrdinal: 0, ComponentOffset: 0, Length: uint64(len(componentBytes)), ChunkSha256: componentHash}},
	}
	control := &runtimev1.SourceMaterializationBeginControl{
		PacketEnvelope: &runtimev1.SourceMaterializationPacketEnvelopeV2{
			PacketSchemaVersion:     runtimev1.AgentSourceMaterializationPacketSchemaVersion_AGENT_SOURCE_MATERIALIZATION_PACKET_SCHEMA_VERSION_V2,
			PacketId:                manifest.GetPacketId(),
			Issuer:                  "https://realm.materialization.test",
			KeyId:                   "materialization-key-1",
			Algorithm:               runtimev1.AgentSourceMaterializationProofAlgorithm_AGENT_SOURCE_MATERIALIZATION_PROOF_ALGORITHM_RS256,
			KeyUse:                  runtimev1.AgentSourceMaterializationKeyUse_AGENT_SOURCE_MATERIALIZATION_KEY_USE_SIG,
			IssuedAt:                timestamppb.New(record.IssuedAt),
			ExpiresAt:               timestamppb.New(record.ExpiresAt),
			Nonce:                   "nonce-" + suffix,
			IntendedRuntimeAudience: challenge.GetIntendedRuntimeAudience(),
			ChallengeId:             challenge.GetChallengeId(),
			ChallengeDigest:         challenge.GetChallengeDigest(),
			ChallengeLimits:         challenge.GetLimits(),
			MaterializerAccountId:   sourceMaterializationTransportTestAccount,
			SourceRef:               challenge.GetSourceRef(),
			PayloadHash:             sourceMaterializationBytesDigest([]byte("payload:" + suffix)),
			BundleManifestHash:      sourceMaterializationBytesDigest([]byte("manifest:" + suffix)),
			PacketHash:              sourceMaterializationBytesDigest([]byte("packet:" + suffix)),
		},
		PacketProof:             "deterministic-test-proof",
		BundleTransportManifest: manifest,
	}
	return challenge, control, componentBytes
}

func sourceMaterializationTransportTestBeginPutCandidate(t *testing.T, svc *Service, ctx context.Context, candidate localAgentSourceSnapshotCandidateV1, suffix string) (*runtimev1.CreateSourceMaterializationChallengeResponse, *runtimev1.SourceMaterializationBeginControl, []byte, *runtimev1.BeginSourceMaterializationUploadResponse) {
	t.Helper()
	sourceRef := sourceMaterializationProtoRef(candidate.Normalized.SourceRef)
	challenge, control, componentBytes := sourceMaterializationTransportTestChallengeAndControlForSource(t, svc, ctx, suffix, sourceRef)
	control.PacketEnvelope.PacketId = candidate.Normalized.PacketID
	control.PacketEnvelope.PayloadHash = candidate.Normalized.PayloadHash
	control.PacketEnvelope.PacketHash = candidate.Normalized.PacketHash
	control.PacketEnvelope.Issuer = candidate.Normalized.Issuer
	control.BundleTransportManifest.PacketId = candidate.Normalized.PacketID
	begin, err := svc.BeginSourceMaterializationUpload(ctx, &runtimev1.BeginSourceMaterializationUploadRequest{Context: sourceMaterializationTransportTestRequestContext(sourceRef), BeginRequestId: "begin-" + suffix, Control: control})
	if err != nil {
		t.Fatalf("begin candidate %s: %v", suffix, err)
	}
	if begin.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_OPEN {
		t.Fatalf("begin candidate %s response = %+v", suffix, begin)
	}
	if _, err := svc.PutSourceMaterializationChunk(ctx, sourceMaterializationTransportTestPutRequest(begin, control, componentBytes, "put-"+suffix)); err != nil {
		t.Fatalf("put candidate %s: %v", suffix, err)
	}
	return challenge, control, componentBytes, begin
}

func sourceMaterializationTransportTestPutRequest(begin *runtimev1.BeginSourceMaterializationUploadResponse, control *runtimev1.SourceMaterializationBeginControl, componentBytes []byte, requestID string) *runtimev1.PutSourceMaterializationChunkRequest {
	chunk := control.GetBundleTransportManifest().GetChunks()[0]
	component := control.GetBundleTransportManifest().GetComponents()[0]
	return &runtimev1.PutSourceMaterializationChunkRequest{
		Context:            sourceMaterializationTransportTestRequestContext(control.GetPacketEnvelope().GetSourceRef()),
		PutRequestId:       requestID,
		UploadId:           begin.GetUploadId(),
		PacketHash:         begin.GetPacketHash(),
		BundleManifestHash: begin.GetBundleManifestHash(),
		GlobalOrdinal:      chunk.GetGlobalOrdinal(),
		ComponentId:        component.GetComponentId(),
		ComponentOffset:    chunk.GetComponentOffset(),
		ChunkSha256:        chunk.GetChunkSha256(),
		Bytes:              append([]byte(nil), componentBytes...),
	}
}

func assertSourceMaterializationNoRawUploadBytes(t *testing.T, svc *Service, uploadID string) {
	t.Helper()
	var chunkCount int
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_source_materialization_chunk WHERE upload_id = ?`, uploadID).Scan(&chunkCount); err != nil {
		t.Fatalf("count source materialization chunks: %v", err)
	}
	if chunkCount != 0 {
		t.Fatalf("source materialization raw chunk count = %d, want 0", chunkCount)
	}
	var controlBytes int
	if err := svc.backend.DB().QueryRow(`SELECT COALESCE(length(control_bytes), 0) FROM runtime_source_materialization_upload WHERE upload_id = ?`, uploadID).Scan(&controlBytes); err != nil {
		t.Fatalf("read source materialization control length: %v", err)
	}
	if controlBytes != 0 {
		t.Fatalf("source materialization control bytes = %d, want 0", controlBytes)
	}
}
