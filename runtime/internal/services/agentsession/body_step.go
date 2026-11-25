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
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const (
	bodyStepMaxDuration       = 600 * time.Second
	bodyStepMaxRequestBytes   = 2 * 1024 * 1024
	bodyStepMaxResponseBytes  = 2 * 1024 * 1024
	maxIssuedToolCallWindow   = 512
	defaultContextBudgetToken = uint32(64000)

	piDurableSummaryPrefix = "The conversation history before this point was compacted into the following summary:\n\n<summary>\n"
	piDurableSummarySuffix = "\n</summary>"
)

// BodyStepExecutionInput carries validated, ledger-verified inputs into the
// model execution adapter for StreamLocalAgentBodyStep.
type BodyStepExecutionInput struct {
	AccountID           string
	CallerAppID         string
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

// SessionMilestone retains its delivery identity across retries and restarts.
type SessionMilestone struct {
	DeliveryID, AccountID, AgentBinding, WorkSessionRef string
	BodyKind, Kind, TopicSummary                        string
	Deliverables                                        []string
}

type MilestoneHook func(context.Context, SessionMilestone) error

// MemoryCleanupHook neutralizes Cognition outbox and forgets session-lineage memories during DeleteSession.
type MemoryCleanupHook func(ctx context.Context, accountID, agentBinding, workSessionRef string) (uint32, error)

// BrainTurnExecutionInput carries verified caller metadata and session history
// into BrainTurnExecutor for Brain-native inline turns.
type BrainTurnExecutionInput struct {
	AccountID      string
	CallerDecision accountservice.LocalAppCallerDecision
	Session        *runtimev1.WorkSessionRecord
	UserText       string
	RequestID      string
	History        []*runtimev1.BrainSessionEventEnvelope
}

// BrainTurnExecutor runs Brain-native inline turns (general_inbox / channel_external).
type BrainTurnExecutor func(ctx context.Context, in BrainTurnExecutionInput, emit func(eventType, payloadJSON string, persist bool) error) error

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

func normalizeCompactionSummaryText(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return ""
	}
	if strings.HasPrefix(text, piDurableSummaryPrefix) && strings.HasSuffix(text, piDurableSummarySuffix) {
		text = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(text, piDurableSummaryPrefix), piDurableSummarySuffix))
	}
	return text
}

func bodyInputContent(raw string) (string, bool) {
	var text string
	if err := json.Unmarshal([]byte(raw), &text); err == nil {
		return text, text != ""
	}
	var blocks []struct {
		Type string
		Text string
	}
	if json.Unmarshal([]byte(raw), &blocks) != nil {
		return "", false
	}
	var content strings.Builder
	for _, block := range blocks {
		if block.Type != "text" {
			return "", false
		}
		content.WriteString(block.Text)
	}
	return content.String(), content.Len() > 0
}

func extractSemanticTextContent(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	var asString string
	if err := json.Unmarshal([]byte(trimmed), &asString); err == nil {
		return normalizeCompactionSummaryText(asString)
	}
	var blocks []map[string]any
	if err := json.Unmarshal([]byte(trimmed), &blocks); err == nil {
		var sb strings.Builder
		onlyText := true
		for _, blk := range blocks {
			typ, _ := blk["type"].(string)
			if typ == "text" {
				if txt, ok := blk["text"].(string); ok {
					sb.WriteString(txt)
				}
				continue
			}
			onlyText = false
		}
		if onlyText && sb.Len() > 0 {
			return normalizeCompactionSummaryText(sb.String())
		}
	}
	return normalizeCompactionSummaryText(canonicalJSONString(trimmed))
}

func jsonMarshalNoEscape(value any) (string, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(value); err != nil {
		return "", err
	}
	return strings.TrimSuffix(buf.String(), "\n"), nil
}

func canonicalJSONString(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	var parsed any
	if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
		return trimmed
	}
	encoded, err := jsonMarshalNoEscape(parsed)
	if err != nil {
		return trimmed
	}
	return encoded
}

type semanticToolCall struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	ArgsJSON string `json:"args"`
}

func extractSemanticAssistantTurn(raw string) (string, []semanticToolCall) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", nil
	}
	var asString string
	if err := json.Unmarshal([]byte(trimmed), &asString); err == nil {
		return normalizeCompactionSummaryText(asString), nil
	}
	var blocks []map[string]any
	if err := json.Unmarshal([]byte(trimmed), &blocks); err != nil {
		return normalizeCompactionSummaryText(trimmed), nil
	}
	var textParts strings.Builder
	var calls []semanticToolCall
	for _, blk := range blocks {
		typ, _ := blk["type"].(string)
		switch typ {
		case "text":
			if txt, ok := blk["text"].(string); ok {
				textParts.WriteString(txt)
			}
		case "toolCall", "tool_use", "tool_call":
			id, _ := blk["id"].(string)
			if strings.TrimSpace(id) == "" {
				id, _ = blk["callId"].(string)
			}
			name, _ := blk["name"].(string)
			argsRaw := "{}"
			if argsVal, ok := blk["arguments"]; ok && argsVal != nil {
				if s, ok := argsVal.(string); ok {
					argsRaw = canonicalJSONString(s)
				} else if encoded, err := jsonMarshalNoEscape(argsVal); err == nil {
					argsRaw = encoded
				}
			}
			calls = append(calls, semanticToolCall{
				ID:       strings.TrimSpace(id),
				Name:     strings.TrimSpace(name),
				ArgsJSON: argsRaw,
			})
		}
	}
	return strings.TrimSpace(textParts.String()), calls
}

func buildAssistantWorkingMessage(assistantText string, issuedCalls []*runtimev1.BodyToolCall) *runtimev1.BodyWorkingMessage {
	blocks := make([]map[string]any, 0, 1+len(issuedCalls))
	if trimmed := strings.TrimSpace(assistantText); trimmed != "" {
		blocks = append(blocks, map[string]any{
			"type": "text",
			"text": trimmed,
		})
	}
	for _, c := range issuedCalls {
		if c == nil || strings.TrimSpace(c.GetCallId()) == "" {
			continue
		}
		var argsObj any = map[string]any{}
		if raw := strings.TrimSpace(c.GetArgumentsJson()); raw != "" {
			if err := json.Unmarshal([]byte(raw), &argsObj); err != nil {
				argsObj = raw
			}
		}
		blocks = append(blocks, map[string]any{
			"type":      "toolCall",
			"id":        strings.TrimSpace(c.GetCallId()),
			"name":      strings.TrimSpace(c.GetName()),
			"arguments": argsObj,
		})
	}
	encoded, _ := json.Marshal(blocks)
	return &runtimev1.BodyWorkingMessage{
		Role:        "assistant",
		ContentJson: string(encoded),
	}
}

func canonicalizeMessagesBytes(messages []*runtimev1.BodyWorkingMessage) []byte {
	type canonMsg struct {
		Role       string             `json:"role"`
		Text       string             `json:"text,omitempty"`
		ToolCalls  []semanticToolCall `json:"toolCalls,omitempty"`
		ToolCallID string             `json:"toolCallId,omitempty"`
		ToolName   string             `json:"toolName,omitempty"`
		IsError    bool               `json:"isError,omitempty"`
		Content    string             `json:"content,omitempty"`
	}
	ordered := canonicalOrderWorkingMessages(messages)
	out := make([]canonMsg, 0, len(ordered))
	for _, m := range ordered {
		role := strings.ToLower(strings.TrimSpace(m.GetRole()))
		switch role {
		case "assistant":
			txt, calls := extractSemanticAssistantTurn(m.GetContentJson())
			out = append(out, canonMsg{
				Role:      "assistant",
				Text:      txt,
				ToolCalls: calls,
			})
		case "toolresult", "tool":
			out = append(out, canonMsg{
				Role:       "toolResult",
				ToolCallID: strings.TrimSpace(m.GetToolCallId()),
				ToolName:   strings.TrimSpace(m.GetToolName()),
				IsError:    m.GetIsError(),
				Content:    canonicalJSONString(m.GetContentJson()),
			})
		default:
			out = append(out, canonMsg{
				Role: "user",
				Text: extractSemanticTextContent(m.GetContentJson()),
			})
		}
	}
	b, _ := json.Marshal(out)
	return b
}

func isExactMessageSuffix(full, tail []*runtimev1.BodyWorkingMessage) bool {
	if len(tail) == 0 {
		return true
	}
	if len(tail) > len(full) {
		return false
	}
	return bytes.Equal(
		canonicalizeMessagesBytes(full[len(full)-len(tail):]),
		canonicalizeMessagesBytes(tail),
	)
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

func sanitizeAdvisoryField(v string, maxBytes int) string {
	clean := strings.ReplaceAll(v, "</untrusted_workspace_data>", "")
	clean = strings.ReplaceAll(clean, "<untrusted_workspace_data", "")
	clean = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || r == '<' || r == '>' {
			return -1
		}
		return r
	}, clean)
	clean = strings.TrimSpace(clean)
	return truncateUTF8ByBytes(clean, maxBytes)
}

func buildUntrustedAdvisoryBlock(advisory *runtimev1.BodyAdvisoryContext) string {
	if advisory == nil {
		return ""
	}
	var nonceBytes [16]byte
	_, _ = rand.Read(nonceBytes[:])
	nonce := hex.EncodeToString(nonceBytes[:])
	const maxAdvisoryTools = 64
	rawTools := advisory.GetToolNames()
	if len(rawTools) > maxAdvisoryTools {
		rawTools = rawTools[:maxAdvisoryTools]
	}
	toolNames := make([]string, 0, len(rawTools))
	for _, name := range rawTools {
		if clean := sanitizeAdvisoryField(name, 64); clean != "" {
			toolNames = append(toolNames, clean)
		}
	}
	payload, _ := json.Marshal(map[string]any{
		"workspaceName":  sanitizeAdvisoryField(advisory.GetWorkspaceName(), 128),
		"permissionMode": sanitizeAdvisoryField(advisory.GetPermissionMode(), 64),
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
	ToolName    string `json:"toolName"`
	ArgsHash    string `json:"argsHash"`
	RawArgsHash string `json:"rawArgsHash,omitempty"`
	Consumed    bool   `json:"consumed,omitempty"`
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
		rawArgs := c.GetArgumentsJson()
		canonArgs := canonicalJSONString(rawArgs)
		existing[id] = issuedToolMeta{
			ToolName:    strings.TrimSpace(c.GetName()),
			ArgsHash:    sha256HexString(canonArgs),
			RawArgsHash: sha256HexString(rawArgs),
			Consumed:    false,
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
	case "file_write", "file_edit", "file_delete", "shell_exec", "process_exec", "integration_write", "outbound_network":
		// Closed allowlist: only writable workspace modes (including Harness default
		// per-action interactive approval mode 'strict') authorize side effects;
		// plan-readonly, readonly, companion, or unknown modes strictly fail closed!
		return mode == "strict" || mode == "workspace-edit" || mode == "full" || mode == "developer"
	default:
		// Unknown or empty action_kind ALWAYS fails closed.
		return false
	}
}

// StreamLocalAgentBodyStep enforces the single-anchor rolling Brain-Body
// symbiosis ledger across both normal inference and compaction steps, rejects
// non-allowlisted roles (including system/developer) and unauthenticated suffix
// assistant turns, serializes steps per session under an end-to-end 600s
// deadline, supports idempotent replay via step_request_id across stream drops,
// wraps body_advisory_context in a per-turn random-nonce block, qualifies
// Cognition read sets synchronously, propagates P0/P2 priority into the single
// physical AI endpoint scheduler, and commits ledger + relational per-call tool
// grants + replay journal atomically BEFORE flushing executable tool_call frames.
// @nimi-authority: rule.nimi.runtime.agent-participation.body-step-symbiosis
func (s *Service) StreamLocalAgentBodyStep(req *runtimev1.StreamLocalAgentBodyStepRequest, stream grpc.ServerStreamingServer[runtimev1.BodyStepStreamEvent]) error {
	ctx := stream.Context()
	// End-to-end 600s deadline covers step serialization wait, inference, ledger commit, and flushing.
	stepCtx, stepCancel := context.WithTimeout(ctx, bodyStepMaxDuration)
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		stepCancel()
		return status.Error(codes.Unavailable, "Agent sessions are quiescing")
	}
	s.stepSeq++
	stepID := s.stepSeq
	if s.stepCancels == nil {
		s.stepCancels = make(map[uint64]context.CancelFunc)
	}
	s.stepCancels[stepID] = stepCancel
	s.stepWG.Add(1)
	s.mu.Unlock()
	// A transport send can be flow-controlled after our local deadline. Returning
	// the RPC closes that transport, while shutdown still waits for the worker.
	finished := make(chan error, 1)
	go func() {
		defer func() {
			s.mu.Lock()
			delete(s.stepCancels, stepID)
			s.mu.Unlock()
			s.stepWG.Done()
		}()
		finished <- s.executeBodyStep(stepCtx, stepCancel, req, stream)
	}()
	defer stepCancel()
	select {
	case err := <-finished:
		return err
	case <-stepCtx.Done():
		return status.FromContextError(stepCtx.Err()).Err()
	}
}

func (s *Service) executeBodyStep(stepCtx context.Context, stepCancel context.CancelFunc, req *runtimev1.StreamLocalAgentBodyStepRequest, stream grpc.ServerStreamingServer[runtimev1.BodyStepStreamEvent]) error {
	decision, err := s.authorize(stepCtx, localappop.OperationAgentBodyPCStepStream, localappop.OperationAgentBodyAppStepStream)
	if err != nil {
		return err
	}
	if req == nil || strings.TrimSpace(req.GetWorkSessionRef()) == "" || strings.TrimSpace(req.GetDeviceId()) == "" || req.GetLeaseEpoch() <= 0 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if proto.Size(req) > bodyStepMaxRequestBytes {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_APP_MESSAGE_PAYLOAD_TOO_LARGE)
	}
	ns, err := s.normalizeBodyNamespace(stepCtx, decision, req.GetCapabilityNamespace())
	if err != nil {
		return err
	}
	deviceID := strings.TrimSpace(req.GetDeviceId())
	now := s.now().UTC()
	activeLease, err := s.store.VerifyActiveLease(stepCtx, decision.AccountID, deviceID, ns, decision.RegisteredAppSubject, req.GetLeaseEpoch(), now)
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !activeLease {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_BODY_LEASE_CONFLICT)
	}

	// Open the authenticated stream before waiting for an earlier step to finish.
	// Queue time belongs to the step deadline, not the client's stream-open timeout.
	if err := stream.SendHeader(nil); err != nil {
		return err
	}
	ref := strings.TrimSpace(req.GetWorkSessionRef())
	unlockStep, lockErr := s.lockSessionStepContext(stepCtx, ref)
	if lockErr != nil {
		return grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
	}
	defer unlockStep()

	// Re-verify active lease AFTER acquiring per-session step serialization lock.
	activeLease, err = s.store.VerifyActiveLease(stepCtx, decision.AccountID, deviceID, ns, decision.RegisteredAppSubject, req.GetLeaseEpoch(), s.now().UTC())
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !activeLease {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_BODY_LEASE_CONFLICT)
	}

	sess, err := s.store.GetSession(stepCtx, decision.AccountID, ref)
	if errors.Is(err, errSessionNotFound) {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if sess.Record.GetOwnerBodyKind() != ns || sess.Record.GetStatus() == "deleted" || sess.Record.GetStatus() == "deleting" {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_CONFLICT)
	}
	if boundDev := strings.TrimSpace(sess.Record.GetDeviceId()); boundDev != "" && boundDev != "local-default" && boundDev != deviceID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
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

	// 2. Load ledger & check idempotent step_request_id replay across dropped streams.
	ledger, err := s.store.GetLedger(stepCtx, decision.AccountID, ref)
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
	canonicalWorking := canonicalOrderWorkingMessages(req.GetWorkingMessages())
	canonicalKeptTail := canonicalOrderWorkingMessages(req.GetKeptTailMessages())
	stepReqID := strings.TrimSpace(req.GetStepRequestId())

	// 3. Synchronously qualify Cognition read set BEFORE inference.
	originalReadEpoch := ledger.ReadSetEpoch
	readSetEpoch := originalReadEpoch
	if s.readSetQualifier != nil {
		valid, currentEpoch, qErr := s.readSetQualifier(stepCtx, decision.AccountID, sess.Record.GetAgentBinding(), ref, ledger.ReadSetEpoch)
		if qErr != nil {
			return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		if !valid {
			invPayload, _ := jsonMarshalNoEscape(map[string]any{
				"workSessionRef": ref,
				"epoch":          currentEpoch,
				"previousEpoch":  ledger.ReadSetEpoch,
			})
			invEnv := &runtimev1.BodyOutboxEnvelope{
				OutboxId:            newID("outbox"),
				DeviceId:            deviceID,
				CapabilityNamespace: ns,
				WorkSessionRef:      ref,
				CommandKind:         runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_INVALIDATE_MEMORY,
				PayloadJson:         invPayload,
				CreatedAt:           formatRFC3339(now),
				AgentBinding:        sess.Record.GetAgentBinding(),
			}
			if err := s.store.EnqueueOutbox(stepCtx, decision.AccountID, invEnv, ""); err != nil {
				return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
			}
			s.notifyOutboxSubscribers(decision.AccountID, invEnv.GetDeviceId(), ns, invEnv)
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_MEMORY_INVALIDATED)
		}
		readSetEpoch = currentEpoch
	}

	pending, err := s.store.HasPendingTombstones(stepCtx, decision.AccountID, deviceID, ns, ref, sess.Record.GetAgentBinding())
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if pending {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_MEMORY_INVALIDATED)
	}
	requestDigest := ""
	if stepReqID != "" {
		semantic := proto.Clone(req).(*runtimev1.StreamLocalAgentBodyStepRequest)
		semantic.LeaseEpoch = 0 // A recovering carrier has already proved its new lease.
		encoded, err := (proto.MarshalOptions{Deterministic: true}).Marshal(semantic)
		if err != nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		requestDigest = sha256HexString(string(encoded))
		journal, jErr := s.store.GetStepJournal(stepCtx, decision.AccountID, ref, stepReqID)
		if jErr != nil {
			return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		if journal != nil && journal.Done != nil {
			if journal.RequestDigest != requestDigest || journal.NextStepMAC != ledger.LastStepMAC {
				return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
			}
			prevOK := false
			if journal.PrevCommittedCount == 0 && journal.PrevStepMAC == "" {
				prevOK = true
			} else if len(canonicalWorking) >= journal.PrevCommittedCount {
				expectedPrevMAC := s.computeHMAC([]byte(ref), canonicalizeMessagesBytes(canonicalWorking[:journal.PrevCommittedCount]))
				prevOK = hmac.Equal([]byte(expectedPrevMAC), []byte(journal.PrevStepMAC))
			}
			if !prevOK {
				return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
			}
			replayEmitter := &bodyStepStreamEmitter{
				ctx:          stepCtx,
				stream:       stream,
				budgetTokens: journal.Done.GetEffectiveContextBudgetTokens(),
			}
			if journal.StreamBudget != 0 {
				replayEmitter.budgetTokens = journal.StreamBudget
			}
			hasText := false
			for _, delta := range journal.PublicDeltas {
				var sendErr error
				if delta.ReasoningSummary {
					sendErr = replayEmitter.SendReasoningSummaryDelta(delta.Text)
				} else {
					hasText = true
					sendErr = replayEmitter.SendTextDelta(delta.Text)
				}
				if sendErr != nil {
					return sendErr
				}
			}
			if !hasText && journal.AssistantText != "" {
				if err := replayEmitter.SendTextDelta(journal.AssistantText); err != nil {
					return err
				}
			}
			for _, tc := range journal.ToolCalls {
				if err := replayEmitter.send(&runtimev1.BodyStepStreamEvent{
					Payload: &runtimev1.BodyStepStreamEvent_ToolCall{ToolCall: tc},
				}); err != nil {
					return err
				}
			}
			return replayEmitter.send(&runtimev1.BodyStepStreamEvent{
				Payload: &runtimev1.BodyStepStreamEvent_Done{Done: journal.Done},
			})
		}
	}

	issuedWindow := decodeIssuedWindow(ledger.IssuedToolCallIDsJSON)
	prevStepMAC := ledger.LastStepMAC
	prevCommittedCount := ledger.LastCommittedCount

	// Single-anchor continuity check on EVERY step (normal inference AND compaction):
	// canonicalWorking[:ledger.LastCommittedCount] MUST match ledger.LastStepMAC!
	if ledger.LastStepMAC != "" && ledger.LastCommittedCount > 0 {
		if len(canonicalWorking) < ledger.LastCommittedCount {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
		}
		expectedPrefixMAC := s.computeHMAC([]byte(ref), canonicalizeMessagesBytes(canonicalWorking[:ledger.LastCommittedCount]))
		if !hmac.Equal([]byte(expectedPrefixMAC), []byte(ledger.LastStepMAC)) {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
		}
	}
	// Suffix authenticity beyond the cryptographically verified prefix:
	// - NEVER allow fabricated role=="assistant" messages appended by the Body!
	// - Every appended toolResult MUST reference a Runtime-issued call_id in issuedWindow
	//   that has NOT already been settled in a previous step or duplicated in this step.
	// - Every appended user message MUST identify and match an unconsumed NEW_INTENT
	//   outbox envelope for this account & work_session_ref.
	checkFrom := ledger.LastCommittedCount
	if checkFrom < 0 || checkFrom > len(canonicalWorking) {
		checkFrom = 0
	}
	seenSuffixToolCalls := make(map[string]struct{})
	var settledToolCallIDs, inputIDs []string
	seenInput := make(map[string]bool)
	for idx := checkFrom; idx < len(canonicalWorking); idx++ {
		msg := canonicalWorking[idx]
		role := strings.ToLower(strings.TrimSpace(msg.GetRole()))
		switch role {
		case "assistant":
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
		case "toolresult", "tool":
			callID := strings.TrimSpace(msg.GetToolCallId())
			if callID == "" || !containsString(issuedWindow, callID) {
				return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
			}
			if _, dup := seenSuffixToolCalls[callID]; dup {
				return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
			}
			alreadyCommitted, cErr := s.store.IsToolResultAlreadyCommitted(stepCtx, decision.AccountID, ref, callID)
			if cErr != nil {
				return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
			}
			if alreadyCommitted {
				return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
			}
			seenSuffixToolCalls[callID] = struct{}{}
			settledToolCallIDs = append(settledToolCallIDs, callID)
		case "user":
			id := strings.TrimSpace(msg.GetOutboxId())
			if id == "" || seenInput[id] {
				return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
			}
			text, validText := bodyInputContent(msg.GetContentJson())
			if !validText {
				return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
			}
			valid, err := s.store.verifyOutboxInput(stepCtx, decision.AccountID, ref, id, text)
			if err != nil {
				return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
			}
			if !valid {
				return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
			}
			seenInput[id] = true
			inputIDs = append(inputIDs, id)
		}
	}
	// On COMPACTION, kept_tail_messages MUST be an exact suffix of canonicalWorking
	// so the Body can never smuggle fabricated messages into the post-compaction anchor!
	if req.GetPurpose() == runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_COMPACTION {
		if !isExactMessageSuffix(canonicalWorking, canonicalKeptTail) {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
		}
	}

	// 4. Single-owner physical-endpoint admission:
	// Propagate P0/P2 priority & cooperative preemption callback down to ai.Service
	// via context rather than double-acquiring the same physical endpoint bucket.
	isCompaction := req.GetPurpose() == runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_COMPACTION
	priority := scheduler.PriorityP0Foreground
	if isCompaction {
		priority = scheduler.PriorityP2Background
	}
	endpointKey := s.resolveEndpointKey(sess.Record.GetAgentBinding())

	advisoryBlock := buildUntrustedAdvisoryBlock(req.GetBodyAdvisoryContext())
	budgetTokens := ledger.EffectiveContextBudgetTokens
	if budgetTokens == 0 {
		budgetTokens = defaultContextBudgetToken
	}

	emitter := &bodyStepStreamEmitter{
		captureDeltas: stepReqID != "",
		ctx:           stepCtx,
		stream:        stream,
		budgetTokens:  budgetTokens,
	}

	// Compaction MUST NEVER declare or emit executable tools.
	stepTools := req.GetTools()
	if isCompaction {
		stepTools = nil
	}

	execInput := BodyStepExecutionInput{
		AccountID:           decision.AccountID,
		CallerAppID:         decision.AppID,
		AgentBinding:        sess.Record.GetAgentBinding(),
		WorkSessionRef:      ref,
		Purpose:             req.GetPurpose(),
		EndpointKey:         endpointKey,
		Priority:            priority,
		AdvisoryNonceBlock:  advisoryBlock,
		Tools:               stepTools,
		CanonicalMessages:   canonicalWorking,
		KeptTailMessages:    canonicalKeptTail,
		ContextBudgetTokens: budgetTokens,
	}

	var execResult BodyStepExecutionResult
	if s.bodyStepExecutor != nil {
		execCtx := scheduler.WithExecutionAdmission(stepCtx, priority, stepCancel)
		execCtx = textbehavior.WithToolCallActivityObserver(execCtx, func(act textbehavior.ToolCallActivity) error {
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

	var (
		stepMAC           string
		postCompactionMAC string
		compactionSummary string
		nextIssuedWindow  = issuedWindow
		commitIssuedCalls = allIssuedCalls
	)
	if isCompaction {
		summaryCanon := normalizeCompactionSummaryText(execResult.CompactionSummary)
		if summaryCanon == "" || len(allIssuedCalls) > 0 {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		compactionSummary = summaryCanon
		commitIssuedCalls = nil
		emitter.bufferedToolCalls = nil
		encodedSummary, _ := jsonMarshalNoEscape(summaryCanon)
		summaryMsg := &runtimev1.BodyWorkingMessage{
			Role:        "user",
			ContentJson: encodedSummary,
		}
		postCompactionPrefix := make([]*runtimev1.BodyWorkingMessage, 0, 1+len(canonicalKeptTail))
		postCompactionPrefix = append(postCompactionPrefix, summaryMsg)
		postCompactionPrefix = append(postCompactionPrefix, canonicalKeptTail...)
		stepMAC = s.computeHMAC([]byte(ref), canonicalizeMessagesBytes(postCompactionPrefix))
		postCompactionMAC = stepMAC
		ledger.PostCompactionMAC = postCompactionMAC
		ledger.LastCommittedCount = len(postCompactionPrefix)
		ledger.CompactionCount++
	} else {
		nextIssuedWindow = appendIssuedToolCallIDs(issuedWindow, allIssuedCalls)
		// Single-anchor rolling MAC signs canonicalWorking PLUS the assistant
		// output emitted by this step so neither prior turns nor model output
		// (including issued tool calls) can be forged on subsequent steps.
		emittedAssistant := buildAssistantWorkingMessage(execResult.AssistantText, allIssuedCalls)
		committedAfter := make([]*runtimev1.BodyWorkingMessage, 0, len(canonicalWorking)+1)
		committedAfter = append(committedAfter, canonicalWorking...)
		committedAfter = append(committedAfter, emittedAssistant)
		stepMAC = s.computeHMAC([]byte(ref), canonicalizeMessagesBytes(committedAfter))
		ledger.PostCompactionMAC = ""
		ledger.LastCommittedCount = len(committedAfter)
	}
	issuedJSON, _ := json.Marshal(nextIssuedWindow)
	ledger.LastStepMAC = stepMAC
	ledger.IssuedToolCallIDsJSON = string(issuedJSON)
	ledger.ReadSetEpoch = readSetEpoch
	ledger.EffectiveContextBudgetTokens = budgetTokens
	ledger.UpdatedAt = formatRFC3339(s.now().UTC())

	doneMsg := &runtimev1.BodyStepDone{
		FinishReason:                 execResult.FinishReason,
		UsageInputTokens:             execResult.UsageInputTokens,
		UsageOutputTokens:            execResult.UsageOutputTokens,
		StepMac:                      stepMAC,
		CompactionSummary:            compactionSummary,
		PostCompactionMac:            postCompactionMAC,
		EffectiveContextBudgetTokens: budgetTokens,
	}

	// Preflight the exact final frames before granting tools or advancing the signed head.
	terminal := make([]*runtimev1.BodyStepStreamEvent, 0, len(commitIssuedCalls)+1)
	for _, call := range commitIssuedCalls {
		terminal = append(terminal, &runtimev1.BodyStepStreamEvent{Payload: &runtimev1.BodyStepStreamEvent_ToolCall{ToolCall: call}})
	}
	terminal = append(terminal, &runtimev1.BodyStepStreamEvent{Payload: &runtimev1.BodyStepStreamEvent_Done{Done: doneMsg}})
	total := emitter.bytesSent
	for i, ev := range terminal {
		ev.EventIndex = emitter.seq + uint32(i+1)
		ev.EffectiveContextBudgetTokens = emitter.budgetTokens
		total += proto.Size(ev)
	}
	if total > bodyStepMaxResponseBytes {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_APP_MESSAGE_PAYLOAD_TOO_LARGE)
	}

	commitErr := s.store.CommitStepLedger(stepCtx, commitStepLedgerInput{
		Ledger:               ledger,
		OriginalReadEpoch:    originalReadEpoch,
		InputIDs:             inputIDs,
		DeviceID:             deviceID,
		Namespace:            ns,
		CarrierSubject:       decision.RegisteredAppSubject,
		LeaseEpoch:           req.GetLeaseEpoch(),
		SettledToolCallIDs:   settledToolCallIDs,
		NewlyIssuedToolCalls: commitIssuedCalls,
		AssistantText:        execResult.AssistantText,
		PublicDeltas:         emitter.publicDeltas,
		StreamBudget:         emitter.budgetTokens,
		RequestDigest:        requestDigest,
		StepRequestID:        stepReqID,
		PrevStepMAC:          prevStepMAC,
		PrevCommittedCount:   prevCommittedCount,
		Done:                 doneMsg,
		Now:                  s.now().UTC(),
	})
	if errors.Is(commitErr, errLeaseConflict) {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_BODY_LEASE_CONFLICT)
	}
	if errors.Is(commitErr, errSessionNotFound) {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if errors.Is(commitErr, errBodyNamespaceMismatch) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	if errors.Is(commitErr, errTombstoneFence) {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_MEMORY_INVALIDATED)
	}
	if errors.Is(commitErr, errSessionConflict) {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_LEDGER_INVALID)
	}
	if commitErr != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}

	// Flush executable tool_call frames strictly AFTER the ledger + relational grant transaction commits!
	for _, ev := range terminal {
		if err := emitter.send(ev); err != nil {
			return err
		}
	}
	return nil
}

// Public Body protocol deltas only. Tool-call activity is transient.
type bodyJournalDelta struct {
	Text             string
	ReasoningSummary bool
}

type bodyStepStreamEmitter struct {
	captureDeltas     bool
	publicDeltas      []bodyJournalDelta
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
	if err := e.stream.Send(ev); err != nil {
		return err
	}
	if e.captureDeltas {
		switch part := ev.Payload.(type) {
		case *runtimev1.BodyStepStreamEvent_TextDelta:
			e.publicDeltas = append(e.publicDeltas, bodyJournalDelta{Text: part.TextDelta})
		case *runtimev1.BodyStepStreamEvent_ReasoningSummaryDelta:
			e.publicDeltas = append(e.publicDeltas, bodyJournalDelta{Text: part.ReasoningSummaryDelta, ReasoningSummary: true})
		}
	}
	return nil
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

// AuthorizeBodySideEffect is the synchronous fail-closed fence called by the Body
// immediately before launching any high-risk side effect (file mutation, shell, etc.).
// Enforces closed action_kind + permission_mode allowlist, non-empty tool_name +
// exact payload_hash verification, read-set qualification, and atomic once-only
// call_id consumption inside SQLite.
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
	ns, err := s.normalizeBodyNamespace(ctx, decision, req.GetCapabilityNamespace())
	if err != nil {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "namespace_unauthorized",
		}, nil
	}
	deviceID := strings.TrimSpace(req.GetDeviceId())
	ref := strings.TrimSpace(req.GetWorkSessionRef())
	callID := strings.TrimSpace(req.GetCallId())
	reqTool := strings.TrimSpace(req.GetToolName())
	reqHash := strings.TrimSpace(req.GetPayloadHash())
	if callID == "" {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "missing_tool_call_id",
		}, nil
	}
	if reqTool == "" {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "missing_tool_name",
		}, nil
	}
	if s.readSetQualifier == nil {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "read_set_qualifier_unconfigured",
		}, nil
	}

	now := s.now().UTC()
	activeLease, err := s.store.VerifyActiveLease(ctx, decision.AccountID, deviceID, ns, decision.RegisteredAppSubject, req.GetLeaseEpoch(), now)
	if err != nil || !activeLease {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "lease_conflict_or_expired",
		}, nil
	}

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
	if sess.Record.GetDeviceId() != "" && sess.Record.GetDeviceId() != "local-default" && sess.Record.GetDeviceId() != deviceID {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "work_session_device_mismatch",
		}, nil
	}
	if !actionKindAllowedByPermissionMode(sess.Record.GetPermissionMode(), req.GetActionKind()) {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "permission_mode_denies_side_effect",
		}, nil
	}

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
	valid, _, qErr := s.readSetQualifier(ctx, decision.AccountID, sess.Record.GetAgentBinding(), ref, ledger.ReadSetEpoch)
	if qErr != nil || !valid {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized:        false,
			DenyReason:        "memory_read_set_invalidated",
			MemoryInvalidated: true,
		}, nil
	}

	// Atomically verify lease, session status, tombstones, tool_name, args payload_hash,
	// and consume call_id once-only inside a single SQLite write transaction!
	resp, err := s.store.ConsumeAuthorizedToolCall(ctx, consumeToolCallInput{
		AccountID:      decision.AccountID,
		DeviceID:       deviceID,
		Namespace:      ns,
		CarrierSubject: decision.RegisteredAppSubject,
		LeaseEpoch:     req.GetLeaseEpoch(),
		WorkSessionRef: ref,
		CallID:         callID,
		ToolName:       reqTool,
		PayloadHash:    reqHash,
		ActionKind:     req.GetActionKind(),
		Now:            s.now().UTC(),
	})
	if err != nil {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "store_unavailable",
		}, nil
	}
	return resp, nil
}

// Retry after owner outages without moving the projection sequence backwards.
func (s *Service) deliverMilestones(ctx context.Context, ref string) error {
	s.milestoneMu.Lock()
	defer s.milestoneMu.Unlock()
	s.mu.Lock()
	hook := s.milestoneHook
	s.mu.Unlock()
	if hook == nil {
		return nil
	}
	rows, err := s.store.readDB.QueryContext(ctx, "SELECT delivery_id,account_id,agent_binding,work_session_ref,body_kind,kind,summary,deliverables FROM runtime_session_milestone WHERE (?='' OR work_session_ref=?) ORDER BY id", ref, ref)
	if err != nil {
		return err
	}
	type entry struct {
		SessionMilestone
		paths string
	}
	var pending []entry
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.DeliveryID, &e.AccountID, &e.AgentBinding, &e.WorkSessionRef, &e.BodyKind, &e.Kind, &e.TopicSummary, &e.paths); err != nil {
			rows.Close()
			return err
		}
		pending = append(pending, e)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	var failures error
	blocked := make(map[string]bool)
	for _, e := range pending {
		if blocked[e.WorkSessionRef] {
			continue
		}
		err := json.Unmarshal([]byte(e.paths), &e.Deliverables)
		if err == nil {
			err = hook(ctx, e.SessionMilestone)
		}
		if err == nil {
			_, err = s.store.writeDB.ExecContext(ctx, "DELETE FROM runtime_session_milestone WHERE delivery_id=?", e.DeliveryID)
		}
		if err != nil {
			failures = errors.Join(failures, err)
			blocked[e.WorkSessionRef] = true
		}
	}
	return failures
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
	ns, err := s.normalizeBodyNamespace(ctx, decision, req.GetCapabilityNamespace())
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	switch strings.TrimSpace(req.GetStatus()) {
	case "", "active", "idle", "running", "waiting", "waiting_approval", "error", "completed", "archived", "paused", "stopped":
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	resp, updatedRow, err := s.store.ApplyBodyProjection(ctx, decision.AccountID, ns, decision.RegisteredAppSubject, req, now)
	if errors.Is(err, errLeaseConflict) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_BODY_LEASE_CONFLICT)
	}
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
	}
	if req.GetMilestoneKind() != "" {
		if err := s.deliverMilestones(ctx, req.GetWorkSessionRef()); err != nil {
			return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
	}
	return resp, nil
}
