package agentsession

import (
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
	maxIssuedToolCallWindow   = 128
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

// StreamLocalAgentBodyStep enforces the strict Brain-Body symbiosis ledger,
// rejects system/developer role smuggling, wraps body_advisory_context in a
// per-turn random-nonce <untrusted_workspace_data> block, qualifies Cognition
// read sets synchronously, enforces physical-endpoint scheduling, and streams
// live text/reasoning/ToolCallActivity/toolCall/done frames with a 600s/2MiB cap.
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
	sess, err := s.store.GetSession(ctx, decision.AccountID, ref)
	if errors.Is(err, errSessionNotFound) {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}

	// 1. Reject forbidden system / developer roles in working_messages & kept_tail_messages.
	for _, msg := range append(append([]*runtimev1.BodyWorkingMessage(nil), req.GetWorkingMessages()...), req.GetKeptTailMessages()...) {
		if msg == nil {
			continue
		}
		role := strings.ToLower(strings.TrimSpace(msg.GetRole()))
		if role == "system" || role == "developer" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
		}
	}

	// 2. Load ledger & verify issued_tool_call_ids_window + post_compaction_mac continuity.
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
			EffectiveContextBudgetTokens: defaultContextBudgetToken,
		}
	}
	issuedWindow := decodeIssuedWindow(ledger.IssuedToolCallIDsJSON)
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
	// If the session previously compacted (post_compaction_mac != ""), verify
	// unconditionally that the compaction summary + kept_tail anchor matches the
	// signed post_compaction_mac = HMAC(ref || canonical_summary || canonical_kept_tail).
	if ledger.PostCompactionMAC != "" && req.GetPurpose() != runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_COMPACTION {
		if len(canonicalWorking) == 0 {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
		}
		summaryText := extractCompactionSummaryText(canonicalWorking[0])
		matched := false
		if len(req.GetKeptTailMessages()) > 0 {
			expected := s.computeHMAC([]byte(ref), []byte(summaryText), canonicalizeMessagesBytes(req.GetKeptTailMessages()))
			matched = hmac.Equal([]byte(expected), []byte(ledger.PostCompactionMAC))
		} else {
			// Check whether canonicalWorking[1:end] for any prefix length matches the signed kept tail.
			for end := 1; end <= len(canonicalWorking); end++ {
				expected := s.computeHMAC([]byte(ref), []byte(summaryText), canonicalizeMessagesBytes(canonicalWorking[1:end]))
				if hmac.Equal([]byte(expected), []byte(ledger.PostCompactionMAC)) {
					matched = true
					break
				}
			}
		}
		if !matched {
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
		// Deterministic offline/unconfigured fallback fails closed rather than pseudo-succeeding.
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	if execResult.ContextBudgetTokens > 0 {
		budgetTokens = execResult.ContextBudgetTokens
	}
	nextIssuedWindow := appendIssuedToolCallIDs(issuedWindow, execResult.IssuedToolCalls)
	issuedJSON, _ := json.Marshal(nextIssuedWindow)

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
		ledger.CompactionCount++
	} else {
		stepMAC = s.computeHMAC(
			[]byte(ref),
			[]byte(ledger.LastStepMAC),
			canonicalizeMessagesBytes(canonicalWorking),
			[]byte(execResult.AssistantText),
			issuedJSON,
		)
	}
	ledger.LastStepMAC = stepMAC
	ledger.IssuedToolCallIDsJSON = string(issuedJSON)
	ledger.ReadSetEpoch = readSetEpoch
	ledger.EffectiveContextBudgetTokens = budgetTokens
	ledger.UpdatedAt = formatRFC3339(s.now().UTC())
	if err := s.store.UpsertLedger(ctx, ledger); err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}

	return emitter.send(&runtimev1.BodyStepStreamEvent{
		Payload: &runtimev1.BodyStepStreamEvent_Done{
			Done: &runtimev1.BodyStepDone{
				FinishReason:                execResult.FinishReason,
				UsageInputTokens:            execResult.UsageInputTokens,
				UsageOutputTokens:           execResult.UsageOutputTokens,
				StepMac:                     stepMAC,
				CompactionSummary:           execResult.CompactionSummary,
				PostCompactionMac:           postCompactionMAC,
				EffectiveContextBudgetTokens: budgetTokens,
			},
		},
	})
}

type bodyStepStreamEmitter struct {
	stream       grpc.ServerStreamingServer[runtimev1.BodyStepStreamEvent]
	budgetTokens uint32
	seq          uint32
}

func (e *bodyStepStreamEmitter) send(ev *runtimev1.BodyStepStreamEvent) error {
	e.seq++
	ev.EventIndex = e.seq
	ev.EffectiveContextBudgetTokens = e.budgetTokens
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
	return e.send(&runtimev1.BodyStepStreamEvent{
		Payload: &runtimev1.BodyStepStreamEvent_ToolCall{ToolCall: call},
	})
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

	// Pending PURGE or INVALIDATE tombstones for this session block all side effects!
	hasTombstone, err := s.store.HasPendingTombstones(ctx, decision.AccountID, strings.TrimSpace(req.GetDeviceId()), ns, ref)
	if err != nil || hasTombstone {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized:        false,
			DenyReason:        "pending_tombstone_must_drain",
			MemoryInvalidated: true,
		}, nil
	}

	ledger, _ := s.store.GetLedger(ctx, decision.AccountID, ref)
	if ledger != nil {
		if callID := strings.TrimSpace(req.GetCallId()); callID != "" {
			issued := decodeIssuedWindow(ledger.IssuedToolCallIDsJSON)
			if len(issued) > 0 && !containsString(issued, callID) {
				return &runtimev1.AuthorizeBodySideEffectResponse{
					Authorized: false,
					DenyReason: "tool_call_not_issued_by_runtime",
				}, nil
			}
		}
		if s.readSetQualifier != nil {
			valid, _, qErr := s.readSetQualifier(ctx, decision.AccountID, sess.Record.GetAgentBinding(), ref, ledger.ReadSetEpoch)
			if qErr != nil || !valid {
				return &runtimev1.AuthorizeBodySideEffectResponse{
					Authorized:        false,
					DenyReason:        "memory_read_set_invalidated",
					MemoryInvalidated: true,
				}, nil
			}
		}
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

	resp, updatedRow, err := s.store.ApplyBodyProjection(ctx, decision.AccountID, req, now)
	if errors.Is(err, errTombstoneFence) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_CONFLICT)
	}
	if errors.Is(err, errSessionNotFound) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if resp.GetApplied() && updatedRow != nil {
		s.notifyOverviewChange(decision.AccountID, []*runtimev1.WorkSessionRecord{updatedRow.Record}, nil)
		if milestone := strings.TrimSpace(req.GetMilestoneKind()); milestone != "" && s.milestoneHook != nil {
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
