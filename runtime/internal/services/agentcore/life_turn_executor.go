package agentcore

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	lifeTurnPromptMaxTokens = 512
	lifeTurnRecallLimit     = 8
	lifeTurnExecutorAppID   = "runtime.agentcore"
	lifeTurnExecutorModelID = "local/default"
)

type lifeTurnRequest struct {
	Agent    *runtimev1.AgentRecord
	State    *runtimev1.AgentStateProjection
	Hook     *runtimev1.PendingHook
	Recall   []*runtimev1.CanonicalMemoryView
	Autonomy *runtimev1.AgentAutonomyState
}

type lifeTurnResult struct {
	StatusText                *string
	CanonicalMemoryCandidates []*lifeTurnMemoryCandidate
	NextHookIntent            *runtimev1.NextHookIntent
	Summary                   string
	TokensUsed                int64
}

type lifeTurnMemoryCandidate struct {
	CanonicalClass string
	PolicyReason   string
	RecordRaw      json.RawMessage
}

type lifeTurnScenarioExecutor interface {
	ExecuteScenario(context.Context, *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error)
}

type aiBackedLifeTrackExecutor struct {
	ai lifeTurnScenarioExecutor
}

type lifeTurnExecutionError struct {
	status     runtimev1.AgentHookStatus
	reasonCode runtimev1.ReasonCode
	message    string
	retryable  bool
	tokensUsed int64
}

type lifeTurnExecutorJSON struct {
	StatusText                *string                       `json:"status_text"`
	Summary                   string                        `json:"summary"`
	TokensUsed                *int64                        `json:"tokens_used"`
	CanonicalMemoryCandidates []lifeTurnMemoryCandidateJSON `json:"canonical_memory_candidates"`
	NextHookIntent            json.RawMessage               `json:"next_hook_intent"`
}

type lifeTurnMemoryCandidateJSON struct {
	CanonicalClass string          `json:"canonical_class"`
	PolicyReason   string          `json:"policy_reason"`
	Record         json.RawMessage `json:"record"`
}

func NewAIBackedLifeTrackExecutor(ai lifeTurnScenarioExecutor) LifeTrackExecutor {
	if ai == nil {
		return rejectingLifeTrackExecutor{}
	}
	return &aiBackedLifeTrackExecutor{ai: ai}
}

func (e *lifeTurnExecutionError) Error() string {
	if e == nil {
		return ""
	}
	return strings.TrimSpace(e.message)
}

func (e *lifeTurnExecutionError) decision() *hookExecutionDecision {
	if e == nil {
		return failedHookDecision(runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, "life turn execution failed", false, 0)
	}
	switch e.status {
	case runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_REJECTED:
		return rejectedHookDecision(e.reasonCode, e.message)
	case runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED:
		return failedHookDecision(e.reasonCode, e.message, e.retryable, e.tokensUsed)
	default:
		return failedHookDecision(runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, firstNonEmpty(e.message, "life turn execution failed"), e.retryable, e.tokensUsed)
	}
}

func (e *aiBackedLifeTrackExecutor) ExecuteLifeTrackHook(ctx context.Context, req *lifeTurnRequest) (*lifeTurnResult, error) {
	if e == nil || e.ai == nil {
		return nil, &lifeTurnExecutionError{
			status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_REJECTED,
			reasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			message:    "runtime internal life-track executor unavailable or not admitted",
		}
	}
	execReq, err := buildLifeTurnScenarioRequest(req)
	if err != nil {
		return nil, &lifeTurnExecutionError{
			status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED,
			reasonCode: runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			message:    err.Error(),
		}
	}
	resp, err := e.ai.ExecuteScenario(ctx, execReq)
	if err != nil {
		return nil, &lifeTurnExecutionError{
			status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED,
			reasonCode: reasonCodeFromError(err),
			message:    err.Error(),
			retryable:  false,
		}
	}
	text := strings.TrimSpace(resp.GetOutput().GetTextGenerate().GetText())
	result, err := decodeLifeTurnExecutorResult(text, responseTokensUsed(resp))
	if err != nil {
		return nil, &lifeTurnExecutionError{
			status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED,
			reasonCode: runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			message:    err.Error(),
		}
	}
	return result, nil
}

func buildLifeTurnScenarioRequest(req *lifeTurnRequest) (*runtimev1.ExecuteScenarioRequest, error) {
	if req == nil || req.Agent == nil || req.State == nil || req.Hook == nil {
		return nil, fmt.Errorf("life turn requires committed agent, state, and hook")
	}
	systemPrompt, userPrompt, err := lifeTurnPrompts(req)
	if err != nil {
		return nil, err
	}
	subjectUserID := strings.TrimSpace(req.State.GetActiveUserId())
	if subjectUserID == "" {
		subjectUserID = strings.TrimSpace(req.Agent.GetAgentId())
	}
	return &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         lifeTurnExecutorAppID,
			SubjectUserId: subjectUserID,
			ModelId:       lifeTurnExecutorModelID,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     10_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					SystemPrompt: systemPrompt,
					MaxTokens:    lifeTurnPromptMaxTokens,
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

func lifeTurnPrompts(req *lifeTurnRequest) (string, string, error) {
	marshal := protojson.MarshalOptions{
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	autonomy := req.Autonomy
	if autonomy == nil {
		autonomy = &runtimev1.AgentAutonomyState{}
	}
	agentRaw, err := marshal.Marshal(req.Agent)
	if err != nil {
		return "", "", fmt.Errorf("marshal life turn agent: %w", err)
	}
	stateRaw, err := marshal.Marshal(req.State)
	if err != nil {
		return "", "", fmt.Errorf("marshal life turn state: %w", err)
	}
	hookRaw, err := marshal.Marshal(req.Hook)
	if err != nil {
		return "", "", fmt.Errorf("marshal life turn hook: %w", err)
	}
	autonomyRaw, err := marshal.Marshal(autonomy)
	if err != nil {
		return "", "", fmt.Errorf("marshal life turn autonomy: %w", err)
	}
	recallRaw, err := marshal.Marshal(&runtimev1.QueryAgentMemoryResponse{Memories: req.Recall})
	if err != nil {
		return "", "", fmt.Errorf("marshal life turn recall: %w", err)
	}
	systemPrompt := strings.TrimSpace(`You are the runtime-private Life Track executor for Nimi Agent Core.
Return exactly one JSON object and nothing else.
Allowed top-level fields:
- status_text: string or null
- summary: string
- tokens_used: integer
- canonical_memory_candidates: array
- next_hook_intent: object or null

Rules:
- Do not emit markdown, prose, code fences, or comments.
- Do not emit initiate_chat_intent or any app-facing action.
- Do not mutate arbitrary attributes or world/user state directly.
- canonical_memory_candidates entries may only contain:
  - canonical_class: PUBLIC_SHARED | WORLD_SHARED | DYADIC
  - policy_reason: string
  - record: MemoryRecordInput proto-json using exactly one payload branch: episodic, semantic, or observational
- next_hook_intent must be valid NextHookIntent proto-json if present.
- If no follow-up hook is needed, set next_hook_intent to null.
- If no canonical memory should be written, set canonical_memory_candidates to [].
- If status text should remain unchanged, set status_text to null.
`)
	userPrompt := strings.TrimSpace(fmt.Sprintf(`Committed agent truth:
agent=%s

Committed state projection:
state=%s

Triggering hook:
hook=%s

Autonomy snapshot:
autonomy=%s

Canonical recall set:
recall=%s
`, string(agentRaw), string(stateRaw), string(hookRaw), string(autonomyRaw), string(recallRaw)))
	return systemPrompt, userPrompt, nil
}

func decodeLifeTurnExecutorResult(raw string, fallbackTokens int64) (*lifeTurnResult, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, fmt.Errorf("life turn executor returned empty output")
	}
	decoder := json.NewDecoder(bytes.NewBufferString(raw))
	decoder.DisallowUnknownFields()
	var payload lifeTurnExecutorJSON
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("life turn executor output invalid: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("life turn executor output must contain a single JSON object")
		}
		return nil, fmt.Errorf("life turn executor output invalid: %w", err)
	}
	result := &lifeTurnResult{
		StatusText:                payload.StatusText,
		Summary:                   strings.TrimSpace(payload.Summary),
		CanonicalMemoryCandidates: make([]*lifeTurnMemoryCandidate, 0, len(payload.CanonicalMemoryCandidates)),
		TokensUsed:                fallbackTokens,
	}
	if payload.TokensUsed != nil && *payload.TokensUsed < 0 {
		return nil, fmt.Errorf("life turn executor tokens_used must be non-negative")
	}
	if result.TokensUsed <= 0 && payload.TokensUsed != nil {
		result.TokensUsed = *payload.TokensUsed
	}
	if len(payload.NextHookIntent) > 0 && string(payload.NextHookIntent) != "null" {
		intent := &runtimev1.NextHookIntent{}
		unmarshal := protojson.UnmarshalOptions{DiscardUnknown: false}
		if err := unmarshal.Unmarshal(payload.NextHookIntent, intent); err != nil {
			return nil, fmt.Errorf("life turn executor next_hook_intent invalid: %w", err)
		}
		if err := validateNextHookIntent(intent); err != nil {
			return nil, fmt.Errorf("life turn executor next_hook_intent invalid: %w", err)
		}
		result.NextHookIntent = intent
	}
	for _, candidate := range payload.CanonicalMemoryCandidates {
		result.CanonicalMemoryCandidates = append(result.CanonicalMemoryCandidates, &lifeTurnMemoryCandidate{
			CanonicalClass: candidate.CanonicalClass,
			PolicyReason:   strings.TrimSpace(candidate.PolicyReason),
			RecordRaw:      append([]byte(nil), candidate.Record...),
		})
	}
	return result, nil
}

func responseTokensUsed(resp *runtimev1.ExecuteScenarioResponse) int64 {
	if resp == nil || resp.GetUsage() == nil {
		return 0
	}
	return resp.GetUsage().GetInputTokens() + resp.GetUsage().GetOutputTokens()
}

func buildLifeTurnCanonicalMemoryCandidate(entry *agentEntry, hook *runtimev1.PendingHook, input *lifeTurnMemoryCandidate, now time.Time) (*runtimev1.CanonicalMemoryCandidate, *runtimev1.CanonicalMemoryRejection) {
	if hook == nil {
		return nil, &runtimev1.CanonicalMemoryRejection{
			ReasonCode: runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			Message:    "life turn memory candidate requires triggering hook",
		}
	}
	sourceEventID := strings.TrimSpace(hook.GetHookId())
	if input == nil {
		return nil, &runtimev1.CanonicalMemoryRejection{
			SourceEventId: sourceEventID,
			ReasonCode:    runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			Message:       "life turn memory candidate is required",
		}
	}
	canonicalClass, err := parseLifeTurnCanonicalClass(input.CanonicalClass)
	if err != nil {
		return nil, &runtimev1.CanonicalMemoryRejection{
			SourceEventId: sourceEventID,
			ReasonCode:    runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			Message:       err.Error(),
		}
	}
	record := &runtimev1.MemoryRecordInput{}
	if len(input.RecordRaw) == 0 || string(input.RecordRaw) == "null" {
		return nil, &runtimev1.CanonicalMemoryRejection{
			SourceEventId: sourceEventID,
			ReasonCode:    runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			Message:       "life turn memory candidate record is required",
		}
	}
	unmarshal := protojson.UnmarshalOptions{DiscardUnknown: false}
	if err := unmarshal.Unmarshal(input.RecordRaw, record); err != nil {
		return nil, &runtimev1.CanonicalMemoryRejection{
			SourceEventId: sourceEventID,
			ReasonCode:    runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			Message:       fmt.Sprintf("life turn memory candidate record invalid: %v", err),
		}
	}
	if err := validateLifeTurnRecordInput(record); err != nil {
		return nil, &runtimev1.CanonicalMemoryRejection{
			SourceEventId: sourceEventID,
			ReasonCode:    runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			Message:       err.Error(),
		}
	}
	record.CanonicalClass = canonicalClass
	record.Provenance = normalizeLifeTurnProvenance(record.GetProvenance(), sourceEventID, now)
	targetBank, err := targetBankForLifeTurnCanonicalClass(entry, canonicalClass)
	if err != nil {
		return nil, &runtimev1.CanonicalMemoryRejection{
			SourceEventId: sourceEventID,
			ReasonCode:    runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			Message:       err.Error(),
		}
	}
	return &runtimev1.CanonicalMemoryCandidate{
		CanonicalClass: canonicalClass,
		TargetBank:     targetBank,
		Record:         record,
		SourceEventId:  sourceEventID,
		PolicyReason:   firstNonEmpty(strings.TrimSpace(input.PolicyReason), "life_track"),
	}, nil
}

func parseLifeTurnCanonicalClass(raw string) (runtimev1.MemoryCanonicalClass, error) {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case "PUBLIC_SHARED", "MEMORY_CANONICAL_CLASS_PUBLIC_SHARED":
		return runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED, nil
	case "WORLD_SHARED", "MEMORY_CANONICAL_CLASS_WORLD_SHARED":
		return runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED, nil
	case "DYADIC", "MEMORY_CANONICAL_CLASS_DYADIC":
		return runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC, nil
	default:
		return runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_UNSPECIFIED, fmt.Errorf("life turn memory candidate canonical_class must be PUBLIC_SHARED, WORLD_SHARED, or DYADIC")
	}
}

func validateLifeTurnRecordInput(record *runtimev1.MemoryRecordInput) error {
	if record == nil {
		return fmt.Errorf("life turn memory candidate record is required")
	}
	if record.GetKind() == runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_UNSPECIFIED {
		return fmt.Errorf("life turn memory candidate record kind is required")
	}
	switch payload := record.GetPayload().(type) {
	case *runtimev1.MemoryRecordInput_Episodic:
		if payload.Episodic == nil || strings.TrimSpace(payload.Episodic.GetSummary()) == "" {
			return fmt.Errorf("life turn episodic memory requires summary")
		}
	case *runtimev1.MemoryRecordInput_Semantic:
		if payload.Semantic == nil ||
			strings.TrimSpace(payload.Semantic.GetSubject()) == "" ||
			strings.TrimSpace(payload.Semantic.GetPredicate()) == "" ||
			strings.TrimSpace(payload.Semantic.GetObject()) == "" {
			return fmt.Errorf("life turn semantic memory requires subject, predicate, and object")
		}
	case *runtimev1.MemoryRecordInput_Observational:
		if payload.Observational == nil || strings.TrimSpace(payload.Observational.GetObservation()) == "" {
			return fmt.Errorf("life turn observational memory requires observation")
		}
	default:
		return fmt.Errorf("life turn memory candidate record payload is required")
	}
	return nil
}

func normalizeLifeTurnProvenance(input *runtimev1.MemoryProvenance, sourceEventID string, now time.Time) *runtimev1.MemoryProvenance {
	provenance := input
	if provenance == nil {
		provenance = &runtimev1.MemoryProvenance{}
	}
	if strings.TrimSpace(provenance.GetSourceSystem()) == "" {
		provenance.SourceSystem = "runtime.agentcore.life_track"
	}
	if strings.TrimSpace(provenance.GetSourceEventId()) == "" {
		provenance.SourceEventId = strings.TrimSpace(sourceEventID)
	}
	if provenance.GetCommittedAt() == nil {
		provenance.CommittedAt = timestamppb.New(now)
	}
	return provenance
}

func targetBankForLifeTurnCanonicalClass(entry *agentEntry, canonicalClass runtimev1.MemoryCanonicalClass) (*runtimev1.MemoryBankLocator, error) {
	if entry == nil || entry.Agent == nil || entry.State == nil {
		return nil, fmt.Errorf("life turn memory candidate requires committed agent state")
	}
	switch canonicalClass {
	case runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED:
		return &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: entry.Agent.GetAgentId()},
			},
		}, nil
	case runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED:
		worldID := strings.TrimSpace(entry.State.GetActiveWorldId())
		if worldID == "" {
			return nil, fmt.Errorf("WORLD_SHARED canonical memory requires runtime-owned active_world_id on Agent Core")
		}
		return &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED,
			Owner: &runtimev1.MemoryBankLocator_WorldShared{
				WorldShared: &runtimev1.WorldSharedBankOwner{WorldId: worldID},
			},
		}, nil
	case runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC:
		userID := strings.TrimSpace(entry.State.GetActiveUserId())
		if userID == "" {
			return nil, fmt.Errorf("DYADIC canonical memory requires runtime-owned active_user_id on Agent Core")
		}
		return &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
			Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
				AgentDyadic: &runtimev1.AgentDyadicBankOwner{
					AgentId: entry.Agent.GetAgentId(),
					UserId:  userID,
				},
			},
		}, nil
	default:
		return nil, fmt.Errorf("unsupported life turn canonical memory class")
	}
}
