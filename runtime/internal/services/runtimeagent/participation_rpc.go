package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// Runtime Agent Participation RPC surface (K-AGCORE-061..088, K-PROTO-012).
// Admission is fail-closed: unknown profiles, blocks outside the profile's
// admitted set, missing required block fields, and non-consumable postures
// all refuse with typed reasons instead of degrading. Candidate content is
// never fabricated: profiles without a bound execution engine refuse with
// participation_refusal_execution_engine_not_bound (K-AGCORE-062).

const (
	participationRefusalCanonicalChat       = "canonical_chat_uses_runtime_agent_service"
	participationRefusalNotConsumable       = "profile_not_yet_consumable"
	participationRefusalEngineNotBound      = "execution_engine_not_bound"
	participationRefusalRealmGroupDedicated = "use_create_realm_group_message_candidate"
	participationRefusalEntryNotAdmitted    = "external_entry_not_admitted"
	participationRefusalGatewayVerdictMiss  = "gateway_verdict_ref_required"
)

func participationAllow() *runtimev1.ParticipationVerdict {
	return &runtimev1.ParticipationVerdict{
		Decision:   runtimev1.ParticipationVerdictDecision_PARTICIPATION_VERDICT_DECISION_ALLOW,
		ReasonCode: "participation_profile_policy",
	}
}

func participationDeny(reason string) *runtimev1.ParticipationVerdict {
	return &runtimev1.ParticipationVerdict{
		Decision:   runtimev1.ParticipationVerdictDecision_PARTICIPATION_VERDICT_DECISION_DENY,
		ReasonCode: reason,
	}
}

func participationVerdictSetForProfile(row participationProfileRow) *runtimev1.ParticipationVerdictSet {
	memoryWrite := participationAllow()
	// K-AGCORE-084: every non-canonical profile defaults to WRITE_NONE; the
	// verdict records the deny so callers cannot read silence as admission.
	if row.memoryWriteDefault == runtimev1.ParticipationMemoryWriteDefault_PARTICIPATION_MEMORY_WRITE_DEFAULT_WRITE_NONE {
		memoryWrite = participationDeny("memory_write_default_write_none")
	}
	return &runtimev1.ParticipationVerdictSet{
		MemoryRead:                 participationAllow(),
		MemoryWrite:                memoryWrite,
		CapabilityScope:            participationAllow(),
		Concurrency:                participationAllow(),
		ResolvedMemoryReadScope:    row.memoryReadScope,
		ResolvedMemoryWriteDefault: row.memoryWriteDefault,
		ResolvedCapabilityScope:    row.capabilityScope,
		ResolvedConcurrency:        row.executionConcurrency,
	}
}

// participationBlockFacts extracts the closed block kind plus its required
// field values from the typed oneof (K-AGCORE-081). Unknown variants fail
// closed at the call site because ok stays false.
func participationBlockFacts(block *runtimev1.ParticipationContextBlock) (kind string, fields map[string]string, ok bool) {
	switch b := block.GetBlock().(type) {
	case *runtimev1.ParticipationContextBlock_RuntimeConversationAnchorRef:
		return "runtime_conversation_anchor_ref", map[string]string{"conversation_anchor_id": b.RuntimeConversationAnchorRef.GetConversationAnchorId()}, true
	case *runtimev1.ParticipationContextBlock_RealmGroupThreadRef:
		return "realm_group_thread_ref", map[string]string{"thread_id": b.RealmGroupThreadRef.GetThreadId()}, true
	case *runtimev1.ParticipationContextBlock_TriggerMessageRef:
		return "trigger_message_ref", map[string]string{"message_id": b.TriggerMessageRef.GetMessageId()}, true
	case *runtimev1.ParticipationContextBlock_ParticipantProjection:
		return "participant_projection", map[string]string{
			"participant_ref": b.ParticipantProjection.GetParticipantRef(),
			"identity_source": enumNonZero(int32(b.ParticipantProjection.GetIdentitySource())),
		}, true
	case *runtimev1.ParticipationContextBlock_RecentGroupTranscriptProjection:
		return "recent_group_transcript_projection", map[string]string{
			"transcript_ref": b.RecentGroupTranscriptProjection.GetTranscriptRef(),
			"trust_posture":  enumNonZero(int32(b.RecentGroupTranscriptProjection.GetTrustPosture())),
		}, true
	case *runtimev1.ParticipationContextBlock_AgentSlotProjection:
		return "agent_slot_projection", map[string]string{
			"agent_id": b.AgentSlotProjection.GetAgentId(),
			"slot_ref": b.AgentSlotProjection.GetSlotRef(),
		}, true
	case *runtimev1.ParticipationContextBlock_ScenarioPackageRef:
		return "scenario_package_ref", map[string]string{"scenario_package_id": b.ScenarioPackageRef.GetScenarioPackageId()}, true
	case *runtimev1.ParticipationContextBlock_ScenarioRunRef:
		return "scenario_run_ref", map[string]string{"scenario_run_id": b.ScenarioRunRef.GetScenarioRunId()}, true
	case *runtimev1.ParticipationContextBlock_ScenarioBranchRef:
		return "scenario_branch_ref", map[string]string{"scenario_branch_id": b.ScenarioBranchRef.GetScenarioBranchId()}, true
	case *runtimev1.ParticipationContextBlock_VisibleSceneState:
		return "visible_scene_state", map[string]string{"scene_state_ref": b.VisibleSceneState.GetSceneStateRef()}, true
	case *runtimev1.ParticipationContextBlock_RecentSandboxTranscriptProjection:
		return "recent_sandbox_transcript_projection", map[string]string{
			"transcript_ref": b.RecentSandboxTranscriptProjection.GetTranscriptRef(),
			"branch_ref":     b.RecentSandboxTranscriptProjection.GetBranchRef(),
			"trust_posture":  enumNonZero(int32(b.RecentSandboxTranscriptProjection.GetTrustPosture())),
		}, true
	case *runtimev1.ParticipationContextBlock_WorldContextRef:
		return "world_context_ref", map[string]string{"world_context_id": b.WorldContextRef.GetWorldContextId()}, true
	case *runtimev1.ParticipationContextBlock_WorldEventRef:
		return "world_event_ref", map[string]string{"world_event_id": b.WorldEventRef.GetWorldEventId()}, true
	case *runtimev1.ParticipationContextBlock_VisibleWorldStateProjection:
		return "visible_world_state_projection", map[string]string{"world_state_ref": b.VisibleWorldStateProjection.GetWorldStateRef()}, true
	case *runtimev1.ParticipationContextBlock_RecentWorldTranscriptOrEventProjection:
		return "recent_world_transcript_or_event_projection", map[string]string{
			"event_or_transcript_ref": b.RecentWorldTranscriptOrEventProjection.GetEventOrTranscriptRef(),
			"trust_posture":           enumNonZero(int32(b.RecentWorldTranscriptOrEventProjection.GetTrustPosture())),
		}, true
	case *runtimev1.ParticipationContextBlock_ExternalParticipantIdentityRef:
		return "external_participant_identity_ref", map[string]string{
			"external_participant_id": b.ExternalParticipantIdentityRef.GetExternalParticipantId(),
			"identity_source":         enumNonZero(int32(b.ExternalParticipantIdentityRef.GetIdentitySource())),
		}, true
	case *runtimev1.ParticipationContextBlock_ExternalPayloadRef:
		return "external_payload_ref", map[string]string{
			"payload_ref":   b.ExternalPayloadRef.GetPayloadRef(),
			"protocol_kind": enumNonZero(int32(b.ExternalPayloadRef.GetProtocolKind())),
		}, true
	case *runtimev1.ParticipationContextBlock_GatewayVerdictRef:
		return "gateway_verdict_ref", map[string]string{"gateway_verdict_id": b.GatewayVerdictRef.GetGatewayVerdictId()}, true
	case *runtimev1.ParticipationContextBlock_DomainContextRef:
		return "domain_context_ref", map[string]string{
			"domain_ref":       b.DomainContextRef.GetDomainRef(),
			"transcript_owner": enumNonZero(int32(b.DomainContextRef.GetTranscriptOwner())),
		}, true
	case *runtimev1.ParticipationContextBlock_ToolOrCapabilityProjection:
		return "tool_or_capability_projection", map[string]string{
			"capability_ref": b.ToolOrCapabilityProjection.GetCapabilityRef(),
			"effect_class":   enumNonZero(int32(b.ToolOrCapabilityProjection.GetEffectClass())),
		}, true
	case *runtimev1.ParticipationContextBlock_DiagnosticProbeRef:
		return "diagnostic_probe_ref", map[string]string{
			"probe_id":   b.DiagnosticProbeRef.GetProbeId(),
			"probe_kind": b.DiagnosticProbeRef.GetProbeKind(),
		}, true
	default:
		return "", nil, false
	}
}

func enumNonZero(v int32) string {
	if v == 0 {
		return ""
	}
	return fmt.Sprintf("%d", v)
}

type participationAdmission struct {
	row        participationProfileRow
	blockKinds []string
	refusal    string
}

// admitParticipationSpec runs the K-AGCORE-081/074 fail-closed admission
// matrix shared by Validate and Execute.
func admitParticipationSpec(spec *runtimev1.ParticipationRequestSpec) (participationAdmission, error) {
	if spec == nil {
		return participationAdmission{}, status.Error(codes.InvalidArgument, "participation spec required")
	}
	row, known := participationProfileRowByKind(spec.GetProfileKind())
	if !known {
		return participationAdmission{}, status.Error(codes.InvalidArgument, "participation profile_kind unknown or unspecified")
	}
	if strings.TrimSpace(spec.GetAgentId()) == "" {
		return participationAdmission{}, status.Error(codes.InvalidArgument, "participation agent_id required")
	}
	admission := participationAdmission{row: row}
	if row.posture == "reference_existing_runtime_agent_service" {
		admission.refusal = participationRefusalCanonicalChat
		return admission, nil
	}
	seen := map[string]bool{}
	for _, block := range spec.GetContextBlocks() {
		kind, fields, ok := participationBlockFacts(block)
		if !ok {
			admission.refusal = "context_block_unknown"
			return admission, nil
		}
		blockRow, registered := participationContextBlockRowByKind(kind)
		if !registered || !blockRow.admitsProfile(spec.GetProfileKind()) {
			admission.refusal = "context_block_not_admitted_for_profile"
			return admission, nil
		}
		for field, value := range fields {
			if strings.TrimSpace(value) == "" {
				admission.refusal = "context_block_required_field_missing:" + kind + "." + field
				return admission, nil
			}
		}
		seen[kind] = true
		admission.blockKinds = append(admission.blockKinds, kind)
	}
	for _, required := range participationRequiredBlockKinds(spec.GetProfileKind()) {
		if !seen[required] {
			admission.refusal = "context_block_required_missing:" + required
			return admission, nil
		}
	}
	return admission, nil
}

func (s *Service) DescribeParticipationProfiles(_ context.Context, _ *runtimev1.DescribeParticipationProfilesRequest) (*runtimev1.DescribeParticipationProfilesResponse, error) {
	response := &runtimev1.DescribeParticipationProfilesResponse{}
	for _, row := range participationProfileRegistry {
		response.Profiles = append(response.Profiles, row.descriptor())
	}
	return response, nil
}

func (s *Service) DescribeParticipationContextBlocks(_ context.Context, req *runtimev1.DescribeParticipationContextBlocksRequest) (*runtimev1.DescribeParticipationContextBlocksResponse, error) {
	filter := req.GetProfileKind()
	response := &runtimev1.DescribeParticipationContextBlocksResponse{}
	for _, row := range participationContextBlockRegistry {
		if filter != runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_UNSPECIFIED && !row.admitsProfile(filter) {
			continue
		}
		response.ContextBlocks = append(response.ContextBlocks, row.descriptor())
	}
	return response, nil
}

func (s *Service) ValidateParticipation(_ context.Context, req *runtimev1.ValidateParticipationRequest) (*runtimev1.ValidateParticipationResponse, error) {
	admission, err := admitParticipationSpec(req.GetSpec())
	if err != nil {
		return nil, err
	}
	response := &runtimev1.ValidateParticipationResponse{
		Verdicts:                  participationVerdictSetForProfile(admission.row),
		ResolvedOutputDestination: admission.row.outputDestination,
	}
	if admission.refusal != "" {
		response.Admitted = false
		response.RefusalReason = admission.refusal
		return response, nil
	}
	response.Admitted = true
	return response, nil
}

func (s *Service) ExecuteParticipation(_ context.Context, req *runtimev1.ExecuteParticipationRequest) (*runtimev1.ExecuteParticipationResponse, error) {
	spec := req.GetSpec()
	admission, err := admitParticipationSpec(spec)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(spec.GetRequestId()) == "" {
		return nil, status.Error(codes.InvalidArgument, "participation request_id required")
	}
	store := s.participationStore()
	if existing := store.getByRequestID(spec.GetRequestId()); existing != nil {
		return participationExecuteResponse(existing), nil
	}
	now := time.Now().UTC()
	record := &participationRecord{
		ParticipationID:  fmt.Sprintf("participation-%d", now.UnixNano()),
		RequestID:        spec.GetRequestId(),
		ProfileKind:      spec.GetProfileKind(),
		AgentID:          spec.GetAgentId(),
		ParticipantRef:   spec.GetParticipantRef(),
		TriggerRef:       spec.GetTriggerRef(),
		IdentitySource:   admission.row.identitySource,
		ContextBlockRefs: admission.blockKinds,
		Verdicts:         participationVerdictSetForProfile(admission.row),
		PolicyVerdictRef: fmt.Sprintf("participation-policy/%d", admission.row.kind),
		AuditID:          fmt.Sprintf("participation-audit-%d", now.UnixNano()),
		CreatedAt:        now,
	}
	refusal := admission.refusal
	if refusal == "" {
		switch admission.row.posture {
		case "future_consumer_only":
			refusal = participationRefusalNotConsumable
		case "gateway_verdict_required":
			// K-AGCORE-079: external entry demands gateway verdict evidence and
			// an admitted entry boundary; production claim is currently scoped
			// to the MCP delegated adapter path only.
			if !participationHasBlockKind(admission.blockKinds, "gateway_verdict_ref") {
				refusal = participationRefusalGatewayVerdictMiss
			} else if boundary, ok := participationExternalBoundaryRowByIdentity(admission.row.identitySource); !ok || !boundary.productionClaimAllowed {
				refusal = participationRefusalEntryNotAdmitted
			} else {
				refusal = participationRefusalEngineNotBound
			}
		case "candidate_first_realm_commit":
			// K-AGCORE-076 blocks carry no Realm identity evidence
			// (owner/realm-agent/local-agent refs with subject verification),
			// which the shared candidate executor requires. The admitted
			// execution entry for this profile is CreateRealmGroupMessageCandidate
			// with full caller-held identity evidence; refusing here with a
			// routing reason keeps one execution truth (K-AGCORE-062) instead
			// of a second identity-less path.
			refusal = participationRefusalRealmGroupDedicated
		case "diagnostic_only":
			record.Status = runtimev1.ParticipationStatus_PARTICIPATION_STATUS_CANDIDATE_READY
			record.Candidate = participationDiagnosticCandidate(record, now)
		default:
			refusal = participationRefusalEngineNotBound
		}
	}
	if refusal != "" {
		record.Status = runtimev1.ParticipationStatus_PARTICIPATION_STATUS_BLOCKED
		record.RefusalReason = refusal
	}
	record = store.putIfAbsentByRequestID(record)
	return participationExecuteResponse(record), nil
}

func participationDiagnosticCandidate(record *participationRecord, now time.Time) *runtimev1.ParticipationCandidateRecord {
	return &runtimev1.ParticipationCandidateRecord{
		ParticipationId:        record.ParticipationID,
		ProfileKind:            record.ProfileKind,
		IdentitySource:         record.IdentitySource,
		ParticipantRef:         record.ParticipantRef,
		TriggerRef:             record.TriggerRef,
		ContextBlockRefs:       record.ContextBlockRefs,
		OutputDestination:      runtimev1.ParticipationOutputDestination_PARTICIPATION_OUTPUT_DESTINATION_DIAGNOSTIC_CANDIDATE,
		CandidateRef:           "diagnostic-candidate/" + record.ParticipationID,
		PolicyVerdictRef:       record.PolicyVerdictRef,
		MemoryReadVerdict:      record.Verdicts.GetMemoryRead(),
		MemoryWriteVerdict:     record.Verdicts.GetMemoryWrite(),
		CapabilityScopeVerdict: record.Verdicts.GetCapabilityScope(),
		AuditId:                record.AuditID,
		CreatedAt:              timestamppb.New(now),
	}
}

func participationExecuteResponse(record *participationRecord) *runtimev1.ExecuteParticipationResponse {
	response := &runtimev1.ExecuteParticipationResponse{
		ParticipationId: record.ParticipationID,
		Status:          record.Status,
		RefusalReason:   record.RefusalReason,
		AuditId:         record.AuditID,
	}
	if record.Candidate != nil {
		response.CandidateRef = record.Candidate.GetCandidateRef()
	}
	return response
}

func (s *Service) GetParticipationCandidate(_ context.Context, req *runtimev1.GetParticipationCandidateRequest) (*runtimev1.GetParticipationCandidateResponse, error) {
	record := s.participationStore().get(req.GetParticipationId())
	if record == nil {
		return nil, status.Error(codes.NotFound, "participation not found")
	}
	return &runtimev1.GetParticipationCandidateResponse{
		Candidate: record.Candidate,
		Status:    record.Status,
	}, nil
}

func (s *Service) GetParticipationVerdicts(_ context.Context, req *runtimev1.GetParticipationVerdictsRequest) (*runtimev1.GetParticipationVerdictsResponse, error) {
	record := s.participationStore().get(req.GetParticipationId())
	if record == nil {
		return nil, status.Error(codes.NotFound, "participation not found")
	}
	return &runtimev1.GetParticipationVerdictsResponse{
		Verdicts:         record.Verdicts,
		PolicyVerdictRef: record.PolicyVerdictRef,
	}, nil
}

func (s *Service) ListParticipationAuditEvents(_ context.Context, req *runtimev1.ListParticipationAuditEventsRequest) (*runtimev1.ListParticipationAuditEventsResponse, error) {
	record := s.participationStore().get(req.GetParticipationId())
	if record == nil {
		return nil, status.Error(codes.NotFound, "participation not found")
	}
	if agentID := strings.TrimSpace(req.GetAgentId()); agentID != "" && agentID != record.AgentID {
		return &runtimev1.ListParticipationAuditEventsResponse{}, nil
	}
	return &runtimev1.ListParticipationAuditEventsResponse{
		Events: participationAuditEvents(record),
	}, nil
}

func participationAuditEvents(record *participationRecord) []*runtimev1.ParticipationAuditEvent {
	kind := "participation_executed"
	reason := ""
	if record.RefusalReason != "" {
		kind = "participation_refused"
		reason = record.RefusalReason
	}
	return []*runtimev1.ParticipationAuditEvent{
		{
			AuditId:         record.AuditID + "/admission",
			ParticipationId: record.ParticipationID,
			EventKind:       "participation_admission_evaluated",
			ReasonCode:      "participation_profile_policy",
			ActorRef:        record.AgentID,
			ObservedAt:      timestamppb.New(record.CreatedAt),
		},
		{
			AuditId:         record.AuditID,
			ParticipationId: record.ParticipationID,
			EventKind:       kind,
			ReasonCode:      reason,
			ActorRef:        record.AgentID,
			ObservedAt:      timestamppb.New(record.CreatedAt),
		},
	}
}

func (s *Service) GetParticipationReplay(_ context.Context, req *runtimev1.GetParticipationReplayRequest) (*runtimev1.GetParticipationReplayResponse, error) {
	record := s.participationStore().get(req.GetParticipationId())
	if record == nil {
		return nil, status.Error(codes.NotFound, "participation not found")
	}
	outcome := runtimev1.ParticipationReplayOutcome_PARTICIPATION_REPLAY_OUTCOME_COMPLETED
	if record.RefusalReason != "" {
		outcome = runtimev1.ParticipationReplayOutcome_PARTICIPATION_REPLAY_OUTCOME_FAILED
	}
	var stages []*runtimev1.ParticipationReplayStage
	for _, event := range participationAuditEvents(record) {
		stages = append(stages, &runtimev1.ParticipationReplayStage{
			StageId:    event.GetAuditId(),
			State:      event.GetEventKind(),
			ReasonCode: event.GetReasonCode(),
			ObservedAt: event.GetObservedAt(),
		})
	}
	return &runtimev1.GetParticipationReplayResponse{
		Replay: &runtimev1.ParticipationReplay{
			ReplayId:        "participation-replay/" + record.ParticipationID,
			ParticipationId: record.ParticipationID,
			AgentId:         record.AgentID,
			ProfileKind:     record.ProfileKind,
			Outcome:         outcome,
			ReasonCode:      record.RefusalReason,
			Stages:          stages,
			Redacted:        false,
			ObservedAt:      timestamppb.New(record.CreatedAt),
		},
	}, nil
}

func participationHasBlockKind(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
