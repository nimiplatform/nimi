package runtimeagent

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	realmGroupMessageCandidateKind               = "REALM_GROUP_MESSAGE_CANDIDATE"
	realmGroupMessageCandidateMetaStateKey       = "realm_group_message_candidate_state"
	realmGroupMessageCandidateEvidenceRefPrefix  = "runtime://realm-group-message-candidates/"
	realmGroupMessageCandidateAuditDomain        = "runtime.agent.realm_group_message_candidate"
	realmGroupMessageCandidateAuditOperation     = "runtime.agent.realm_group_message_candidate.created"
	realmGroupMessageCandidatePolicyVerdictOp    = "participation_policy_verdict"
	realmGroupMessageCandidateDefaultTTL         = 5 * time.Minute
	realmGroupMessageCandidateDispositionMessage = "MESSAGE_CANDIDATE"
	realmGroupMessageCandidateDispositionRefusal = "REFUSAL_CANDIDATE"
	realmGroupCandidateVerdictAllow              = "ALLOW"
	realmGroupCandidateVerdictDeny               = "DENY"
)

type RealmGroupMessageCandidateExecutionInput struct {
	Context                *runtimev1.AgentRequestContext
	AppID                  string
	SubjectUserID          string
	RealmGroupThreadID     string
	RuntimeParticipantSlot  string
	OwnerUserID            string
	RuntimeSourceRef           string
	LocalAgentRef          string
	TriggerRef             string
	MembershipSnapshotRef  string
	ReadCursorRef          string
	ReplyTargetRef         string
	RoomOrchestrationRef   string
	IdempotencyKey         string
	ContextRefs            map[string]string
	CandidateID            string
	CandidateEvidenceRef   string
	OutputCandidateRef     string
	AuditLineageRef        string
	PolicyVerdictRef       string
	MemoryReadVerdict      string
	MemoryWriteVerdict     string
	CapabilityScopeVerdict string
	AuditID                string
	CreatedAt              time.Time
	ExpiresAt              time.Time
}

type RealmGroupMessageCandidateExecutionOutput struct {
	RuntimeTraceRef        string
	OutputCandidateRef     string
	AuditLineageRef        string
	PolicyVerdictRef       string
	ProfileKind            string
	IdentitySource         string
	ParticipantRef         string
	ContextBlockRefs       []string
	OutputDestination      string
	MemoryReadVerdict      string
	MemoryWriteVerdict     string
	CapabilityScopeVerdict string
	AuditID                string
	CommitDisposition      runtimev1.RealmGroupMessageCandidateCommitDisposition
	MessageType            string
	Body                   string
	RefusalCode            string
	RefusalReason          string
	ExpiresAt              time.Time
}

type RealmGroupMessageCandidateExecutor interface {
	CreateRealmGroupMessageCandidate(context.Context, RealmGroupMessageCandidateExecutionInput) (RealmGroupMessageCandidateExecutionOutput, error)
}

type rejectingRealmGroupMessageCandidateExecutor struct{}

func (rejectingRealmGroupMessageCandidateExecutor) CreateRealmGroupMessageCandidate(context.Context, RealmGroupMessageCandidateExecutionInput) (RealmGroupMessageCandidateExecutionOutput, error) {
	return RealmGroupMessageCandidateExecutionOutput{}, status.Error(codes.FailedPrecondition, "realm group message candidate executor is not configured")
}

func (s *Service) HasRealmGroupMessageCandidateExecutor() bool {
	if s == nil || s.isClosed() {
		return false
	}
	s.realmGroupCandidateMu.RLock()
	defer s.realmGroupCandidateMu.RUnlock()
	switch s.realmGroupCandidateExecutor.(type) {
	case nil, rejectingRealmGroupMessageCandidateExecutor:
		return false
	default:
		return true
	}
}

type realmGroupMessageCandidateEvidenceRecord struct {
	CandidateID            string   `json:"candidateId"`
	CandidateKind          string   `json:"candidateKind"`
	CandidateEvidenceRef   string   `json:"candidateEvidenceRef"`
	EvidenceHash           string   `json:"evidenceHash"`
	RuntimeTraceRef        string   `json:"runtimeTraceRef"`
	AppID                  string   `json:"appId"`
	SubjectUserID          string   `json:"subjectUserId"`
	RealmGroupThreadID     string   `json:"realmGroupThreadId"`
	RuntimeParticipantSlot  string   `json:"runtimeParticipantSlot"`
	OwnerUserID            string   `json:"ownerUserId"`
	RuntimeSourceRef           string   `json:"runtimeSourceRef"`
	LocalAgentRef          string   `json:"localAgentRef"`
	TriggerRef             string   `json:"triggerRef"`
	MembershipSnapshotRef  string   `json:"membershipSnapshotRef"`
	ReadCursorRef          string   `json:"readCursorRef"`
	ReplyTargetRef         string   `json:"replyTargetRef,omitempty"`
	RoomOrchestrationRef   string   `json:"roomOrchestrationRef"`
	OutputCandidateRef     string   `json:"outputCandidateRef"`
	AuditLineageRef        string   `json:"auditLineageRef"`
	PolicyVerdictRef       string   `json:"policyVerdictRef"`
	ProfileKind            string   `json:"profileKind"`
	IdentitySource         string   `json:"identitySource"`
	ParticipantRef         string   `json:"participantRef"`
	ContextBlockRefs       []string `json:"contextBlockRefs"`
	OutputDestination      string   `json:"outputDestination"`
	MemoryReadVerdict      string   `json:"memoryReadVerdict"`
	MemoryWriteVerdict     string   `json:"memoryWriteVerdict"`
	CapabilityScopeVerdict string   `json:"capabilityScopeVerdict"`
	AuditID                string   `json:"auditId"`
	CreatedAt              string   `json:"createdAt"`
	ExpiresAt              string   `json:"expiresAt"`
	CommitDisposition      string   `json:"commitDisposition"`
	MessageType            string   `json:"messageType,omitempty"`
	Body                   string   `json:"body,omitempty"`
	BodyHash               string   `json:"bodyHash,omitempty"`
	RefusalCode            string   `json:"refusalCode,omitempty"`
	RefusalReason          string   `json:"refusalReason,omitempty"`
	RefusalHash            string   `json:"refusalHash,omitempty"`
	IdempotencyScope       string   `json:"idempotencyScope"`
}

type persistedRealmGroupMessageCandidateState struct {
	SavedAt     string                                     `json:"savedAt"`
	Candidates  []realmGroupMessageCandidateEvidenceRecord `json:"candidates"`
	Idempotency map[string]string                          `json:"idempotency"`
}

func (s *Service) CreateRealmGroupMessageCandidate(ctx context.Context, req *runtimev1.CreateRealmGroupMessageCandidateRequest) (*runtimev1.CreateRealmGroupMessageCandidateResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "realm group message candidate request is required")
	}
	if s == nil || s.isClosed() {
		return nil, status.Error(codes.FailedPrecondition, "runtime agent service is closed")
	}
	input, idempotencyScope, err := validateRealmGroupMessageCandidateRequest(req)
	if err != nil {
		return nil, err
	}

	s.realmGroupCandidateMu.RLock()
	if candidateID := s.realmGroupCandidateIdempotency[idempotencyScope]; candidateID != "" {
		record := cloneRealmGroupMessageCandidateRecord(s.realmGroupCandidates[candidateID])
		s.realmGroupCandidateMu.RUnlock()
		if record == nil {
			return nil, status.Error(codes.Internal, "realm group message candidate idempotency state is corrupt")
		}
		return &runtimev1.CreateRealmGroupMessageCandidateResponse{Candidate: record.toCommitHandle()}, nil
	}
	executor := s.realmGroupCandidateExecutor
	s.realmGroupCandidateMu.RUnlock()
	if executor == nil {
		return nil, status.Error(codes.FailedPrecondition, "realm group message candidate executor is not configured")
	}

	now := time.Now().UTC().Truncate(time.Millisecond)
	candidateID := newRealmGroupMessageCandidateID(idempotencyScope, now)
	input.CandidateID = candidateID
	input.CandidateEvidenceRef = realmGroupMessageCandidateEvidenceRefPrefix + candidateID
	input.CreatedAt = now
	input.ExpiresAt = now.Add(realmGroupMessageCandidateDefaultTTL)
	if err := s.prepareRealmGroupMessageCandidateExecutionEvidence(&input); err != nil {
		return nil, err
	}

	output, err := executor.CreateRealmGroupMessageCandidate(ctx, input)
	if err != nil {
		return nil, err
	}
	record, err := buildRealmGroupMessageCandidateRecord(input, output, idempotencyScope)
	if err != nil {
		return nil, err
	}

	s.realmGroupCandidateMu.Lock()
	if candidateID := s.realmGroupCandidateIdempotency[idempotencyScope]; candidateID != "" {
		existing := cloneRealmGroupMessageCandidateRecord(s.realmGroupCandidates[candidateID])
		s.realmGroupCandidateMu.Unlock()
		if existing == nil {
			return nil, status.Error(codes.Internal, "realm group message candidate idempotency state is corrupt")
		}
		return &runtimev1.CreateRealmGroupMessageCandidateResponse{Candidate: existing.toCommitHandle()}, nil
	}
	s.realmGroupCandidates[record.CandidateID] = cloneRealmGroupMessageCandidateRecord(record)
	s.realmGroupCandidateIdempotency[idempotencyScope] = record.CandidateID
	snapshot := s.captureRealmGroupMessageCandidateStateLocked()
	s.realmGroupCandidateMu.Unlock()

	if err := s.persistRealmGroupMessageCandidateState(snapshot); err != nil {
		return nil, status.Errorf(codes.Internal, "persist realm group message candidate evidence: %v", err)
	}
	if err := s.appendRealmGroupMessageCandidateAudit(record); err != nil {
		return nil, err
	}
	return &runtimev1.CreateRealmGroupMessageCandidateResponse{Candidate: record.toCommitHandle()}, nil
}

func (s *Service) GetRealmGroupMessageCandidateEvidence(_ context.Context, req *runtimev1.GetRealmGroupMessageCandidateEvidenceRequest) (*runtimev1.GetRealmGroupMessageCandidateEvidenceResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "realm group message candidate evidence request is required")
	}
	if s == nil || s.isClosed() {
		return nil, status.Error(codes.FailedPrecondition, "runtime agent service is closed")
	}
	if strings.TrimSpace(req.GetCandidateKind()) != realmGroupMessageCandidateKind {
		return nil, status.Error(codes.InvalidArgument, "candidate_kind must be REALM_GROUP_MESSAGE_CANDIDATE")
	}
	candidateID := strings.TrimSpace(req.GetCandidateId())
	if candidateID == "" {
		return nil, status.Error(codes.InvalidArgument, "candidate_id is required")
	}
	s.realmGroupCandidateMu.RLock()
	record := cloneRealmGroupMessageCandidateRecord(s.realmGroupCandidates[candidateID])
	s.realmGroupCandidateMu.RUnlock()
	if record == nil {
		return nil, status.Error(codes.NotFound, "realm group message candidate evidence was not found")
	}
	if err := record.matchesEvidenceRequest(req); err != nil {
		return nil, err
	}
	return &runtimev1.GetRealmGroupMessageCandidateEvidenceResponse{Evidence: record.toEvidence()}, nil
}

func validateRealmGroupMessageCandidateRequest(req *runtimev1.CreateRealmGroupMessageCandidateRequest) (RealmGroupMessageCandidateExecutionInput, string, error) {
	ctx := req.GetContext()
	appID := strings.TrimSpace(ctx.GetAppId())
	subjectUserID := strings.TrimSpace(ctx.GetSubjectUserId())
	threadID := strings.TrimSpace(req.GetRealmGroupThreadId())
	slotID := strings.TrimSpace(req.GetRuntimeParticipantSlot())
	ownerUserID := strings.TrimSpace(req.GetOwnerUserId())
	runtimeSourceRef := strings.TrimSpace(req.GetRuntimeSourceRef())
	localAgentRef := strings.TrimSpace(req.GetLocalAgentRef())
	triggerRef := strings.TrimSpace(req.GetTriggerRef())
	idempotencyKey := strings.TrimSpace(req.GetIdempotencyKey())
	required := map[string]string{
		"context.app_id":            appID,
		"context.subject_user_id":   subjectUserID,
		"realm_group_thread_id":     threadID,
		"runtime_participant_slot": slotID,
		"owner_user_id":             ownerUserID,
		"runtime_source_ref":            runtimeSourceRef,
		"local_agent_ref":           localAgentRef,
		"trigger_ref":               triggerRef,
		"membership_snapshot_ref":   strings.TrimSpace(req.GetMembershipSnapshotRef()),
		"read_cursor_ref":           strings.TrimSpace(req.GetReadCursorRef()),
		"room_orchestration_ref":    strings.TrimSpace(req.GetRoomOrchestrationRef()),
		"idempotency_key":           idempotencyKey,
	}
	for field, value := range required {
		if value == "" {
			return RealmGroupMessageCandidateExecutionInput{}, "", status.Errorf(codes.InvalidArgument, "%s is required", field)
		}
	}
	if subjectUserID != ownerUserID {
		return RealmGroupMessageCandidateExecutionInput{}, "", status.Error(codes.PermissionDenied, "subject user must match local agent owner")
	}
	expectedLocalAgentRef := buildRealmGroupLocalAgentRef(ownerUserID, runtimeSourceRef)
	if localAgentRef != expectedLocalAgentRef {
		return RealmGroupMessageCandidateExecutionInput{}, "", status.Error(codes.InvalidArgument, "local_agent_ref does not match owner_user_id and runtime_source_ref")
	}
	for field, value := range map[string]string{
		"membership_snapshot_ref": strings.TrimSpace(req.GetMembershipSnapshotRef()),
		"read_cursor_ref":         strings.TrimSpace(req.GetReadCursorRef()),
	} {
		if err := validateRealmGroupCandidateBoundedRef(field, value, []string{"runtime://", "runtime-context://"}); err != nil {
			return RealmGroupMessageCandidateExecutionInput{}, "", err
		}
	}
	if err := validateRealmGroupCandidateBoundedRef("room_orchestration_ref", strings.TrimSpace(req.GetRoomOrchestrationRef()), []string{"runtime://"}); err != nil {
		return RealmGroupMessageCandidateExecutionInput{}, "", err
	}
	if err := validateRealmGroupCandidateAuthorityEvidenceRefs(
		triggerRef,
		strings.TrimSpace(req.GetMembershipSnapshotRef()),
		strings.TrimSpace(req.GetReadCursorRef()),
		strings.TrimSpace(req.GetRoomOrchestrationRef()),
	); err != nil {
		return RealmGroupMessageCandidateExecutionInput{}, "", err
	}
	contextRefs := cloneStringMap(req.GetContextRefs())
	for _, key := range requiredRealmGroupCandidateContextRefs {
		if strings.TrimSpace(contextRefs[key]) == "" {
			return RealmGroupMessageCandidateExecutionInput{}, "", status.Errorf(codes.InvalidArgument, "context_refs.%s is required", key)
		}
	}
	for key, value := range contextRefs {
		if _, ok := allowedRealmGroupCandidateContextRefs[key]; !ok {
			return RealmGroupMessageCandidateExecutionInput{}, "", status.Errorf(codes.InvalidArgument, "context_refs.%s is not admitted", key)
		}
		if err := validateRealmGroupCandidateBoundedRef("context_refs."+key, value, realmGroupCandidateContextRefPrefixes); err != nil {
			return RealmGroupMessageCandidateExecutionInput{}, "", err
		}
		if err := validateRealmGroupCandidateContextEvidenceRef(key, value); err != nil {
			return RealmGroupMessageCandidateExecutionInput{}, "", err
		}
	}
	input := RealmGroupMessageCandidateExecutionInput{
		Context:               ctx,
		AppID:                 appID,
		SubjectUserID:         subjectUserID,
		RealmGroupThreadID:    threadID,
		RuntimeParticipantSlot: slotID,
		OwnerUserID:           ownerUserID,
		RuntimeSourceRef:          runtimeSourceRef,
		LocalAgentRef:         localAgentRef,
		TriggerRef:            triggerRef,
		MembershipSnapshotRef: strings.TrimSpace(req.GetMembershipSnapshotRef()),
		ReadCursorRef:         strings.TrimSpace(req.GetReadCursorRef()),
		ReplyTargetRef:        strings.TrimSpace(req.GetReplyTargetRef()),
		RoomOrchestrationRef:  strings.TrimSpace(req.GetRoomOrchestrationRef()),
		IdempotencyKey:        idempotencyKey,
		ContextRefs:           contextRefs,
	}
	idempotencyScope := strings.Join([]string{
		appID,
		threadID,
		slotID,
		localAgentRef,
		triggerRef,
		idempotencyKey,
	}, "|")
	return input, idempotencyScope, nil
}

func buildRealmGroupMessageCandidateRecord(input RealmGroupMessageCandidateExecutionInput, output RealmGroupMessageCandidateExecutionOutput, idempotencyScope string) (*realmGroupMessageCandidateEvidenceRecord, error) {
	runtimeTraceRef := strings.TrimSpace(output.RuntimeTraceRef)
	outputCandidateRef := strings.TrimSpace(output.OutputCandidateRef)
	auditLineageRef := strings.TrimSpace(output.AuditLineageRef)
	policyVerdictRef := strings.TrimSpace(output.PolicyVerdictRef)
	profileKind := strings.TrimSpace(output.ProfileKind)
	identitySource := strings.TrimSpace(output.IdentitySource)
	participantRef := strings.TrimSpace(output.ParticipantRef)
	outputDestination := strings.TrimSpace(output.OutputDestination)
	memoryReadVerdict := strings.TrimSpace(output.MemoryReadVerdict)
	memoryWriteVerdict := strings.TrimSpace(output.MemoryWriteVerdict)
	capabilityScopeVerdict := strings.TrimSpace(output.CapabilityScopeVerdict)
	auditID := strings.TrimSpace(output.AuditID)
	contextBlockRefs := normalizedRealmGroupCandidateContextBlockRefs(output.ContextBlockRefs)
	for field, value := range map[string]string{
		"runtime_trace_ref":        runtimeTraceRef,
		"output_candidate_ref":     outputCandidateRef,
		"audit_lineage_ref":        auditLineageRef,
		"policy_verdict_ref":       policyVerdictRef,
		"profile_kind":             profileKind,
		"identity_source":          identitySource,
		"participant_ref":          participantRef,
		"output_destination":       outputDestination,
		"memory_read_verdict":      memoryReadVerdict,
		"memory_write_verdict":     memoryWriteVerdict,
		"capability_scope_verdict": capabilityScopeVerdict,
		"audit_id":                 auditID,
	} {
		if value == "" {
			return nil, status.Errorf(codes.InvalidArgument, "%s is required", field)
		}
	}
	if len(contextBlockRefs) == 0 {
		return nil, status.Error(codes.InvalidArgument, "context_block_refs are required")
	}
	for field, value := range map[string]string{
		"memory_read_verdict":      memoryReadVerdict,
		"memory_write_verdict":     memoryWriteVerdict,
		"capability_scope_verdict": capabilityScopeVerdict,
	} {
		if !isRealmGroupCandidateVerdictToken(value) {
			return nil, status.Errorf(codes.InvalidArgument, "%s must be an admitted participation verdict token", field)
		}
	}
	expectedEvidence := map[string][2]string{
		"output_candidate_ref":     {outputCandidateRef, strings.TrimSpace(input.OutputCandidateRef)},
		"audit_lineage_ref":        {auditLineageRef, strings.TrimSpace(input.AuditLineageRef)},
		"policy_verdict_ref":       {policyVerdictRef, strings.TrimSpace(input.PolicyVerdictRef)},
		"memory_read_verdict":      {memoryReadVerdict, strings.TrimSpace(input.MemoryReadVerdict)},
		"memory_write_verdict":     {memoryWriteVerdict, strings.TrimSpace(input.MemoryWriteVerdict)},
		"capability_scope_verdict": {capabilityScopeVerdict, strings.TrimSpace(input.CapabilityScopeVerdict)},
		"audit_id":                 {auditID, strings.TrimSpace(input.AuditID)},
	}
	for field, pair := range expectedEvidence {
		if pair[1] == "" {
			return nil, status.Errorf(codes.Internal, "%s policy evidence input is required", field)
		}
		if pair[0] != pair[1] {
			return nil, status.Errorf(codes.InvalidArgument, "%s does not match runtime policy evidence", field)
		}
	}
	expiresAt := input.ExpiresAt
	if !output.ExpiresAt.IsZero() {
		expiresAt = output.ExpiresAt.UTC().Truncate(time.Millisecond)
	}
	if !expiresAt.After(input.CreatedAt) {
		return nil, status.Error(codes.InvalidArgument, "candidate expires_at must be after created_at")
	}
	record := &realmGroupMessageCandidateEvidenceRecord{
		CandidateID:            input.CandidateID,
		CandidateKind:          realmGroupMessageCandidateKind,
		CandidateEvidenceRef:   input.CandidateEvidenceRef,
		RuntimeTraceRef:        runtimeTraceRef,
		AppID:                  input.AppID,
		SubjectUserID:          input.SubjectUserID,
		RealmGroupThreadID:     input.RealmGroupThreadID,
		RuntimeParticipantSlot:  input.RuntimeParticipantSlot,
		OwnerUserID:            input.OwnerUserID,
		RuntimeSourceRef:           input.RuntimeSourceRef,
		LocalAgentRef:          input.LocalAgentRef,
		TriggerRef:             input.TriggerRef,
		MembershipSnapshotRef:  input.MembershipSnapshotRef,
		ReadCursorRef:          input.ReadCursorRef,
		ReplyTargetRef:         input.ReplyTargetRef,
		RoomOrchestrationRef:   input.RoomOrchestrationRef,
		OutputCandidateRef:     outputCandidateRef,
		AuditLineageRef:        auditLineageRef,
		PolicyVerdictRef:       policyVerdictRef,
		ProfileKind:            profileKind,
		IdentitySource:         identitySource,
		ParticipantRef:         participantRef,
		ContextBlockRefs:       contextBlockRefs,
		OutputDestination:      outputDestination,
		MemoryReadVerdict:      memoryReadVerdict,
		MemoryWriteVerdict:     memoryWriteVerdict,
		CapabilityScopeVerdict: capabilityScopeVerdict,
		AuditID:                auditID,
		CreatedAt:              canonicalRealmGroupCandidateTime(input.CreatedAt),
		ExpiresAt:              canonicalRealmGroupCandidateTime(expiresAt),
		IdempotencyScope:       idempotencyScope,
	}
	switch output.CommitDisposition {
	case runtimev1.RealmGroupMessageCandidateCommitDisposition_REALM_GROUP_MESSAGE_CANDIDATE_COMMIT_DISPOSITION_MESSAGE_CANDIDATE:
		body := output.Body
		if strings.TrimSpace(output.MessageType) != "TEXT" || body == "" {
			return nil, status.Error(codes.InvalidArgument, "message candidate requires TEXT body")
		}
		record.CommitDisposition = realmGroupMessageCandidateDispositionMessage
		record.MessageType = "TEXT"
		record.Body = body
		record.BodyHash = sha256Hex(body)
	case runtimev1.RealmGroupMessageCandidateCommitDisposition_REALM_GROUP_MESSAGE_CANDIDATE_COMMIT_DISPOSITION_REFUSAL_CANDIDATE:
		refusalCode := strings.TrimSpace(output.RefusalCode)
		refusalReason := strings.TrimSpace(output.RefusalReason)
		if refusalCode == "" || refusalReason == "" {
			return nil, status.Error(codes.InvalidArgument, "refusal candidate requires refusal_code and refusal_reason")
		}
		record.CommitDisposition = realmGroupMessageCandidateDispositionRefusal
		record.RefusalCode = refusalCode
		record.RefusalReason = refusalReason
		record.RefusalHash = sha256Hex(refusalReason)
	default:
		return nil, status.Error(codes.InvalidArgument, "unsupported realm group message candidate disposition")
	}
	hash, err := realmGroupMessageCandidateEvidenceHash(record)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "hash realm group message candidate evidence: %v", err)
	}
	record.EvidenceHash = hash
	return record, nil
}

func (r *realmGroupMessageCandidateEvidenceRecord) matchesEvidenceRequest(req *runtimev1.GetRealmGroupMessageCandidateEvidenceRequest) error {
	ctx := req.GetContext()
	appID := strings.TrimSpace(ctx.GetAppId())
	subjectUserID := strings.TrimSpace(ctx.GetSubjectUserId())
	if appID == "" || subjectUserID == "" {
		return status.Error(codes.InvalidArgument, "context.app_id and context.subject_user_id are required")
	}
	if r.AppID != appID || r.SubjectUserID != subjectUserID || r.OwnerUserID != subjectUserID {
		return status.Error(codes.PermissionDenied, "realm group message candidate evidence context does not match owner")
	}
	checks := []struct {
		ok      bool
		message string
	}{
		{r.CandidateEvidenceRef == strings.TrimSpace(req.GetCandidateEvidenceRef()), "candidate_evidence_ref mismatch"},
		{r.EvidenceHash == strings.TrimSpace(req.GetEvidenceHash()), "evidence_hash mismatch"},
		{r.RuntimeTraceRef == strings.TrimSpace(req.GetRuntimeTraceRef()), "runtime_trace_ref mismatch"},
		{r.RuntimeParticipantSlot == strings.TrimSpace(req.GetExpectedRuntimeParticipantSlot()), "runtime_participant_slot mismatch"},
		{r.LocalAgentRef == strings.TrimSpace(req.GetExpectedLocalAgentRef()), "local_agent_ref mismatch"},
		{r.TriggerRef == strings.TrimSpace(req.GetTriggerRef()), "trigger_ref mismatch"},
		{r.RealmGroupThreadID == strings.TrimSpace(req.GetTargetRealmGroupThreadId()), "realm_group_thread_id mismatch"},
	}
	for _, check := range checks {
		if !check.ok {
			return status.Error(codes.InvalidArgument, check.message)
		}
	}
	expiresAt, err := time.Parse("2006-01-02T15:04:05.000Z", r.ExpiresAt)
	if err != nil {
		return status.Error(codes.Internal, "stored candidate expires_at is invalid")
	}
	if !expiresAt.After(time.Now().UTC()) {
		return status.Error(codes.FailedPrecondition, "realm group message candidate evidence is expired")
	}
	return nil
}

func (r *realmGroupMessageCandidateEvidenceRecord) toCommitHandle() *runtimev1.RealmGroupMessageCandidateCommitHandle {
	if r == nil {
		return nil
	}
	createdAt := parseRealmGroupCandidateTimestamp(r.CreatedAt)
	expiresAt := parseRealmGroupCandidateTimestamp(r.ExpiresAt)
	return &runtimev1.RealmGroupMessageCandidateCommitHandle{
		CandidateId:            r.CandidateID,
		CandidateKind:          r.CandidateKind,
		CandidateEvidenceRef:   r.CandidateEvidenceRef,
		EvidenceHash:           r.EvidenceHash,
		RuntimeTraceRef:        r.RuntimeTraceRef,
		RealmGroupThreadId:     r.RealmGroupThreadID,
		RuntimeParticipantSlot:  r.RuntimeParticipantSlot,
		OwnerUserId:            r.OwnerUserID,
		RuntimeSourceRef:           r.RuntimeSourceRef,
		LocalAgentRef:          r.LocalAgentRef,
		TriggerRef:             r.TriggerRef,
		OutputCandidateRef:     r.OutputCandidateRef,
		AuditLineageRef:        r.AuditLineageRef,
		PolicyVerdictRef:       r.PolicyVerdictRef,
		ProfileKind:            r.ProfileKind,
		IdentitySource:         r.IdentitySource,
		ParticipantRef:         r.ParticipantRef,
		ContextBlockRefs:       append([]string(nil), r.ContextBlockRefs...),
		OutputDestination:      r.OutputDestination,
		MemoryReadVerdict:      r.MemoryReadVerdict,
		MemoryWriteVerdict:     r.MemoryWriteVerdict,
		CapabilityScopeVerdict: r.CapabilityScopeVerdict,
		AuditId:                r.AuditID,
		CreatedAt:              timestamppb.New(createdAt),
		ExpiresAt:              timestamppb.New(expiresAt),
		CommitDisposition:      realmGroupCandidateDispositionProto(r.CommitDisposition),
	}
}

func (r *realmGroupMessageCandidateEvidenceRecord) toEvidence() *runtimev1.RealmGroupMessageCandidateEvidence {
	if r == nil {
		return nil
	}
	createdAt := parseRealmGroupCandidateTimestamp(r.CreatedAt)
	expiresAt := parseRealmGroupCandidateTimestamp(r.ExpiresAt)
	return &runtimev1.RealmGroupMessageCandidateEvidence{
		CandidateId:            r.CandidateID,
		CandidateKind:          r.CandidateKind,
		RealmGroupThreadId:     r.RealmGroupThreadID,
		RuntimeParticipantSlot:  r.RuntimeParticipantSlot,
		OwnerUserId:            r.OwnerUserID,
		RuntimeSourceRef:           r.RuntimeSourceRef,
		LocalAgentRef:          r.LocalAgentRef,
		TriggerRef:             r.TriggerRef,
		OutputCandidateRef:     r.OutputCandidateRef,
		EvidenceHash:           r.EvidenceHash,
		RuntimeTraceRef:        r.RuntimeTraceRef,
		AuditLineageRef:        r.AuditLineageRef,
		PolicyVerdictRef:       r.PolicyVerdictRef,
		ProfileKind:            r.ProfileKind,
		IdentitySource:         r.IdentitySource,
		ParticipantRef:         r.ParticipantRef,
		ContextBlockRefs:       append([]string(nil), r.ContextBlockRefs...),
		OutputDestination:      r.OutputDestination,
		MemoryReadVerdict:      r.MemoryReadVerdict,
		MemoryWriteVerdict:     r.MemoryWriteVerdict,
		CapabilityScopeVerdict: r.CapabilityScopeVerdict,
		AuditId:                r.AuditID,
		CreatedAt:              timestamppb.New(createdAt),
		ExpiresAt:              timestamppb.New(expiresAt),
		CommitDisposition:      realmGroupCandidateDispositionProto(r.CommitDisposition),
		MessageType:            r.MessageType,
		Body:                   r.Body,
		BodyHash:               r.BodyHash,
		RefusalCode:            r.RefusalCode,
		RefusalReason:          r.RefusalReason,
		RefusalHash:            r.RefusalHash,
	}
}

func realmGroupCandidateDispositionProto(value string) runtimev1.RealmGroupMessageCandidateCommitDisposition {
	switch value {
	case realmGroupMessageCandidateDispositionMessage:
		return runtimev1.RealmGroupMessageCandidateCommitDisposition_REALM_GROUP_MESSAGE_CANDIDATE_COMMIT_DISPOSITION_MESSAGE_CANDIDATE
	case realmGroupMessageCandidateDispositionRefusal:
		return runtimev1.RealmGroupMessageCandidateCommitDisposition_REALM_GROUP_MESSAGE_CANDIDATE_COMMIT_DISPOSITION_REFUSAL_CANDIDATE
	default:
		return runtimev1.RealmGroupMessageCandidateCommitDisposition_REALM_GROUP_MESSAGE_CANDIDATE_COMMIT_DISPOSITION_UNSPECIFIED
	}
}

func realmGroupMessageCandidateEvidenceHash(record *realmGroupMessageCandidateEvidenceRecord) (string, error) {
	covered := map[string]any{
		"candidateId":           record.CandidateID,
		"candidateKind":         record.CandidateKind,
		"appId":                 record.AppID,
		"subjectUserId":         record.SubjectUserID,
		"realmGroupThreadId":    record.RealmGroupThreadID,
		"runtimeParticipantSlot": record.RuntimeParticipantSlot,
		"ownerUserId":           record.OwnerUserID,
		"runtimeSourceRef":          record.RuntimeSourceRef,
		"localAgentRef":         record.LocalAgentRef,
		"triggerRef":            record.TriggerRef,
		"membershipSnapshotRef": record.MembershipSnapshotRef,
		"readCursorRef":         record.ReadCursorRef,
		"roomOrchestrationRef":  record.RoomOrchestrationRef,
		"outputCandidateRef":    record.OutputCandidateRef,
		"auditLineageRef":       record.AuditLineageRef,
		"policyVerdictRef":      record.PolicyVerdictRef,
		"createdAt":             record.CreatedAt,
		"expiresAt":             record.ExpiresAt,
		"commitDisposition":     record.CommitDisposition,
	}
	if record.MessageType != "" {
		covered["messageType"] = record.MessageType
	}
	if record.ReplyTargetRef != "" {
		covered["replyTargetRef"] = record.ReplyTargetRef
	}
	if record.Body != "" {
		covered["body"] = record.Body
	}
	if record.BodyHash != "" {
		covered["bodyHash"] = record.BodyHash
	}
	if record.RefusalCode != "" {
		covered["refusalCode"] = record.RefusalCode
	}
	if record.RefusalReason != "" {
		covered["refusalReason"] = record.RefusalReason
	}
	if record.RefusalHash != "" {
		covered["refusalHash"] = record.RefusalHash
	}
	canonical, err := canonicalRealmGroupCandidateJSON(covered)
	if err != nil {
		return "", err
	}
	return sha256Hex(canonical), nil
}

func canonicalRealmGroupCandidateJSON(value any) (string, error) {
	switch typed := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys)*2+1)
		parts = append(parts, "{")
		for index, key := range keys {
			if index > 0 {
				parts = append(parts, ",")
			}
			keyJSON, err := json.Marshal(key)
			if err != nil {
				return "", err
			}
			valueJSON, err := canonicalRealmGroupCandidateJSON(typed[key])
			if err != nil {
				return "", err
			}
			parts = append(parts, string(keyJSON), ":", valueJSON)
		}
		parts = append(parts, "}")
		return strings.Join(parts, ""), nil
	case string:
		raw, err := json.Marshal(typed)
		return string(raw), err
	default:
		raw, err := json.Marshal(typed)
		return string(raw), err
	}
}

func (s *Service) captureRealmGroupMessageCandidateStateLocked() persistedRealmGroupMessageCandidateState {
	candidates := make([]realmGroupMessageCandidateEvidenceRecord, 0, len(s.realmGroupCandidates))
	for _, record := range s.realmGroupCandidates {
		if record == nil {
			continue
		}
		candidates = append(candidates, *cloneRealmGroupMessageCandidateRecord(record))
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].CandidateID < candidates[j].CandidateID
	})
	return persistedRealmGroupMessageCandidateState{
		SavedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		Candidates:  candidates,
		Idempotency: cloneStringMap(s.realmGroupCandidateIdempotency),
	}
}

func (s *Service) persistRealmGroupMessageCandidateState(snapshot persistedRealmGroupMessageCandidateState) error {
	if s == nil || s.backend == nil {
		return nil
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("marshal realm group message candidate state: %w", err)
	}
	return s.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(
			`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
			realmGroupMessageCandidateMetaStateKey,
			string(raw),
		)
		return err
	})
}

func (s *Service) loadRealmGroupMessageCandidateStateFromDB() error {
	if s == nil || s.stateRepo == nil {
		return nil
	}
	raw, err := s.stateRepo.runtimeAgentMetaValue(realmGroupMessageCandidateMetaStateKey)
	if err != nil {
		return err
	}
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var state persistedRealmGroupMessageCandidateState
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return fmt.Errorf("parse realm group message candidate state: %w", err)
	}
	s.realmGroupCandidateMu.Lock()
	defer s.realmGroupCandidateMu.Unlock()
	clear(s.realmGroupCandidates)
	clear(s.realmGroupCandidateIdempotency)
	for _, candidate := range state.Candidates {
		record := candidate
		if strings.TrimSpace(record.CandidateID) == "" {
			continue
		}
		s.realmGroupCandidates[record.CandidateID] = &record
	}
	for scope, candidateID := range state.Idempotency {
		if strings.TrimSpace(scope) == "" || strings.TrimSpace(candidateID) == "" {
			continue
		}
		s.realmGroupCandidateIdempotency[scope] = candidateID
	}
	return nil
}

func cloneStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(input))
	for key, value := range input {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		cloned[key] = strings.TrimSpace(value)
	}
	return cloned
}
