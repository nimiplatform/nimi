package agentsession

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const (
	bodyStepMaxDuration       = 600 * time.Second
	bodyStepMaxRequestBytes   = 2 * 1024 * 1024
	bodyStepMaxResponseBytes  = 2 * 1024 * 1024
	maxIssuedToolCallWindow   = 512
	defaultContextBudgetToken = uint32(64000)
)

// BodyStepExecutionInput carries validated, ledger-verified inputs into the
// model execution adapter for StreamLocalAgentBodyStep.
type BodyStepExecutionInput struct {
	AccountID           string
	AgentBinding        string
	WorkSessionRef      string
	Purpose             runtimev1.BodyStepPurpose
	EndpointKey         string
	Priority            scheduler.Priority
	AdvisoryNonceBlock  string
	Tools               []*runtimev1.BodyToolDefinition
	CanonicalMessages   []*runtimev1.BodyWorkingMessage
	KeptTailMessages    []*runtimev1.BodyWorkingMessage
	ContextBudgetTokens uint32
}

// BodyStepExecutionResult reports model step output & usage.
type BodyStepExecutionResult struct {
	FinishReason        string
	UsageInputTokens    int64
	UsageOutputTokens   int64
	AssistantText       string
	CompactionSummary   string
	IssuedToolCalls     []*runtimev1.BodyToolCall
	ContextBudgetTokens uint32
}

// BodyStepEmitter pushes live streaming deltas from model execution to StreamLocalAgentBodyStep.
type BodyStepEmitter interface {
	SendTextDelta(delta string) error
	SendReasoningSummaryDelta(delta string) error
	SendToolCallActivity(activity textbehavior.ToolCallActivity) error
	SendToolCall(call *runtimev1.BodyToolCall) error
}

// BodyStepExecutor executes one verified Body inference or compaction step.
type BodyStepExecutor func(ctx context.Context, input BodyStepExecutionInput, emitter BodyStepEmitter) (BodyStepExecutionResult, error)

// ReadSetQualifier verifies whether the session's active Cognition read set is
// still valid. Returning (false, epoch, nil) indicates memory was mutated/forgotten.
type ReadSetQualifier func(ctx context.Context, accountID, agentBinding, workSessionRef string, lastEpoch int64) (valid bool, currentEpoch int64, err error)

// MilestoneHook receives milestone session projections (for Stage 3 Cognition v5 pointer commits).
type MilestoneHook func(ctx context.Context, accountID, agentBinding, workSessionRef, milestoneKind, topicSummary string, deliverables []string) error

// MemoryCleanupHook neutralizes Cognition outbox and forgets session-lineage memories during DeleteSession.
type MemoryCleanupHook func(ctx context.Context, accountID, agentBinding, workSessionRef string) (uint32, error)

// BrainTurnExecutor runs Brain-native inline turns (general_inbox / channel_external).
type BrainTurnExecutor func(ctx context.Context, accountID string, session *runtimev1.WorkSessionRecord, userText, requestID string, emit func(eventType, payloadJSON string) error) error

// canonicalOrderWorkingMessages aligns Runtime ledger verification with
// pi-durable's `orderToolResults`: each assistant turn carrying tool calls is
// immediately followed by its matching toolResult messages in assistant order,
// followed by subsequent user messages.
// @nimi-authority: rule.nimi.runtime.agent-participation.body-step-symbiosis
func canonicalOrderWorkingMessages(messages []*runtimev1.BodyWorkingMessage) []*runtimev1.BodyWorkingMessage {
	if len(messages) == 0 {
		return nil
	}
	toolResultsByID := make(map[string][]*runtimev1.BodyWorkingMessage)
	for _, msg := range messages {
		if msg == nil {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(msg.GetRole()), "toolResult") || strings.EqualFold(strings.TrimSpace(msg.GetRole()), "tool") {
			id := strings.TrimSpace(msg.GetToolCallId())
			toolResultsByID[id] = append(toolResultsByID[id], msg)
		}
	}
	consumed := make(map[*runtimev1.BodyWorkingMessage]bool)
	ordered := make([]*runtimev1.BodyWorkingMessage, 0, len(messages))
	for _, msg := range messages {
		if msg == nil || consumed[msg] {
			continue
		}
		role := strings.TrimSpace(msg.GetRole())
		if strings.EqualFold(role, "toolResult") || strings.EqualFold(role, "tool") {
			continue
		}
		ordered = append(ordered, msg)
		consumed[msg] = true
		if strings.EqualFold(role, "assistant") {
			callIDs := extractAssistantToolCallIDs(msg.GetContentJson())
			for _, id := range callIDs {
				for _, tr := range toolResultsByID[id] {
					if !consumed[tr] {
						ordered = append(ordered, tr)
						consumed[tr] = true
					}
				}
			}
		}
	}
	// Append any remaining unmatched toolResult messages deterministically in original order.
	for _, msg := range messages {
		if msg != nil && !consumed[msg] {
			ordered = append(ordered, msg)
			consumed[msg] = true
		}
	}
	return ordered
}

func extractAssistantToolCallIDs(contentJSON string) []string {
	var parsed any
	if err := json.Unmarshal([]byte(contentJSON), &parsed); err != nil {
		return nil
	}
	var ids []string
	var walk func(v any)
	walk = func(v any) {
		switch node := v.(type) {
		case []any:
			for _, item := range node {
				walk(item)
			}
		case map[string]any:
			typ, _ := node["type"].(string)
			if typ == "toolCall" || typ == "tool_use" || typ == "tool_call" {
				if id, ok := node["id"].(string); ok && strings.TrimSpace(id) != "" {
					ids = append(ids, strings.TrimSpace(id))
				} else if id, ok := node["callId"].(string); ok && strings.TrimSpace(id) != "" {
					ids = append(ids, strings.TrimSpace(id))
				}
			}
			for _, child := range node {
				walk(child)
			}
		}
	}
	walk(parsed)
	return ids
}

func extractCompactionSummaryText(msg *runtimev1.BodyWorkingMessage) string {
	if msg == nil {
		return ""
	}
	raw := strings.TrimSpace(msg.GetContentJson())
	if raw == "" {
		return ""
	}
	var unwrapped string
	if err := json.Unmarshal([]byte(raw), &unwrapped); err == nil {
		return strings.TrimSpace(unwrapped)
	}
	return raw
}

func canonicalizeMessagesBytes(messages []*runtimev1.BodyWorkingMessage) []byte {
	type canonMsg struct {
		Role       string `json:"role"`
		Content    string `json:"content"`
		ToolCallID string `json:"toolCallId,omitempty"`
		ToolName   string `json:"toolName,omitempty"`
		IsError    bool   `json:"isError,omitempty"`
	}
	ordered := canonicalOrderWorkingMessages(messages)
	out := make([]canonMsg, 0, len(ordered))
	for _, m := range ordered {
		out = append(out, canonMsg{
			Role:       strings.TrimSpace(m.GetRole()),
			Content:    strings.TrimSpace(m.GetContentJson()),
			ToolCallID: strings.TrimSpace(m.GetToolCallId()),
			ToolName:   strings.TrimSpace(m.GetToolName()),
			IsError:    m.GetIsError(),
		})
	}
	b, _ := json.Marshal(out)
	return b
}

func (s *Service) computeHMAC(parts ...[]byte) string {
	mac := hmac.New(sha256.New, s.ledgerSecret)
	for i, part := range parts {
		if i > 0 {
			_, _ = mac.Write([]byte{0x00})
		}
		_, _ = mac.Write(part)
	}
	return hex.EncodeToString(mac.Sum(nil))
}

func buildUntrustedAdvisoryBlock(advisory *runtimev1.BodyAdvisoryContext) string {
	if advisory == nil {
		return ""
	}
	var nonceBytes [16]byte
	_, _ = rand.Read(nonceBytes[:])
	nonce := hex.EncodeToString(nonceBytes[:])
	sanitize := func(v string) string {
		clean := strings.ReplaceAll(v, "</untrusted_workspace_data>", "")
		clean = strings.ReplaceAll(clean, "<untrusted_workspace_data", "")
		return strings.TrimSpace(clean)
	}
	toolNames := make([]string, 0, len(advisory.GetToolNames()))
	for _, name := range advisory.GetToolNames() {
		if clean := sanitize(name); clean != "" {
			toolNames = append(toolNames, clean)
		}
	}
	payload, _ := json.Marshal(map[string]any{
		"workspaceName":  sanitize(advisory.GetWorkspaceName()),
		"permissionMode": sanitize(advisory.GetPermissionMode()),
		"toolNames":      toolNames,
	})
	return fmt.Sprintf("<untrusted_workspace_data nonce=\"%s\">%s</untrusted_workspace_data>", nonce, string(payload))
}

func decodeIssuedWindow(raw string) []string {
	var out []string
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}

func appendIssuedToolCallIDs(existing []string, calls []*runtimev1.BodyToolCall) []string {
	seen := make(map[string]struct{}, len(existing))
	for _, id := range existing {
		seen[id] = struct{}{}
	}
	for _, c := range calls {
		id := strings.TrimSpace(c.GetCallId())
		if id == "" {
			continue
		}
		if _, exists := seen[id]; !exists {
			seen[id] = struct{}{}
			existing = append(existing, id)
		}
	}
	if len(existing) > maxIssuedToolCallWindow {
		existing = existing[len(existing)-maxIssuedToolCallWindow:]
	}
	return existing
}

func containsString(list []string, target string) bool {
	for _, item := range list {
		if item == target {
			return true
		}
	}
	return false
}

type issuedToolMeta struct {
	ToolName string `json:"toolName"`
	ArgsHash string `json:"argsHash"`
}

func decodeIssuedToolMeta(raw string) map[string]issuedToolMeta {
	out := make(map[string]issuedToolMeta)
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	return out
}

func mergeIssuedToolMeta(existing map[string]issuedToolMeta, window []string, calls []*runtimev1.BodyToolCall) map[string]issuedToolMeta {
	if existing == nil {
		existing = make(map[string]issuedToolMeta)
	}
	for _, c := range calls {
		id := strings.TrimSpace(c.GetCallId())
		if id == "" {
			continue
		}
		existing[id] = issuedToolMeta{
			ToolName: strings.TrimSpace(c.GetName()),
			ArgsHash: sha256HexString(c.GetArgumentsJson()),
		}
	}
	keep := make(map[string]struct{}, len(window))
	for _, id := range window {
		keep[id] = struct{}{}
	}
	for id := range existing {
		if _, ok := keep[id]; !ok {
			delete(existing, id)
		}
	}
	return existing
}

func isAllowedBodyWorkingRole(role string) bool {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "user", "assistant", "tool", "toolresult":
		return true
	default:
		return false
	}
}

func actionKindAllowedByPermissionMode(permissionMode, actionKind string) bool {
	kind := strings.ToLower(strings.TrimSpace(actionKind))
	mode := strings.ToLower(strings.TrimSpace(permissionMode))
	switch kind {
	case "file_write", "file_edit", "file_delete", "shell_exec", "process_exec":
		return mode != "readonly" && mode != "companion"
	default:
		return true
	}
}

func (s *Service) verifyPostCompactionAnchor(ref, postCompactionMAC string, canonicalWorking, explicitKept []*runtimev1.BodyWorkingMessage) bool {
	if len(canonicalWorking) == 0 {
		return false
	}
	summaryText := extractCompactionSummaryText(canonicalWorking[0])
	if len(explicitKept) > 0 {
		canonicalKept := canonicalOrderWorkingMessages(explicitKept)
		expected := s.computeHMAC([]byte(ref), []byte(summaryText), canonicalizeMessagesBytes(canonicalKept))
		if !hmac.Equal([]byte(expected), []byte(postCompactionMAC)) {
			return false
		}
		// Bind explicit kept_tail_messages strictly to canonicalWorking[1 : 1+len(canonicalKept)]!
		if len(canonicalWorking) < 1+len(canonicalKept) {
			return false
		}
		return bytes.Equal(
			canonicalizeMessagesBytes(canonicalWorking[1:1+len(canonicalKept)]),
			canonicalizeMessagesBytes(canonicalKept),
		)
	}
	for end := 1; end <= len(canonicalWorking); end++ {
		expected := s.computeHMAC([]byte(ref), []byte(summaryText), canonicalizeMessagesBytes(canonicalWorking[1:end]))
		if hmac.Equal([]byte(expected), []byte(postCompactionMAC)) {
			return true
		}
	}
	return false
}

// StreamLocalAgentBodyStep enforces the strict Brain-Body symbiosis ledger,
// rejects non-allowlisted roles (including system/developer), serializes steps
// per session, wraps body_advisory_context in a per-turn random-nonce block,
// qualifies Cognition read sets synchronously, enforces physical-endpoint
// scheduling, buffers tool_call frames until ledger commit, and caps 600s/2MiB.
// @nimi-authority: rule.nimi.runtime.agent-participation.body-step-symbiosis
func (s *Service) StreamLocalAgentBodyStep(req *runtimev1.StreamLocalAgentBodyStepRequest, stream grpc.ServerStreamingServer[runtimev1.BodyStepStreamEvent]) error {
	ctx := stream.Context()
	decision, err := s.authorize(ctx, localappop.OperationAgentBodyPCStepStream)
	if err != nil {
		return err
	}
	if req == nil || strings.TrimSpace(req.GetWorkSessionRef()) == "" || strings.TrimSpace(req.GetDeviceId()) == "" || req.GetLeaseEpoch() <= 0 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if proto.Size(req) > bodyStepMaxRequestBytes {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_APP_MESSAGE_PAYLOAD_TOO_LARGE)
	}
	ns, err := normalizeBodyNamespace(decision, req.GetCapabilityNamespace())
	if err != nil {
		return err
	}
	now := s.now().UTC()
	activeLease, err := s.store.VerifyActiveLease(ctx, decision.AccountID, strings.TrimSpace(req.GetDeviceId()), ns, decision.RegisteredAppSubject, req.GetLeaseEpoch(), now)
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !activeLease {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_BODY_LEASE_CONFLICT)
	}

	ref := strings.TrimSpace(req.GetWorkSessionRef())
	unlockStep := s.lockSessionStep(ref)
	defer unlockStep()

	sess, err := s.store.GetSession(ctx, decision.AccountID, ref)
	if errors.Is(err, errSessionNotFound) {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if sess.Record.GetOwnerBodyKind() != ns || sess.Record.GetStatus() == "deleted" || sess.Record.GetStatus() == "deleting" {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_CONFLICT)
	}

	// 1. Strict role allowlist (user / assistant / tool / toolResult ONLY).
	for _, msg := range append(append([]*runtimev1.BodyWorkingMessage(nil), req.GetWorkingMessages()...), req.GetKeptTailMessages()...) {
		if msg == nil {
			continue
		}
		if !isAllowedBodyWorkingRole(msg.GetRole()) {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
		}
	}

	// 2. Load ledger & verify issued_tool_call_ids_window + last_step_mac + post_compaction_mac continuity.
	ledger, err := s.store.GetLedger(ctx, decision.AccountID, ref)
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if ledger == nil {
		ledger = &ledgerRecord{
			WorkSessionRef:               ref,
			AccountID:                    decision.AccountID,
			AgentBinding:                 sess.Record.GetAgentBinding(),
			IssuedToolCallIDsJSON:        "[]",
			IssuedToolArgsJSON:           "{}",
			EffectiveContextBudgetTokens: defaultContextBudgetToken,
		}
	}
	issuedWindow := decodeIssuedWindow(ledger.IssuedToolCallIDsJSON)
	issuedMeta := decodeIssuedToolMeta(ledger.IssuedToolArgsJSON)
	canonicalWorking := canonicalOrderWorkingMessages(req.GetWorkingMessages())
	for _, msg := range canonicalWorking {
		role := strings.ToLower(strings.TrimSpace(msg.GetRole()))
		if role == "toolresult" || role == "tool" {
			callID := strings.TrimSpace(msg.GetToolCallId())
			if callID == "" || !containsString(issuedWindow, callID) {
				return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
			}
		}
	}
	// Verify continuity anchor on EVERY step (including subsequent COMPACTION steps):
	// - Once compacted (PostCompactionMAC != ""), canonicalWorking must begin with the signed compaction summary + kept tail.
	// - Otherwise, if LastStepMAC != "" and LastCommittedCount > 0, canonicalWorking must extend the previously signed prefix!
	if ledger.PostCompactionMAC != "" {
		explicitKept := req.GetKeptTailMessages()
		if req.GetPurpose() == runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_COMPACTION {
			// On a new compaction step, req.KeptTailMessages is the NEW tail to keep, so verify the OLD anchor against canonicalWorking prefixes.
			explicitKept = nil
		}
		if !s.verifyPostCompactionAnchor(ref, ledger.PostCompactionMAC, canonicalWorking, explicitKept) {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
		}
	} else if ledger.LastStepMAC != "" && ledger.LastCommittedCount > 0 {
		if len(canonicalWorking) < ledger.LastCommittedCount {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
		}
		expectedPrefixMAC := s.computeHMAC([]byte(ref), canonicalizeMessagesBytes(canonicalWorking[:ledger.LastCommittedCount]))
		if !hmac.Equal([]byte(expectedPrefixMAC), []byte(ledger.LastStepMAC)) {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
		}
	}

	// 3. Synchronously qualify Cognition read set BEFORE inference.
	readSetEpoch := ledger.ReadSetEpoch
	if s.readSetQualifier != nil {
		valid, currentEpoch, qErr := s.readSetQualifier(ctx, decision.AccountID, sess.Record.GetAgentBinding(), ref, ledger.ReadSetEpoch)
		if qErr != nil {
			return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		if !valid {
			invEnv := &runtimev1.BodyOutboxEnvelope{
				OutboxId:            newID("outbox"),
				DeviceId:            strings.TrimSpace(req.GetDeviceId()),
				CapabilityNamespace: ns,
				WorkSessionRef:      ref,
				CommandKind:         runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_INVALIDATE_MEMORY,
				PayloadJson:         fmt.Sprintf(`{"workSessionRef":%q,"epoch":%d}`, ref, currentEpoch),
				CreatedAt:           formatRFC3339(now),
				AgentBinding:        sess.Record.GetAgentBinding(),
			}
			_ = s.store.EnqueueOutbox(ctx, decision.AccountID, invEnv, "")
			s.notifyOutboxSubscribers(decision.AccountID, invEnv.GetDeviceId(), ns, invEnv)
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_MEMORY_INVALIDATED)
		}
		readSetEpoch = currentEpoch
	}

	// 4. Independent 600s deadline & physical-endpoint scheduling with P0/P2 priority.
	stepCtx, stepCancel := context.WithTimeout(ctx, bodyStepMaxDuration)
	defer stepCancel()

	priority := scheduler.PriorityP0Foreground
	if req.GetPurpose() == runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_COMPACTION {
		priority = scheduler.PriorityP2Background
	}
	endpointKey := s.resolveEndpointKey(sess.Record.GetAgentBinding())
	if s.scheduler != nil {
		releaseSlot, _, schedErr := s.scheduler.AcquireForEndpoint(stepCtx, endpointKey, priority, stepCancel)
		if schedErr != nil {
			return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AGENT_BUSY)
		}
		defer releaseSlot()
	}

	advisoryBlock := buildUntrustedAdvisoryBlock(req.GetBodyAdvisoryContext())
	budgetTokens := ledger.EffectiveContextBudgetTokens
	if budgetTokens == 0 {
		budgetTokens = defaultContextBudgetToken
	}

	emitter := &bodyStepStreamEmitter{
		ctx:          stepCtx,
		stream:       stream,
		budgetTokens: budgetTokens,
	}

	execInput := BodyStepExecutionInput{
		AccountID:           decision.AccountID,
		AgentBinding:        sess.Record.GetAgentBinding(),
		WorkSessionRef:      ref,
		Purpose:             req.GetPurpose(),
		EndpointKey:         endpointKey,
		Priority:            priority,
		AdvisoryNonceBlock:  advisoryBlock,
		Tools:               req.GetTools(),
		CanonicalMessages:   canonicalWorking,
		KeptTailMessages:    canonicalOrderWorkingMessages(req.GetKeptTailMessages()),
		ContextBudgetTokens: budgetTokens,
	}

	var execResult BodyStepExecutionResult
	if s.bodyStepExecutor != nil {
		execCtx := textbehavior.WithToolCallActivityObserver(stepCtx, func(act textbehavior.ToolCallActivity) error {
			return emitter.SendToolCallActivity(act)
		})
		execResult, err = s.bodyStepExecutor(execCtx, execInput, emitter)
		if err != nil {
			_ = emitter.send(&runtimev1.BodyStepStreamEvent{
				Payload: &runtimev1.BodyStepStreamEvent_Failed{
					Failed: &runtimev1.BodyStepFailure{
						ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
						Message:    err.Error(),
					},
				},
			})
			return err
		}
	} else {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	if execResult.ContextBudgetTokens > 0 {
		budgetTokens = execResult.ContextBudgetTokens
	}
	// Merge both executor-returned calls and buffered emitted tool calls so ledger records every issued call.
	allIssuedCalls := append([]*runtimev1.BodyToolCall(nil), execResult.IssuedToolCalls...)
	for _, buffered := range emitter.bufferedToolCalls {
		found := false
		for _, existing := range allIssuedCalls {
			if existing.GetCallId() == buffered.GetCallId() {
				found = true
				break
			}
		}
		if !found {
			allIssuedCalls = append(allIssuedCalls, buffered)
		}
	}
	nextIssuedWindow := appendIssuedToolCallIDs(issuedWindow, allIssuedCalls)
	nextIssuedMeta := mergeIssuedToolMeta(issuedMeta, nextIssuedWindow, allIssuedCalls)
	issuedJSON, _ := json.Marshal(nextIssuedWindow)
	issuedMetaJSON, _ := json.Marshal(nextIssuedMeta)

	var (
		stepMAC           string
		postCompactionMAC string
	)
	if req.GetPurpose() == runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_COMPACTION {
		summaryCanon := strings.TrimSpace(execResult.CompactionSummary)
		keptTailBytes := canonicalizeMessagesBytes(req.GetKeptTailMessages())
		postCompactionMAC = s.computeHMAC([]byte(ref), []byte(summaryCanon), keptTailBytes)
		stepMAC = postCompactionMAC
		ledger.PostCompactionMAC = postCompactionMAC
		ledger.LastCommittedCount = 0
		ledger.CompactionCount++
	} else {
		// Sign the verified canonical prefix so the next turn must extend it intact.
		stepMAC = s.computeHMAC([]byte(ref), canonicalizeMessagesBytes(canonicalWorking))
		ledger.LastCommittedCount = len(canonicalWorking)
	}
	ledger.LastStepMAC = stepMAC
	ledger.IssuedToolCallIDsJSON = string(issuedJSON)
	ledger.IssuedToolArgsJSON = string(issuedMetaJSON)
	ledger.ReadSetEpoch = readSetEpoch
	ledger.EffectiveContextBudgetTokens = budgetTokens
	ledger.UpdatedAt = formatRFC3339(s.now().UTC())
	if err := s.store.UpsertLedger(ctx, ledger); err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}

	// Flush executable tool_call frames strictly AFTER the ledger transaction commits!
	if err := emitter.flushBufferedToolCalls(); err != nil {
		return err
	}

	return emitter.send(&runtimev1.BodyStepStreamEvent{
		Payload: &runtimev1.BodyStepStreamEvent_Done{
			Done: &runtimev1.BodyStepDone{
				FinishReason:                 execResult.FinishReason,
				UsageInputTokens:             execResult.UsageInputTokens,
				UsageOutputTokens:            execResult.UsageOutputTokens,
				StepMac:                      stepMAC,
				CompactionSummary:            execResult.CompactionSummary,
				PostCompactionMac:            postCompactionMAC,
				EffectiveContextBudgetTokens: budgetTokens,
			},
		},
	})
}

type bodyStepStreamEmitter struct {
	ctx               context.Context
	stream            grpc.ServerStreamingServer[runtimev1.BodyStepStreamEvent]
	budgetTokens      uint32
	seq               uint32
	bytesSent         int
	bufferedToolCalls []*runtimev1.BodyToolCall
}

func (e *bodyStepStreamEmitter) send(ev *runtimev1.BodyStepStreamEvent) error {
	if e.ctx != nil {
		if err := e.ctx.Err(); err != nil {
			return grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
		}
	}
	e.seq++
	ev.EventIndex = e.seq
	ev.EffectiveContextBudgetTokens = e.budgetTokens
	frameBytes := proto.Size(ev)
	if e.bytesSent+frameBytes > bodyStepMaxResponseBytes {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_APP_MESSAGE_PAYLOAD_TOO_LARGE)
	}
	e.bytesSent += frameBytes
	return e.stream.Send(ev)
}

func (e *bodyStepStreamEmitter) SendTextDelta(delta string) error {
	return e.send(&runtimev1.BodyStepStreamEvent{
		Payload: &runtimev1.BodyStepStreamEvent_TextDelta{TextDelta: delta},
	})
}

func (e *bodyStepStreamEmitter) SendReasoningSummaryDelta(delta string) error {
	return e.send(&runtimev1.BodyStepStreamEvent{
		Payload: &runtimev1.BodyStepStreamEvent_ReasoningSummaryDelta{ReasoningSummaryDelta: delta},
	})
}

func (e *bodyStepStreamEmitter) SendToolCallActivity(act textbehavior.ToolCallActivity) error {
	return e.send(&runtimev1.BodyStepStreamEvent{
		Payload: &runtimev1.BodyStepStreamEvent_ToolCallActivity{
			ToolCallActivity: &runtimev1.BodyToolCallActivity{
				CallId:              act.CallID,
				ToolName:            act.ToolName,
				ArgumentsDeltaBytes: uint32(act.ArgumentsDeltaBytes),
				AccumulatedBytes:    uint32(act.AccumulatedBytes),
			},
		},
	})
}

func (e *bodyStepStreamEmitter) SendToolCall(call *runtimev1.BodyToolCall) error {
	if call == nil {
		return nil
	}
	// Buffer executable tool_call frames until the ledger commit succeeds.
	e.bufferedToolCalls = append(e.bufferedToolCalls, call)
	return nil
}

func (e *bodyStepStreamEmitter) flushBufferedToolCalls() error {
	for _, call := range e.bufferedToolCalls {
		if err := e.send(&runtimev1.BodyStepStreamEvent{
			Payload: &runtimev1.BodyStepStreamEvent_ToolCall{ToolCall: call},
		}); err != nil {
			return err
		}
	}
	e.bufferedToolCalls = nil
	return nil
}

// AuthorizeBodySideEffect is the synchronous fail-closed fence called by the Body
// immediately before launching any high-risk side effect (file mutation, shell, etc.).
func (s *Service) AuthorizeBodySideEffect(ctx context.Context, req *runtimev1.AuthorizeBodySideEffectRequest) (*runtimev1.AuthorizeBodySideEffectResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentBodyPCSideEffectAuthorize, localappop.OperationAgentBodyAppSideEffectAuthorize)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetWorkSessionRef()) == "" || strings.TrimSpace(req.GetDeviceId()) == "" || req.GetLeaseEpoch() <= 0 || strings.TrimSpace(req.GetPayloadHash()) == "" {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "invalid_request_envelope",
		}, nil
	}
	ns, err := normalizeBodyNamespace(decision, req.GetCapabilityNamespace())
	if err != nil {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "namespace_unauthorized",
		}, nil
	}
	now := s.now().UTC()
	activeLease, err := s.store.VerifyActiveLease(ctx, decision.AccountID, strings.TrimSpace(req.GetDeviceId()), ns, decision.RegisteredAppSubject, req.GetLeaseEpoch(), now)
	if err != nil || !activeLease {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "lease_conflict_or_expired",
		}, nil
	}

	ref := strings.TrimSpace(req.GetWorkSessionRef())
	sess, err := s.store.GetSession(ctx, decision.AccountID, ref)
	if errors.Is(err, errSessionNotFound) {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized:         false,
			DenyReason:         "work_session_deleted",
			WorkSessionDeleted: true,
		}, nil
	}
	if err != nil {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "store_unavailable",
		}, nil
	}
	if sess.Record.GetBodyPurgePending() || sess.Record.GetStatus() == "deleted" || sess.Record.GetStatus() == "deleting" {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized:         false,
			DenyReason:         "work_session_purge_pending",
			WorkSessionDeleted: true,
		}, nil
	}

	if sess.Record.GetOwnerBodyKind() != ns {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "work_session_namespace_mismatch",
		}, nil
	}
	if !actionKindAllowedByPermissionMode(sess.Record.GetPermissionMode(), req.GetActionKind()) {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "permission_mode_denies_side_effect",
		}, nil
	}

	// Pending PURGE or INVALIDATE tombstones for this session or its agent block all side effects!
	hasTombstone, err := s.store.HasPendingTombstones(ctx, decision.AccountID, strings.TrimSpace(req.GetDeviceId()), ns, ref, sess.Record.GetAgentBinding())
	if err != nil || hasTombstone {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized:        false,
			DenyReason:        "pending_tombstone_must_drain",
			MemoryInvalidated: true,
		}, nil
	}

	// Fail closed on ledger read errors, missing ledger, missing call_id, or non-issued tool call!
	ledger, ledgerErr := s.store.GetLedger(ctx, decision.AccountID, ref)
	if ledgerErr != nil {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "ledger_unavailable",
		}, nil
	}
	if ledger == nil {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "session_ledger_uninitialized",
		}, nil
	}
	callID := strings.TrimSpace(req.GetCallId())
	if callID == "" {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "missing_tool_call_id",
		}, nil
	}
	issued := decodeIssuedWindow(ledger.IssuedToolCallIDsJSON)
	if len(issued) == 0 || !containsString(issued, callID) {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "tool_call_not_issued_by_runtime",
		}, nil
	}
	issuedMeta := decodeIssuedToolMeta(ledger.IssuedToolArgsJSON)
	if meta, ok := issuedMeta[callID]; ok {
		if reqTool := strings.TrimSpace(req.GetToolName()); reqTool != "" && meta.ToolName != "" && !strings.EqualFold(reqTool, meta.ToolName) {
			return &runtimev1.AuthorizeBodySideEffectResponse{
				Authorized: false,
				DenyReason: "tool_name_mismatch",
			}, nil
		}
	}
	if s.readSetQualifier == nil {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "read_set_qualifier_unconfigured",
		}, nil
	}
	valid, _, qErr := s.readSetQualifier(ctx, decision.AccountID, sess.Record.GetAgentBinding(), ref, ledger.ReadSetEpoch)
	if qErr != nil || !valid {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized:        false,
			DenyReason:        "memory_read_set_invalidated",
			MemoryInvalidated: true,
		}, nil
	}

	return &runtimev1.AuthorizeBodySideEffectResponse{
		Authorized: true,
	}, nil
}

// ReportBodySessionProjection persists Body-owned session progress with
// strictly monotonic (lease_epoch, projection_seq) fencing and tombstone drain enforcement.
func (s *Service) ReportBodySessionProjection(ctx context.Context, req *runtimev1.ReportBodySessionProjectionRequest) (*runtimev1.ReportBodySessionProjectionResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentBodyPCProjectionReport, localappop.OperationAgentBodyAppProjectionReport)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetWorkSessionRef()) == "" || strings.TrimSpace(req.GetDeviceId()) == "" || req.GetLeaseEpoch() <= 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	ns, err := normalizeBodyNamespace(decision, req.GetCapabilityNamespace())
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	activeLease, err := s.store.VerifyActiveLease(ctx, decision.AccountID, strings.TrimSpace(req.GetDeviceId()), ns, decision.RegisteredAppSubject, req.GetLeaseEpoch(), now)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !activeLease {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_BODY_LEASE_CONFLICT)
	}

	resp, updatedRow, err := s.store.ApplyBodyProjection(ctx, decision.AccountID, ns, req, now)
	if errors.Is(err, errTombstoneFence) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_CONFLICT)
	}
	if errors.Is(err, errBodyNamespaceMismatch) || errors.Is(err, errAttentionScopeConflict) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	if errors.Is(err, errSessionNotFound) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if resp.GetApplied() && updatedRow != nil {
		s.notifyOverviewChange(decision.AccountID, []*runtimev1.WorkSessionRecord{updatedRow.Record}, nil)
		// Taint gate: ONLY trusted, non-external sessions may propose Cognition session pointers!
		if milestone := strings.TrimSpace(req.GetMilestoneKind()); milestone != "" &&
			s.milestoneHook != nil &&
			updatedRow.Record.GetTrustTier() == "trusted" &&
			updatedRow.Record.GetSessionKind() != "channel_external" {
			_ = s.milestoneHook(
				ctx,
				decision.AccountID,
				updatedRow.Record.GetAgentBinding(),
				updatedRow.Record.GetWorkSessionRef(),
				milestone,
				req.GetTopicSummary(),
				req.GetDeliverablePaths(),
			)
		}
	}
	return resp, nil
}
