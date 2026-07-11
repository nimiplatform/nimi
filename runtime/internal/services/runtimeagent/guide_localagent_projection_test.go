package runtimeagent

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// TestRuntimeAgentGuideProjectsAsOrdinaryLocalAgent is the service-level
// K-AGCORE-139/K-AGCORE-140 guide proof. The guide is admitted through the
// packet-v2 challenge/begin/put/commit/abort surface and the Runtime production
// product committer. No InitializeAgent metadata lane, retired shared-secret
// proof, or fixed audience participates in this path.
func TestRuntimeAgentGuideProjectsAsOrdinaryLocalAgent(t *testing.T) {
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
	defer closeService()
	svc.SetSourceMaterializationProductCommitter(svc)
	ctx := sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount)

	// Exercise the fifth packet-v2 RPC explicitly: an abandoned guide upload
	// must invalidate its challenge and erase every raw transport byte without
	// creating product state.
	abortCandidate := sourceMaterializationTransportTestCandidate(t, "worldCharacter", "packet-guide-abort")
	svc.SetSourceMaterializationAdmission(&sourceMaterializationTransportTestAdmission{candidate: abortCandidate})
	abortChallenge, _, _, abortBegin := sourceMaterializationTransportTestBeginPutCandidate(t, svc, ctx, abortCandidate, "guide-abort")
	aborted, err := svc.AbortSourceMaterializationUpload(ctx, &runtimev1.AbortSourceMaterializationUploadRequest{
		Context:            sourceMaterializationTransportTestRequestContext(abortChallenge.GetSourceRef()),
		AbortRequestId:     "abort-guide-upload",
		UploadId:           abortBegin.GetUploadId(),
		PacketHash:         abortBegin.GetPacketHash(),
		BundleManifestHash: abortBegin.GetBundleManifestHash(),
	})
	if err != nil {
		t.Fatalf("AbortSourceMaterializationUpload(guide): %v", err)
	}
	if aborted.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_ABORTED ||
		aborted.GetChallengeState() != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_INVALIDATED ||
		aborted.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
		t.Fatalf("guide abort response = %+v", aborted)
	}
	assertSourceMaterializationNoRawUploadBytes(t, svc, abortBegin.GetUploadId())

	firstCandidate := sourceMaterializationTransportTestCandidate(t, "worldCharacter", "packet-guide-1")
	first := materializeGuideV2(t, svc, ctx, firstCandidate, "guide-1")
	firstRef := first.GetLocalAgentRef()
	assertOpaqueGuideLocalAgentRef(t, firstRef, firstCandidate)
	assertBoundedGuideSourceStatus(t, first.GetSourceContextStatus(), firstRef, firstCandidate)

	guideContext := sourceMaterializationTransportTestRequestContext(sourceMaterializationProtoRef(firstCandidate.Normalized.SourceRef))
	guideContext.LocalAgentRef = firstRef
	got, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: guideContext})
	if err != nil {
		t.Fatalf("GetAgent(guide): %v", err)
	}
	agent := got.GetAgent()
	if agent.GetOwnerUserId() != sourceMaterializationTransportTestAccount ||
		agent.GetRuntimeSourceRef() != runtimeSourceRefForMaterialization(sourceMaterializationProtoRef(firstCandidate.Normalized.SourceRef)) ||
		agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		t.Fatalf("guide agent identity/lifecycle = %+v", agent)
	}
	if agent.GetMetadata() != nil {
		t.Fatalf("guide agent exposed a metadata side channel: %+v", agent.GetMetadata())
	}
	if !proto.Equal(agent.GetSourceContextStatus(), first.GetSourceContextStatus()) {
		t.Fatalf("guide Agent status diverged from commit status: agent=%+v commit=%+v", agent.GetSourceContextStatus(), first.GetSourceContextStatus())
	}

	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{Context: guideContext, Reason: "guide conformance teardown"}); err != nil {
		t.Fatalf("TerminateAgent(guide): %v", err)
	}
	if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: guideContext}); status.Code(err) != codes.NotFound {
		t.Fatalf("GetAgent(guide) after terminate: status=%s err=%v, want NotFound", status.Code(err), err)
	}
	if snapshot, found, err := svc.sourceMaterializationRepo.sourceSnapshot(context.Background(), firstRef); err != nil || found {
		t.Fatalf("terminated guide retained immutable source product: found=%v snapshot=%+v err=%v", found, snapshot, err)
	}
	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{Context: guideContext, Reason: "guide conformance teardown replay"}); err != nil {
		t.Fatalf("TerminateAgent(guide) idempotent replay: %v", err)
	}

	// Issuance metadata is excluded from semantic snapshot truth: a new packet
	// for the same source must reproduce the snapshot hash while materializing
	// a fresh opaque Runtime identity after termination.
	secondCandidate := sourceMaterializationTransportTestCandidate(t, "worldCharacter", "packet-guide-2")
	if !sameSourceMaterializationSourceRef(
		sourceMaterializationProtoRef(firstCandidate.Normalized.SourceRef),
		sourceMaterializationProtoRef(secondCandidate.Normalized.SourceRef),
	) || firstCandidate.Normalized.SnapshotHash != secondCandidate.Normalized.SnapshotHash {
		t.Fatalf("guide reissuance changed semantic source truth: first=%+v second=%+v", firstCandidate.Normalized, secondCandidate.Normalized)
	}
	second := materializeGuideV2(t, svc, ctx, secondCandidate, "guide-2")
	if second.GetLocalAgentRef() == firstRef {
		t.Fatalf("guide rematerialization reused terminated local_agent_ref %q", firstRef)
	}
	assertOpaqueGuideLocalAgentRef(t, second.GetLocalAgentRef(), secondCandidate)
	assertBoundedGuideSourceStatus(t, second.GetSourceContextStatus(), second.GetLocalAgentRef(), secondCandidate)
}

func materializeGuideV2(
	t *testing.T,
	svc *Service,
	ctx context.Context,
	candidate localAgentSourceSnapshotCandidateV1,
	suffix string,
) *runtimev1.CommitSourceMaterializationResponse {
	t.Helper()
	svc.SetSourceMaterializationAdmission(&sourceMaterializationTransportTestAdmission{candidate: candidate})
	challenge, _, _, begin := sourceMaterializationTransportTestBeginPutCandidate(t, svc, ctx, candidate, suffix)
	committed, err := svc.CommitSourceMaterialization(ctx, &runtimev1.CommitSourceMaterializationRequest{
		Context:            sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()),
		CommitRequestId:    "commit-" + suffix,
		UploadId:           begin.GetUploadId(),
		PacketHash:         begin.GetPacketHash(),
		BundleManifestHash: begin.GetBundleManifestHash(),
	})
	if err != nil {
		t.Fatalf("CommitSourceMaterialization(%s): %v", suffix, err)
	}
	if committed.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTED ||
		committed.GetChallengeState() != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_CONSUMED ||
		committed.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
		t.Fatalf("guide commit %s = %+v", suffix, committed)
	}
	assertSourceMaterializationNoRawUploadBytes(t, svc, begin.GetUploadId())
	return committed
}

func assertOpaqueGuideLocalAgentRef(t *testing.T, localAgentRef string, candidate localAgentSourceSnapshotCandidateV1) {
	t.Helper()
	if !strings.HasPrefix(localAgentRef, runtimeGeneratedLocalAgentRefPrefix) {
		t.Fatalf("guide local_agent_ref = %q, want Runtime-generated opaque ref", localAgentRef)
	}
	for _, sourceValue := range []string{
		sourceMaterializationTransportTestAccount,
		candidate.Normalized.SourceRef.WorldID,
		candidate.Normalized.SourceRef.SourceID,
		candidate.Normalized.SourceRef.SourceContentHash,
	} {
		if strings.Contains(localAgentRef, sourceValue) {
			t.Fatalf("guide local_agent_ref %q leaks source value %q", localAgentRef, sourceValue)
		}
	}
}

func assertBoundedGuideSourceStatus(
	t *testing.T,
	projection *runtimev1.LocalAgentSourceContextStatus,
	localAgentRef string,
	candidate localAgentSourceSnapshotCandidateV1,
) {
	t.Helper()
	if projection == nil ||
		projection.GetSchemaVersion() != runtimev1.AgentLocalSourceContextSchemaVersion_AGENT_LOCAL_SOURCE_CONTEXT_SCHEMA_VERSION_V1 ||
		!projection.GetReady() ||
		projection.GetState() != runtimev1.AgentLocalSourceContextState_AGENT_LOCAL_SOURCE_CONTEXT_STATE_READY ||
		projection.GetReasonCode() != runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_NONE ||
		projection.GetLocalAgentRef() != localAgentRef ||
		projection.GetSnapshotSchemaVersion() != runtimev1.AgentLocalSourceSnapshotSchemaVersion_AGENT_LOCAL_SOURCE_SNAPSHOT_SCHEMA_VERSION_V1 ||
		projection.GetSnapshotHash() != candidate.Normalized.SnapshotHash ||
		projection.GetCapturedAt() == nil ||
		len(projection.GetCoverageSections()) == 0 ||
		!sameSourceMaterializationSourceRef(projection.GetSourceRef(), sourceMaterializationProtoRef(candidate.Normalized.SourceRef)) {
		t.Fatalf("guide bounded source status = %+v", projection)
	}
	raw, err := protojson.Marshal(projection)
	if err != nil {
		t.Fatalf("marshal guide bounded source status: %v", err)
	}
	for _, forbidden := range []string{"packetProof", "packetId", "payload", "componentBytes", "systemPrompt", "transcript", "memory"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("guide bounded source status exposed %q: %s", forbidden, raw)
		}
	}
}
