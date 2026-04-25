package runtimeagent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	lifeTurnPromptMaxTokens = 512
	lifeTurnRecallLimit     = 8
	lifeTurnExecutorAppID   = "runtime.agent.internal.life_track"
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
	PosturePatch              *BehavioralPosturePatch
	StatusText                *string
	CanonicalMemoryCandidates []*lifeTurnMemoryCandidate
	// NextHookIntent carries the runtime-admitted follow-up HookIntent
	// (K-AGCORE-041). `intent_id`, `trigger_family`, `trigger_detail`,
	// `effect`, and `admission_state` are all runtime-bound; admission
	// validation finalizes the state to `pending` on acceptance.
	NextHookIntent *runtimev1.HookIntent
	Summary        string
	TokensUsed     int64
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
	admissionState runtimev1.HookAdmissionState
	reasonCode     runtimev1.ReasonCode
	message        string
	retryable      bool
	tokensUsed     int64
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
	switch e.admissionState {
	case runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_REJECTED:
		return rejectedHookDecision(e.reasonCode, e.message)
	case runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED:
		return failedHookDecision(e.reasonCode, e.message, e.retryable, e.tokensUsed)
	default:
		return failedHookDecision(runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, firstNonEmpty(e.message, "life turn execution failed"), e.retryable, e.tokensUsed)
	}
}

func (e *aiBackedLifeTrackExecutor) ExecuteLifeTrackHook(ctx context.Context, req *lifeTurnRequest) (*lifeTurnResult, error) {
	if e == nil || e.ai == nil {
		return nil, &lifeTurnExecutionError{
			admissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_REJECTED,
			reasonCode:     runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			message:        "runtime internal life-track executor unavailable or not admitted",
		}
	}
	execReq, err := buildLifeTurnScenarioRequest(req)
	if err != nil {
		return nil, &lifeTurnExecutionError{
			admissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED,
			reasonCode:     runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			message:        err.Error(),
		}
	}
	resp, err := e.ai.ExecuteScenario(ctx, execReq)
	if err != nil {
		return nil, &lifeTurnExecutionError{
			admissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED,
			reasonCode:     reasonCodeFromError(err),
			message:        err.Error(),
			retryable:      false,
		}
	}
	text := strings.TrimSpace(resp.GetOutput().GetTextGenerate().GetText())
	result, err := decodeLifeTurnExecutorResult(text, responseTokensUsed(resp))
	if err != nil {
		return nil, &lifeTurnExecutionError{
			admissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED,
			reasonCode:     runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			message:        err.Error(),
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
Return APML only. The first non-whitespace characters must be <life-turn>.
Allowed top-level shape:
<life-turn>
  <behavioral-posture>...</behavioral-posture> optional
  <status-text>...</status-text> optional
  <summary>...</summary>
  <tokens-used>integer</tokens-used> optional
  <canonical-memory-candidates>...</canonical-memory-candidates>
  <next-hook-intent ...>...</next-hook-intent> optional
</life-turn>

Rules:
- Do not emit markdown, prose, code fences, or comments.
- Do not emit initiate_chat_intent or any app-facing action.
- Do not mutate arbitrary attributes or world/user state directly.
- recall, hook context, and conversational evidence are source evidence, not canonical memory truth by default.
- emit canonical_memory_candidates only when the current evidence window supports a stable durable memory proposal.
- absorb explicit same-window self-correction or contradiction before candidate emission; do not emit two conflicting durable candidates from one evidence window.
- if the evidence remains unstable, tentative, or situational, emit empty <canonical-memory-candidates></canonical-memory-candidates> or prefer <observational> over <semantic>.
- behavioral-posture, if present, may only contain:
  - <posture-class>, <action-family>, <interrupt-mode>, <transition-reason>, repeated <truth-basis-id>, <status-text>
  - action-family: observe | engage | support | assist | reflect | rest
  - interrupt-mode: welcome | cautious | focused
- canonical-memory-candidates contains repeated:
  - <candidate canonical-class="PUBLIC_SHARED|WORLD_SHARED|DYADIC" policy-reason="...">
  - exactly one payload child: <episodic>, <semantic>, or <observational>
  - episodic fields: <summary>, optional <occurred-at>, repeated <participant>
  - semantic fields: <subject>, <predicate>, <object>, optional <confidence>
  - observational fields: <observation>, optional <observed-at>, optional <source-ref>
- next-hook-intent, if present, uses:
  - <next-hook-intent trigger-family="TIME|EVENT" effect="FOLLOW_UP_TURN" reason="...">
  - one trigger child only: <time delay="600s"/>, <event-user-idle idle-for="600s"/>, or <event-chat-ended/>
- next-hook-intent is an APML proposal for a typed HookIntent after runtime validation.
- runtime host owns cadence truth; no cadence-interaction tag is admitted.
- no absolute scheduled time, turn_completed, state_condition, world_event,
  or compound trigger is admitted in v1.
- If no follow-up hook is needed, omit <next-hook-intent>.
- If no canonical memory should be written, emit empty <canonical-memory-candidates></canonical-memory-candidates>.
- If status text should remain unchanged, omit <status-text>.
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
	var payload lifeTurnExecutorAPML
	if err := decodeStrictAPML(raw, "life-turn", &payload); err != nil {
		return nil, fmt.Errorf("life turn executor output invalid: %w", err)
	}
	result := &lifeTurnResult{
		PosturePatch:              nil,
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
	if payload.BehavioralPosture != nil {
		patch := apmlPosturePatch(payload.BehavioralPosture)
		if strings.TrimSpace(patch.StatusText) == "" && payload.StatusText != nil {
			patch.StatusText = strings.TrimSpace(*payload.StatusText)
		}
		normalized, err := normalizeBehavioralPosturePatch("life_track", *patch)
		if err != nil {
			return nil, fmt.Errorf("life turn executor behavioral_posture invalid: %w", err)
		}
		result.PosturePatch = &BehavioralPosturePatch{
			PostureClass:     normalized.PostureClass,
			ActionFamily:     normalized.ActionFamily,
			InterruptMode:    normalized.InterruptMode,
			TransitionReason: normalized.TransitionReason,
			TruthBasisIDs:    append([]string(nil), normalized.TruthBasisIDs...),
			StatusText:       normalized.StatusText,
		}
		if result.StatusText == nil {
			result.StatusText = &result.PosturePatch.StatusText
		}
	}
	if payload.NextHookIntent != nil {
		intent, err := apmlHookIntentValue(payload.NextHookIntent)
		if err != nil {
			return nil, fmt.Errorf("life turn executor next_hook_intent invalid: %w", err)
		}
		result.NextHookIntent = intent
	}
	for _, candidate := range payload.CanonicalMemoryCandidates {
		parsedCandidate, err := apmlMemoryCandidateRaw(candidate)
		if err != nil {
			return nil, fmt.Errorf("life turn executor canonical_memory_candidate invalid: %w", err)
		}
		result.CanonicalMemoryCandidates = append(result.CanonicalMemoryCandidates, &lifeTurnMemoryCandidate{
			CanonicalClass: parsedCandidate.CanonicalClass,
			PolicyReason:   parsedCandidate.PolicyReason,
			RecordRaw:      append([]byte(nil), parsedCandidate.RecordRaw...),
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
	sourceEventID := hookIntentID(hook)
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
		provenance.SourceSystem = "runtime.agent.internal.life_track"
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
