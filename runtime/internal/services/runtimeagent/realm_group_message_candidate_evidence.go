package runtimeagent

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) prepareRealmGroupMessageCandidateExecutionEvidence(input *RealmGroupMessageCandidateExecutionInput) error {
	if input == nil {
		return status.Error(codes.Internal, "realm group message candidate execution input is required")
	}
	if s == nil || s.auditStore == nil {
		return status.Error(codes.FailedPrecondition, "runtime audit store is required for realm group message candidate evidence")
	}
	baseRef := strings.TrimSpace(input.CandidateEvidenceRef)
	if baseRef == "" || strings.TrimSpace(input.CandidateID) == "" {
		return status.Error(codes.Internal, "realm group message candidate evidence ref is required")
	}
	row, ok := participationProfileRowByKind(runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_REALM_GROUP_AGENT)
	if !ok {
		return status.Error(codes.FailedPrecondition, "realm group agent participation profile is not admitted")
	}
	verdicts := participationVerdictSetForProfile(row)
	memoryRead, err := realmGroupCandidateVerdictToken(verdicts.GetMemoryRead().GetDecision())
	if err != nil {
		return status.Errorf(codes.FailedPrecondition, "realm group memory read verdict invalid: %v", err)
	}
	memoryWrite, err := realmGroupCandidateVerdictToken(verdicts.GetMemoryWrite().GetDecision())
	if err != nil {
		return status.Errorf(codes.FailedPrecondition, "realm group memory write verdict invalid: %v", err)
	}
	capabilityScope, err := realmGroupCandidateVerdictToken(verdicts.GetCapabilityScope().GetDecision())
	if err != nil {
		return status.Errorf(codes.FailedPrecondition, "realm group capability scope verdict invalid: %v", err)
	}
	input.OutputCandidateRef = baseRef + "/output"
	input.AuditLineageRef = baseRef + "/audit"
	input.PolicyVerdictRef = baseRef + "/policy/" + realmGroupMessageCandidatePolicyVerdictOp
	input.MemoryReadVerdict = memoryRead
	input.MemoryWriteVerdict = memoryWrite
	input.CapabilityScopeVerdict = capabilityScope
	input.AuditID = baseRef + "/audit/" + realmGroupMessageCandidateAuditOperation
	return nil
}

func realmGroupCandidateVerdictToken(decision runtimev1.ParticipationVerdictDecision) (string, error) {
	switch decision {
	case runtimev1.ParticipationVerdictDecision_PARTICIPATION_VERDICT_DECISION_ALLOW:
		return realmGroupCandidateVerdictAllow, nil
	case runtimev1.ParticipationVerdictDecision_PARTICIPATION_VERDICT_DECISION_DENY:
		return realmGroupCandidateVerdictDeny, nil
	default:
		return "", fmt.Errorf("unsupported participation verdict decision %s", decision.String())
	}
}

func isRealmGroupCandidateVerdictToken(value string) bool {
	switch strings.TrimSpace(value) {
	case realmGroupCandidateVerdictAllow, realmGroupCandidateVerdictDeny:
		return true
	default:
		return false
	}
}

func (s *Service) appendRealmGroupMessageCandidateAudit(record *realmGroupMessageCandidateEvidenceRecord) error {
	if record == nil {
		return status.Error(codes.Internal, "realm group message candidate audit record is required")
	}
	if s == nil || s.auditStore == nil {
		return status.Error(codes.FailedPrecondition, "runtime audit store is required for realm group message candidate evidence")
	}
	payload, err := structpb.NewStruct(map[string]any{
		"candidate_id":             record.CandidateID,
		"candidate_kind":           record.CandidateKind,
		"candidate_evidence_ref":   record.CandidateEvidenceRef,
		"evidence_hash":            record.EvidenceHash,
		"realm_group_thread_id":    record.RealmGroupThreadID,
		"runtime_participant_slot": record.RuntimeParticipantSlot,
		"runtime_source_ref":       record.RuntimeSourceRef,
		"local_agent_ref":          record.LocalAgentRef,
		"trigger_ref":              record.TriggerRef,
		"policy_verdict_ref":       record.PolicyVerdictRef,
		"memory_read_verdict":      record.MemoryReadVerdict,
		"memory_write_verdict":     record.MemoryWriteVerdict,
		"capability_scope_verdict": record.CapabilityScopeVerdict,
		"commit_disposition":       record.CommitDisposition,
	})
	if err != nil {
		return status.Errorf(codes.Internal, "marshal realm group message candidate audit payload: %v", err)
	}
	s.auditStore.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:              record.AuditID,
		AppId:                record.AppID,
		SubjectUserId:        record.SubjectUserID,
		Domain:               realmGroupMessageCandidateAuditDomain,
		Operation:            realmGroupMessageCandidateAuditOperation,
		ReasonCode:           runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:              record.RuntimeTraceRef,
		Timestamp:            timestamppb.New(parseRealmGroupCandidateTimestamp(record.CreatedAt)),
		Payload:              payload,
		CallerKind:           runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		CallerId:             "runtime.agent.service",
		SurfaceId:            realmGroupMessageCandidateAuditDomain,
		Capability:           "runtime.agent.realm_group_message_candidate.create",
		PrincipalId:          record.LocalAgentRef,
		PrincipalType:        "runtime_local_agent",
		ResourceSelectorHash: record.RealmGroupThreadID,
		RequestId:            record.CandidateID,
	})
	return nil
}
