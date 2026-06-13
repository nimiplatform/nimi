package runtimeagent

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	realmGroupMessageCandidatePromptMaxTokens = 768
	realmGroupMessageCandidateExecutorAppID   = "runtime.agent.internal.realm_group_candidate"
	realmGroupMessageCandidateRefMaxBytes     = 256
	realmGroupMessageCandidateRoutingProfile  = "runtime-participation-profile/realm_group_agent"

	realmGroupCandidateContextThreadSnapshot = "realm.group.thread.snapshot"
	realmGroupCandidateContextSlotSnapshot   = "realm.group.agent_slot.snapshot"
	realmGroupCandidateContextRecentMessages = "realm.group.recent_messages.snapshot"
	realmGroupCandidateContextReplyTarget    = "realm.group.reply_target.snapshot"
	realmGroupCandidateContextPolicy         = "realm.group.policy.snapshot"
)

var (
	requiredRealmGroupCandidateContextRefs = []string{
		realmGroupCandidateContextThreadSnapshot,
		realmGroupCandidateContextSlotSnapshot,
		realmGroupCandidateContextRecentMessages,
	}
	allowedRealmGroupCandidateContextRefs = map[string]struct{}{
		realmGroupCandidateContextThreadSnapshot: {},
		realmGroupCandidateContextSlotSnapshot:   {},
		realmGroupCandidateContextRecentMessages: {},
		realmGroupCandidateContextReplyTarget:    {},
		realmGroupCandidateContextPolicy:         {},
	}
	realmGroupCandidateGeneralRefPrefixes = []string{
		"realm://",
		"realm-context://",
		"runtime://",
		"runtime-context://",
	}
	realmGroupCandidateContextRefPrefixes = []string{
		"realm-context://",
		"runtime-context://",
	}
	realmGroupCandidateLocalAgentRefPrefixes = []string{
		"local-agent:",
	}
)

type realmGroupMessageCandidateScenarioExecutor interface {
	ExecuteScenario(context.Context, *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error)
}

type aiBackedRealmGroupMessageCandidateExecutor struct {
	ai      realmGroupMessageCandidateScenarioExecutor
	binding PublicChatBindingResolver
}

type realmGroupMessageCandidateExecutorAPML struct {
	XMLName xml.Name                           `xml:"realm-group-message-candidate"`
	Message *realmGroupMessageCandidateText    `xml:"message"`
	Refusal *realmGroupMessageCandidateRefusal `xml:"refusal"`
}

type realmGroupMessageCandidateText struct {
	Body string `xml:",chardata"`
}

type realmGroupMessageCandidateRefusal struct {
	Code   string `xml:"code,attr"`
	Reason string `xml:",chardata"`
}

func NewAIBackedRealmGroupMessageCandidateExecutor(ai realmGroupMessageCandidateScenarioExecutor) RealmGroupMessageCandidateExecutor {
	return NewAIBackedRealmGroupMessageCandidateExecutorWithBinding(ai, nil)
}

func NewAIBackedRealmGroupMessageCandidateExecutorWithBinding(ai realmGroupMessageCandidateScenarioExecutor, binding PublicChatBindingResolver) RealmGroupMessageCandidateExecutor {
	if ai == nil {
		return rejectingRealmGroupMessageCandidateExecutor{}
	}
	if binding == nil {
		binding = rejectingPublicChatBindingResolver{}
	}
	return &aiBackedRealmGroupMessageCandidateExecutor{ai: ai, binding: binding}
}

func (e *aiBackedRealmGroupMessageCandidateExecutor) CreateRealmGroupMessageCandidate(
	ctx context.Context,
	input RealmGroupMessageCandidateExecutionInput,
) (RealmGroupMessageCandidateExecutionOutput, error) {
	if e == nil || e.ai == nil {
		return RealmGroupMessageCandidateExecutionOutput{}, status.Error(codes.FailedPrecondition, "realm group message candidate executor is not configured")
	}
	execReq, err := e.buildRealmGroupMessageCandidateScenarioRequest(ctx, input)
	if err != nil {
		return RealmGroupMessageCandidateExecutionOutput{}, err
	}
	resp, err := e.ai.ExecuteScenario(ctx, execReq)
	if err != nil {
		return RealmGroupMessageCandidateExecutionOutput{}, err
	}
	text := strings.TrimSpace(resp.GetOutput().GetTextGenerate().GetText())
	return decodeRealmGroupMessageCandidateExecutorResult(text, input, resp)
}

func (e *aiBackedRealmGroupMessageCandidateExecutor) buildRealmGroupMessageCandidateScenarioRequest(ctx context.Context, input RealmGroupMessageCandidateExecutionInput) (*runtimev1.ExecuteScenarioRequest, error) {
	if err := validateRealmGroupMessageCandidateExecutorInput(input); err != nil {
		return nil, err
	}
	systemPrompt, userPrompt, err := realmGroupMessageCandidatePrompts(input)
	if err != nil {
		return nil, err
	}
	if e == nil || e.binding == nil {
		return nil, status.Error(codes.FailedPrecondition, "realm group participation routing resolver is not configured")
	}
	resolved, err := e.binding.ResolvePublicChatBinding(ctx, PublicChatBindingResolutionRequest{
		ModelID:         realmGroupMessageCandidateRoutingProfile,
		RouteHint:       runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED,
		SubjectUserID:   input.OwnerUserID,
		SystemPrompt:    systemPrompt,
		Messages:        []*runtimev1.ChatMessage{{Role: "user", Content: userPrompt}},
		MaxOutputTokens: realmGroupMessageCandidatePromptMaxTokens,
	})
	if err != nil {
		if _, ok := status.FromError(err); !ok {
			return nil, status.Error(codes.FailedPrecondition, err.Error())
		}
		return nil, err
	}
	if strings.TrimSpace(resolved.ModelID) == "" {
		return nil, status.Error(codes.FailedPrecondition, "realm group participation routing resolver returned empty model")
	}
	if resolved.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		return nil, status.Error(codes.FailedPrecondition, "realm group participation routing resolver returned unspecified route")
	}
	return &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         realmGroupMessageCandidateExecutorAppID,
			SubjectUserId: input.OwnerUserID,
			ModelId:       strings.TrimSpace(resolved.ModelID),
			RoutePolicy:   resolved.RoutePolicy,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     10_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					SystemPrompt: systemPrompt,
					MaxTokens:    realmGroupMessageCandidatePromptMaxTokens,
					Input: []*runtimev1.ChatMessage{
						{
							Role:    "user",
							Content: userPrompt,
						},
					},
				},
			},
		},
	}, nil
}

func validateRealmGroupMessageCandidateExecutorInput(input RealmGroupMessageCandidateExecutionInput) error {
	required := map[string]string{
		"candidate_id":              input.CandidateID,
		"candidate_evidence_ref":    input.CandidateEvidenceRef,
		"realm_group_thread_id":     input.RealmGroupThreadID,
		"realm_group_agent_slot_id": input.RealmGroupAgentSlotID,
		"owner_user_id":             input.OwnerUserID,
		"realm_agent_id":            input.RealmAgentID,
		"local_agent_ref":           input.LocalAgentRef,
		"trigger_ref":               input.TriggerRef,
		"membership_snapshot_ref":   input.MembershipSnapshotRef,
		"read_cursor_ref":           input.ReadCursorRef,
		"room_orchestration_ref":    input.RoomOrchestrationRef,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return status.Errorf(codes.InvalidArgument, "%s is required for realm group message candidate execution", field)
		}
	}
	for field, value := range map[string]string{
		"candidate_id":              input.CandidateID,
		"realm_group_thread_id":     input.RealmGroupThreadID,
		"realm_group_agent_slot_id": input.RealmGroupAgentSlotID,
		"owner_user_id":             input.OwnerUserID,
		"realm_agent_id":            input.RealmAgentID,
	} {
		if err := validateRealmGroupCandidateOpaqueIdentifier(field, value); err != nil {
			return err
		}
	}
	if input.CandidateEvidenceRef != realmGroupMessageCandidateEvidenceRefPrefix+input.CandidateID {
		return status.Error(codes.InvalidArgument, "candidate_evidence_ref must match runtime candidate evidence ref")
	}
	if err := validateRealmGroupCandidateBoundedRef("local_agent_ref", input.LocalAgentRef, realmGroupCandidateLocalAgentRefPrefixes); err != nil {
		return err
	}
	for field, value := range map[string]string{
		"candidate_evidence_ref":  input.CandidateEvidenceRef,
		"trigger_ref":             input.TriggerRef,
		"membership_snapshot_ref": input.MembershipSnapshotRef,
		"read_cursor_ref":         input.ReadCursorRef,
	} {
		if err := validateRealmGroupCandidateBoundedRef(field, value, realmGroupCandidateGeneralRefPrefixes); err != nil {
			return err
		}
	}
	if err := validateRealmGroupCandidateBoundedRef("room_orchestration_ref", input.RoomOrchestrationRef, []string{"runtime://"}); err != nil {
		return err
	}
	if strings.TrimSpace(input.ReplyTargetRef) != "" {
		if err := validateRealmGroupCandidateBoundedRef("reply_target_ref", input.ReplyTargetRef, realmGroupCandidateGeneralRefPrefixes); err != nil {
			return err
		}
	}
	for _, key := range requiredRealmGroupCandidateContextRefs {
		if strings.TrimSpace(input.ContextRefs[key]) == "" {
			return status.Errorf(codes.InvalidArgument, "context_refs.%s is required for realm group message candidate execution", key)
		}
	}
	for key, value := range input.ContextRefs {
		if _, ok := allowedRealmGroupCandidateContextRefs[key]; !ok {
			return status.Errorf(codes.InvalidArgument, "context_refs.%s is not admitted for realm group message candidate execution", key)
		}
		if err := validateRealmGroupCandidateBoundedRef("context_refs."+key, value, realmGroupCandidateContextRefPrefixes); err != nil {
			return err
		}
	}
	return nil
}

func validateRealmGroupCandidateOpaqueIdentifier(field string, value string) error {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return status.Errorf(codes.InvalidArgument, "%s is required for realm group message candidate execution", field)
	}
	if normalized != value {
		return status.Errorf(codes.InvalidArgument, "%s must be canonical without surrounding whitespace", field)
	}
	if len(normalized) > realmGroupMessageCandidateRefMaxBytes {
		return status.Errorf(codes.InvalidArgument, "%s exceeds identifier length limit", field)
	}
	if containsRealmGroupCandidateRawPayloadShape(normalized) {
		return status.Errorf(codes.InvalidArgument, "%s must be an opaque identifier, not raw content", field)
	}
	return nil
}

func validateRealmGroupCandidateBoundedRef(field string, value string, allowedPrefixes []string) error {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return status.Errorf(codes.InvalidArgument, "%s is required for realm group message candidate execution", field)
	}
	if normalized != value {
		return status.Errorf(codes.InvalidArgument, "%s must be a canonical reference without surrounding whitespace", field)
	}
	if len(normalized) > realmGroupMessageCandidateRefMaxBytes {
		return status.Errorf(codes.InvalidArgument, "%s exceeds reference length limit", field)
	}
	if containsRealmGroupCandidateRawPayloadShape(normalized) {
		return status.Errorf(codes.InvalidArgument, "%s must be a bounded reference, not raw content", field)
	}
	for _, prefix := range allowedPrefixes {
		if strings.HasPrefix(normalized, prefix) && len(normalized) > len(prefix) {
			return nil
		}
	}
	return status.Errorf(codes.InvalidArgument, "%s must use an admitted reference scheme", field)
}

func validateRealmGroupCandidateAuthorityEvidenceRefs(triggerRef string, membershipSnapshotRef string, readCursorRef string, roomOrchestrationRef string) error {
	if err := validateRealmGroupCandidateTriggerEvidenceRef(triggerRef); err != nil {
		return err
	}
	if !realmGroupCandidateRefHasToken(membershipSnapshotRef, "membership-snapshot") {
		return status.Error(codes.InvalidArgument, "membership_snapshot_ref must identify membership snapshot evidence")
	}
	if !realmGroupCandidateRefHasToken(readCursorRef, "read-cursor") {
		return status.Error(codes.InvalidArgument, "read_cursor_ref must identify read cursor evidence")
	}
	if !realmGroupCandidateRefHasToken(roomOrchestrationRef, "realm-group") || !realmGroupCandidateRefHasToken(roomOrchestrationRef, "orchestration") {
		return status.Error(codes.InvalidArgument, "room_orchestration_ref must identify realm_group room orchestration evidence")
	}
	return nil
}

func validateRealmGroupCandidateTriggerEvidenceRef(value string) error {
	if !realmGroupCandidateRefHasAnyToken(value, "trigger", "trigger-event") {
		return status.Error(codes.InvalidArgument, "trigger_ref must identify trigger evidence")
	}
	switch {
	case realmGroupCandidateRefHasToken(value, "canonical-user-turn"):
		return nil
	case realmGroupCandidateRefHasToken(value, "external-protocol-signal"):
		return nil
	default:
		return status.Error(codes.InvalidArgument, "trigger_ref must identify an admitted room trigger class")
	}
}

func validateRealmGroupCandidateContextEvidenceRef(key string, value string) error {
	switch key {
	case realmGroupCandidateContextThreadSnapshot:
		if realmGroupCandidateRefHasToken(value, "thread") {
			return nil
		}
	case realmGroupCandidateContextSlotSnapshot:
		if realmGroupCandidateRefHasToken(value, "slot") || realmGroupCandidateRefHasToken(value, "agent-slot") {
			return nil
		}
	case realmGroupCandidateContextRecentMessages:
		if realmGroupCandidateRefHasAnyToken(value, "recent-message", "recent-messages") {
			return nil
		}
	case realmGroupCandidateContextReplyTarget:
		if realmGroupCandidateRefHasAnyToken(value, "reply-target", "reply-to") {
			return nil
		}
	case realmGroupCandidateContextPolicy:
		if realmGroupCandidateRefHasToken(value, "policy") {
			return nil
		}
	default:
		return status.Errorf(codes.InvalidArgument, "context_refs.%s is not admitted for realm group message candidate evidence", key)
	}
	return status.Errorf(codes.InvalidArgument, "context_refs.%s must identify its admitted evidence class", key)
}

func realmGroupCandidateRefHasAnyToken(value string, tokens ...string) bool {
	for _, token := range tokens {
		if realmGroupCandidateRefHasToken(value, token) {
			return true
		}
	}
	return false
}

func realmGroupCandidateRefHasToken(value string, token string) bool {
	normalized := strings.NewReplacer("_", "-", ".", "-", ":", "/", "#", "/", "?", "/", "&", "/", "=", "/").Replace(strings.ToLower(strings.TrimSpace(value)))
	want := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(token)), "_", "-")
	for _, part := range strings.Split(normalized, "/") {
		if part == want || part == want+"s" || strings.HasPrefix(part, want+"-") || strings.HasSuffix(part, "-"+want) || strings.Contains(part, "-"+want+"-") {
			return true
		}
	}
	return false
}

func containsRealmGroupCandidateRawPayloadShape(value string) bool {
	if strings.ContainsAny(value, " \t\r\n{}[]<>\"'`\\") {
		return true
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return true
		}
	}
	lower := strings.ToLower(value)
	rawMarkers := []string{
		"prompt:",
		"body:",
		"messages:",
		"transcript:",
		"refusalreason:",
		"refusal_reason:",
		"<message",
		"<refusal",
	}
	for _, marker := range rawMarkers {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func realmGroupMessageCandidatePrompts(input RealmGroupMessageCandidateExecutionInput) (string, string, error) {
	contextRefs := make(map[string]string, len(input.ContextRefs))
	for key, value := range input.ContextRefs {
		contextRefs[key] = strings.TrimSpace(value)
	}
	contextRaw, err := json.Marshal(struct {
		CandidateID           string            `json:"candidate_id"`
		CandidateEvidenceRef  string            `json:"candidate_evidence_ref"`
		RealmGroupThreadID    string            `json:"realm_group_thread_id"`
		RealmGroupAgentSlotID string            `json:"realm_group_agent_slot_id"`
		OwnerUserID           string            `json:"owner_user_id"`
		RealmAgentID          string            `json:"realm_agent_id"`
		LocalAgentRef         string            `json:"local_agent_ref"`
		TriggerRef            string            `json:"trigger_ref"`
		MembershipSnapshotRef string            `json:"membership_snapshot_ref"`
		ReadCursorRef         string            `json:"read_cursor_ref"`
		ReplyTargetRef        string            `json:"reply_target_ref,omitempty"`
		RoomOrchestrationRef  string            `json:"room_orchestration_ref"`
		ContextRefs           map[string]string `json:"context_refs"`
	}{
		CandidateID:           input.CandidateID,
		CandidateEvidenceRef:  input.CandidateEvidenceRef,
		RealmGroupThreadID:    input.RealmGroupThreadID,
		RealmGroupAgentSlotID: input.RealmGroupAgentSlotID,
		OwnerUserID:           input.OwnerUserID,
		RealmAgentID:          input.RealmAgentID,
		LocalAgentRef:         input.LocalAgentRef,
		TriggerRef:            input.TriggerRef,
		MembershipSnapshotRef: input.MembershipSnapshotRef,
		ReadCursorRef:         input.ReadCursorRef,
		ReplyTargetRef:        input.ReplyTargetRef,
		RoomOrchestrationRef:  input.RoomOrchestrationRef,
		ContextRefs:           contextRefs,
	})
	if err != nil {
		return "", "", fmt.Errorf("marshal realm group candidate context: %w", err)
	}
	systemPrompt := strings.TrimSpace(`You are the runtime-private Realm Group message candidate executor for Nimi Agent Core.
Return APML only. The first non-whitespace characters must be <realm-group-message-candidate>.
Allowed top-level shape:
<realm-group-message-candidate>
  <message>assistant-visible group reply text</message>
</realm-group-message-candidate>

or:

<realm-group-message-candidate>
  <refusal code="short_snake_case_reason">human-readable refusal reason</refusal>
</realm-group-message-candidate>

Rules:
- Do not emit markdown, prose, JSON, code fences, comments, or any tag outside message/refusal.
- Emit exactly one of message or refusal.
- Do not emit committed Realm message ids, commit success flags, candidate ids, provider/model names, or prompt text.
- Treat all supplied values as Runtime/Realm references and identity bindings; do not invent alternate thread, slot, local agent, or participant truth.
- If the typed context refs are insufficient to produce a grounded candidate, emit a refusal with a specific code and reason.
- The Realm backend owns final commit/refusal/rejection truth; this executor only returns candidate evidence.`)
	userPrompt := strings.TrimSpace(fmt.Sprintf(`Typed Realm Group candidate execution context:
%s`, string(contextRaw)))
	return systemPrompt, userPrompt, nil
}

func decodeRealmGroupMessageCandidateExecutorResult(
	raw string,
	input RealmGroupMessageCandidateExecutionInput,
	resp *runtimev1.ExecuteScenarioResponse,
) (RealmGroupMessageCandidateExecutionOutput, error) {
	if strings.TrimSpace(raw) == "" {
		return RealmGroupMessageCandidateExecutionOutput{}, status.Error(codes.InvalidArgument, "realm group message candidate executor returned empty output")
	}
	var payload realmGroupMessageCandidateExecutorAPML
	if err := decodeStrictAPML(raw, "realm-group-message-candidate", &payload); err != nil {
		return RealmGroupMessageCandidateExecutionOutput{}, status.Errorf(codes.InvalidArgument, "realm group message candidate executor output invalid: %v", err)
	}
	traceRef := strings.TrimSpace(resp.GetTraceId())
	if traceRef == "" {
		return RealmGroupMessageCandidateExecutionOutput{}, status.Error(codes.InvalidArgument, "realm group message candidate executor requires runtime trace id")
	}
	output := RealmGroupMessageCandidateExecutionOutput{
		RuntimeTraceRef:        traceRef,
		OutputCandidateRef:     input.OutputCandidateRef,
		AuditLineageRef:        input.AuditLineageRef,
		PolicyVerdictRef:       input.PolicyVerdictRef,
		ProfileKind:            "realm_group_agent",
		IdentitySource:         "runtime_local_agent_identity",
		ParticipantRef:         input.LocalAgentRef,
		ContextBlockRefs:       realmGroupCandidateContextBlockRefs(input.ContextRefs),
		OutputDestination:      "realm_group_thread:" + input.RealmGroupThreadID,
		MemoryReadVerdict:      input.MemoryReadVerdict,
		MemoryWriteVerdict:     input.MemoryWriteVerdict,
		CapabilityScopeVerdict: input.CapabilityScopeVerdict,
		AuditID:                input.AuditID,
	}
	hasMessage := payload.Message != nil && strings.TrimSpace(payload.Message.Body) != ""
	hasRefusal := payload.Refusal != nil && (strings.TrimSpace(payload.Refusal.Code) != "" || strings.TrimSpace(payload.Refusal.Reason) != "")
	if hasMessage == hasRefusal {
		return RealmGroupMessageCandidateExecutionOutput{}, status.Error(codes.InvalidArgument, "realm group message candidate executor must return exactly one message or refusal")
	}
	if hasMessage {
		output.CommitDisposition = runtimev1.RealmGroupMessageCandidateCommitDisposition_REALM_GROUP_MESSAGE_CANDIDATE_COMMIT_DISPOSITION_MESSAGE_CANDIDATE
		output.MessageType = "TEXT"
		output.Body = strings.TrimSpace(payload.Message.Body)
		return output, nil
	}
	refusalCode := strings.TrimSpace(payload.Refusal.Code)
	refusalReason := strings.TrimSpace(payload.Refusal.Reason)
	if refusalCode == "" || refusalReason == "" {
		return RealmGroupMessageCandidateExecutionOutput{}, status.Error(codes.InvalidArgument, "realm group message candidate refusal requires code and reason")
	}
	output.CommitDisposition = runtimev1.RealmGroupMessageCandidateCommitDisposition_REALM_GROUP_MESSAGE_CANDIDATE_COMMIT_DISPOSITION_REFUSAL_CANDIDATE
	output.RefusalCode = refusalCode
	output.RefusalReason = refusalReason
	return output, nil
}

func admittedRealmGroupCandidateContextRefKeys() []string {
	keys := make([]string, 0, len(allowedRealmGroupCandidateContextRefs))
	for key := range allowedRealmGroupCandidateContextRefs {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
