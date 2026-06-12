package runtimeagent

import (
	"context"
	"strings"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func participationTestService(t *testing.T) *Service {
	t.Helper()
	return newRuntimeAgentServiceForPublicChatTest(t)
}

func debugProbeSpec(requestID string) *runtimev1.ParticipationRequestSpec {
	return &runtimev1.ParticipationRequestSpec{
		ProfileKind:    runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_DEBUG_OR_PROBE,
		AgentId:        "agent-1",
		ParticipantRef: "participant-1",
		TriggerRef:     "trigger-1",
		RequestId:      requestID,
		ContextBlocks: []*runtimev1.ParticipationContextBlock{{
			Block: &runtimev1.ParticipationContextBlock_DiagnosticProbeRef{
				DiagnosticProbeRef: &runtimev1.DiagnosticProbeRefBlock{ProbeId: "probe-1", ProbeKind: "latency"},
			},
		}},
	}
}

func TestParticipationDescribeRegistriesAreClosed(t *testing.T) {
	svc := participationTestService(t)
	profiles, err := svc.DescribeParticipationProfiles(context.Background(), &runtimev1.DescribeParticipationProfilesRequest{})
	if err != nil {
		t.Fatalf("describe profiles: %v", err)
	}
	if len(profiles.GetProfiles()) != 6 {
		t.Fatalf("expected 6 profiles, got %d", len(profiles.GetProfiles()))
	}
	blocks, err := svc.DescribeParticipationContextBlocks(context.Background(), &runtimev1.DescribeParticipationContextBlocksRequest{})
	if err != nil {
		t.Fatalf("describe blocks: %v", err)
	}
	if len(blocks.GetContextBlocks()) != 21 {
		t.Fatalf("expected 21 context blocks, got %d", len(blocks.GetContextBlocks()))
	}
}

func TestParticipationValidateFailClosedMatrix(t *testing.T) {
	svc := participationTestService(t)
	ctx := context.Background()

	_, err := svc.ValidateParticipation(ctx, &runtimev1.ValidateParticipationRequest{
		Spec: &runtimev1.ParticipationRequestSpec{AgentId: "agent-1"},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("unknown profile must be InvalidArgument, got %v", err)
	}

	canonical, err := svc.ValidateParticipation(ctx, &runtimev1.ValidateParticipationRequest{
		Spec: &runtimev1.ParticipationRequestSpec{
			ProfileKind: runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_CANONICAL_AGENT_CHAT,
			AgentId:     "agent-1",
		},
	})
	if err != nil || canonical.GetAdmitted() || canonical.GetRefusalReason() != "canonical_chat_uses_runtime_agent_service" {
		t.Fatalf("canonical chat must refuse to second-channel: %v %v", canonical, err)
	}

	wrongBlock, err := svc.ValidateParticipation(ctx, &runtimev1.ValidateParticipationRequest{
		Spec: &runtimev1.ParticipationRequestSpec{
			ProfileKind: runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_DEBUG_OR_PROBE,
			AgentId:     "agent-1",
			ContextBlocks: []*runtimev1.ParticipationContextBlock{{
				Block: &runtimev1.ParticipationContextBlock_RealmGroupThreadRef{
					RealmGroupThreadRef: &runtimev1.RealmGroupThreadRefBlock{ThreadId: "thread-1"},
				},
			}},
		},
	})
	if err != nil || wrongBlock.GetAdmitted() || wrongBlock.GetRefusalReason() != "context_block_not_admitted_for_profile" {
		t.Fatalf("block outside profile must refuse: %v %v", wrongBlock, err)
	}

	missingField, err := svc.ValidateParticipation(ctx, &runtimev1.ValidateParticipationRequest{
		Spec: &runtimev1.ParticipationRequestSpec{
			ProfileKind: runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_DEBUG_OR_PROBE,
			AgentId:     "agent-1",
			ContextBlocks: []*runtimev1.ParticipationContextBlock{{
				Block: &runtimev1.ParticipationContextBlock_DiagnosticProbeRef{
					DiagnosticProbeRef: &runtimev1.DiagnosticProbeRefBlock{ProbeId: "probe-1"},
				},
			}},
		},
	})
	if err != nil || missingField.GetAdmitted() {
		t.Fatalf("missing required field must refuse, got %v %v", missingField, err)
	}
}

func TestParticipationExecuteDebugProbeCandidateAndIdempotency(t *testing.T) {
	svc := participationTestService(t)
	ctx := context.Background()

	first, err := svc.ExecuteParticipation(ctx, &runtimev1.ExecuteParticipationRequest{Spec: debugProbeSpec("req-1")})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if first.GetStatus() != runtimev1.ParticipationStatus_PARTICIPATION_STATUS_CANDIDATE_READY {
		t.Fatalf("debug probe must reach CANDIDATE_READY, got %v (%s)", first.GetStatus(), first.GetRefusalReason())
	}
	if first.GetCandidateRef() == "" || first.GetAuditId() == "" {
		t.Fatalf("candidate_ref and audit_id required, got %v", first)
	}

	again, err := svc.ExecuteParticipation(ctx, &runtimev1.ExecuteParticipationRequest{Spec: debugProbeSpec("req-1")})
	if err != nil || again.GetParticipationId() != first.GetParticipationId() {
		t.Fatalf("same request_id must be idempotent: %v vs %v (%v)", again.GetParticipationId(), first.GetParticipationId(), err)
	}

	candidate, err := svc.GetParticipationCandidate(ctx, &runtimev1.GetParticipationCandidateRequest{ParticipationId: first.GetParticipationId()})
	if err != nil {
		t.Fatalf("get candidate: %v", err)
	}
	record := candidate.GetCandidate()
	if record.GetParticipationId() == "" || record.GetCandidateRef() == "" || record.GetPolicyVerdictRef() == "" ||
		record.GetAuditId() == "" || record.GetCreatedAt() == nil || record.GetMemoryWriteVerdict() == nil ||
		record.GetOutputDestination() != runtimev1.ParticipationOutputDestination_PARTICIPATION_OUTPUT_DESTINATION_DIAGNOSTIC_CANDIDATE {
		t.Fatalf("candidate record incomplete: %+v", record)
	}
	if record.GetMemoryWriteVerdict().GetDecision() != runtimev1.ParticipationVerdictDecision_PARTICIPATION_VERDICT_DECISION_DENY {
		t.Fatalf("debug probe memory write must deny by default (K-AGCORE-084)")
	}
}

func TestParticipationExecuteRefusalPostures(t *testing.T) {
	svc := participationTestService(t)
	ctx := context.Background()

	sandbox, err := svc.ExecuteParticipation(ctx, &runtimev1.ExecuteParticipationRequest{
		Spec: &runtimev1.ParticipationRequestSpec{
			ProfileKind: runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_SCENARIO_SANDBOX,
			AgentId:     "agent-1",
			RequestId:   "req-sandbox",
			ContextBlocks: []*runtimev1.ParticipationContextBlock{
				{Block: &runtimev1.ParticipationContextBlock_ScenarioPackageRef{ScenarioPackageRef: &runtimev1.ScenarioPackageRefBlock{ScenarioPackageId: "pkg-1"}}},
				{Block: &runtimev1.ParticipationContextBlock_ScenarioRunRef{ScenarioRunRef: &runtimev1.ScenarioRunRefBlock{ScenarioRunId: "run-1"}}},
				{Block: &runtimev1.ParticipationContextBlock_ScenarioBranchRef{ScenarioBranchRef: &runtimev1.ScenarioBranchRefBlock{ScenarioBranchId: "branch-1"}}},
				{Block: &runtimev1.ParticipationContextBlock_VisibleSceneState{VisibleSceneState: &runtimev1.VisibleSceneStateBlock{SceneStateRef: "scene-1"}}},
				{Block: &runtimev1.ParticipationContextBlock_RecentSandboxTranscriptProjection{RecentSandboxTranscriptProjection: &runtimev1.RecentSandboxTranscriptProjectionBlock{TranscriptRef: "t-1", BranchRef: "branch-1", TrustPosture: runtimev1.ParticipationInputTrust_PARTICIPATION_INPUT_TRUST_SANDBOX_SCRIPT}}},
			},
		},
	})
	if err != nil || sandbox.GetRefusalReason() != "profile_not_yet_consumable" {
		t.Fatalf("future_consumer_only must refuse: %v %v", sandbox, err)
	}

	replay, err := svc.GetParticipationReplay(ctx, &runtimev1.GetParticipationReplayRequest{ParticipationId: sandbox.GetParticipationId()})
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if replay.GetReplay().GetOutcome() != runtimev1.ParticipationReplayOutcome_PARTICIPATION_REPLAY_OUTCOME_FAILED || len(replay.GetReplay().GetStages()) == 0 {
		t.Fatalf("refused participation replay must be FAILED with stages: %+v", replay.GetReplay())
	}

	audit, err := svc.ListParticipationAuditEvents(ctx, &runtimev1.ListParticipationAuditEventsRequest{ParticipationId: sandbox.GetParticipationId()})
	if err != nil || len(audit.GetEvents()) != 2 {
		t.Fatalf("expected 2 audit events: %v %v", audit, err)
	}
}

func TestParticipationReadsFailClosedOnUnknownId(t *testing.T) {
	svc := participationTestService(t)
	ctx := context.Background()
	if _, err := svc.GetParticipationCandidate(ctx, &runtimev1.GetParticipationCandidateRequest{ParticipationId: "missing"}); status.Code(err) != codes.NotFound {
		t.Fatalf("candidate must be NotFound, got %v", err)
	}
	if _, err := svc.GetParticipationVerdicts(ctx, &runtimev1.GetParticipationVerdictsRequest{ParticipationId: "missing"}); status.Code(err) != codes.NotFound {
		t.Fatalf("verdicts must be NotFound, got %v", err)
	}
	if _, err := svc.GetParticipationReplay(ctx, &runtimev1.GetParticipationReplayRequest{ParticipationId: "missing"}); status.Code(err) != codes.NotFound {
		t.Fatalf("replay must be NotFound, got %v", err)
	}
}

func TestParticipationExecuteRefusalReasonsLockExecutionBoundaries(t *testing.T) {
	svc := participationTestService(t)
	ctx := context.Background()

	canonical, err := svc.ExecuteParticipation(ctx, &runtimev1.ExecuteParticipationRequest{
		Spec: &runtimev1.ParticipationRequestSpec{
			ProfileKind: runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_CANONICAL_AGENT_CHAT,
			AgentId:     "agent-1",
			RequestId:   "req-exec-canonical",
		},
	})
	if err != nil || canonical.GetRefusalReason() != "canonical_chat_uses_runtime_agent_service" ||
		canonical.GetStatus() != runtimev1.ParticipationStatus_PARTICIPATION_STATUS_BLOCKED {
		t.Fatalf("canonical execute must refuse to second-channel: %v %v", canonical, err)
	}

	groupBlocks := []*runtimev1.ParticipationContextBlock{
		{Block: &runtimev1.ParticipationContextBlock_RealmGroupThreadRef{RealmGroupThreadRef: &runtimev1.RealmGroupThreadRefBlock{ThreadId: "thread-1"}}},
		{Block: &runtimev1.ParticipationContextBlock_TriggerMessageRef{TriggerMessageRef: &runtimev1.TriggerMessageRefBlock{MessageId: "msg-1"}}},
		{Block: &runtimev1.ParticipationContextBlock_ParticipantProjection{ParticipantProjection: &runtimev1.ParticipantProjectionBlock{ParticipantRef: "p-1", IdentitySource: runtimev1.ParticipationIdentitySource_PARTICIPATION_IDENTITY_SOURCE_USER_OWNED_NIMI_AGENT}}},
		{Block: &runtimev1.ParticipationContextBlock_RecentGroupTranscriptProjection{RecentGroupTranscriptProjection: &runtimev1.RecentGroupTranscriptProjectionBlock{TranscriptRef: "tr-1", TrustPosture: runtimev1.ParticipationInputTrust_PARTICIPATION_INPUT_TRUST_UNTRUSTED_MULTI_PARTY_TRANSCRIPT}}},
		{Block: &runtimev1.ParticipationContextBlock_AgentSlotProjection{AgentSlotProjection: &runtimev1.AgentSlotProjectionBlock{AgentId: "agent-1", SlotRef: "slot-1"}}},
	}
	group, err := svc.ExecuteParticipation(ctx, &runtimev1.ExecuteParticipationRequest{
		Spec: &runtimev1.ParticipationRequestSpec{
			ProfileKind:   runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_REALM_GROUP_AGENT,
			AgentId:       "agent-1",
			RequestId:     "req-exec-group",
			ContextBlocks: groupBlocks,
		},
	})
	if err != nil || group.GetRefusalReason() != "execution_engine_not_bound" {
		t.Fatalf("realm_group execute must fail closed until engine bound, got %v %v", group, err)
	}
	if candidate, getErr := svc.GetParticipationCandidate(ctx, &runtimev1.GetParticipationCandidateRequest{ParticipationId: group.GetParticipationId()}); getErr != nil || candidate.GetCandidate() != nil {
		t.Fatalf("refused realm_group must have no fabricated candidate: %v %v", candidate, getErr)
	}

	externalBase := []*runtimev1.ParticipationContextBlock{
		{Block: &runtimev1.ParticipationContextBlock_ParticipantProjection{ParticipantProjection: &runtimev1.ParticipantProjectionBlock{ParticipantRef: "ext-participant-1", IdentitySource: runtimev1.ParticipationIdentitySource_PARTICIPATION_IDENTITY_SOURCE_EXTERNAL_A2A_AGENT}}},
		{Block: &runtimev1.ParticipationContextBlock_ExternalParticipantIdentityRef{ExternalParticipantIdentityRef: &runtimev1.ExternalParticipantIdentityRefBlock{ExternalParticipantId: "ext-1", IdentitySource: runtimev1.ParticipationIdentitySource_PARTICIPATION_IDENTITY_SOURCE_EXTERNAL_A2A_AGENT}}},
		{Block: &runtimev1.ParticipationContextBlock_ExternalPayloadRef{ExternalPayloadRef: &runtimev1.ExternalPayloadRefBlock{PayloadRef: "payload-1", ProtocolKind: runtimev1.ParticipationExternalProtocolKind_PARTICIPATION_EXTERNAL_PROTOCOL_KIND_A2A}}},
		{Block: &runtimev1.ParticipationContextBlock_DomainContextRef{DomainContextRef: &runtimev1.DomainContextRefBlock{DomainRef: "domain-1", TranscriptOwner: runtimev1.ParticipationTranscriptOwner_PARTICIPATION_TRANSCRIPT_OWNER_EXTERNAL_DOMAIN}}},
		{Block: &runtimev1.ParticipationContextBlock_ToolOrCapabilityProjection{ToolOrCapabilityProjection: &runtimev1.ToolOrCapabilityProjectionBlock{CapabilityRef: "cap-1", EffectClass: runtimev1.EffectClass_EFFECT_CLASS_READ_ONLY}}},
	}
	noVerdict, err := svc.ExecuteParticipation(ctx, &runtimev1.ExecuteParticipationRequest{
		Spec: &runtimev1.ParticipationRequestSpec{
			ProfileKind:   runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_EXTERNAL_AGENT_ENTRY,
			AgentId:       "agent-1",
			RequestId:     "req-exec-ext-noverdict",
			ContextBlocks: externalBase,
		},
	})
	if err != nil || !strings.Contains(noVerdict.GetRefusalReason(), "gateway_verdict_ref") {
		t.Fatalf("external execute without gateway verdict must refuse with gateway_verdict_ref reason, got %v %v", noVerdict, err)
	}

	withVerdict, err := svc.ExecuteParticipation(ctx, &runtimev1.ExecuteParticipationRequest{
		Spec: &runtimev1.ParticipationRequestSpec{
			ProfileKind: runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_EXTERNAL_AGENT_ENTRY,
			AgentId:     "agent-1",
			RequestId:   "req-exec-ext-verdict",
			ContextBlocks: append(append([]*runtimev1.ParticipationContextBlock{}, externalBase...),
				&runtimev1.ParticipationContextBlock{Block: &runtimev1.ParticipationContextBlock_GatewayVerdictRef{GatewayVerdictRef: &runtimev1.GatewayVerdictRefBlock{GatewayVerdictId: "verdict-1"}}}),
		},
	})
	if err != nil {
		t.Fatalf("external execute with verdict: %v", err)
	}
	if reason := withVerdict.GetRefusalReason(); reason != "external_entry_not_admitted" && reason != "execution_engine_not_bound" {
		t.Fatalf("non-admitted external entry must refuse via boundary or engine gate (K-AGCORE-089..091), got %q", reason)
	}
}
