package runtimeagent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const (
	lifeTurnPromptMaxTokens = 512
	lifeTurnRecallLimit     = 8
	lifeTurnExecutorAppID   = "runtime.agent.internal.life_track"
)

type lifeTurnRequest struct {
	Agent    *runtimev1.LocalAgentRecord
	State    *runtimev1.AgentStateProjection
	Hook     *runtimev1.PendingHook
	Recall   []lifeTurnRecallItem
	Autonomy *runtimev1.AgentAutonomyState
	// ExecutionBinding is the committed Runtime Agent AI Config text.generate
	// binding stamped by RuntimeAgentService when it builds the request
	// (K-AGCORE-147). A missing binding fails closed.
	ExecutionBinding publicChatExecutionBinding
}

type lifeTurnRecallItem struct {
	MemoryRef         string `json:"memory_ref"`
	Content           string `json:"content"`
	EpistemicStatus   string `json:"epistemic_status"`
	SourceExplanation string `json:"source_explanation"`
	ProvenanceRef     string `json:"provenance_ref"`
}

type lifeTurnResult struct {
	PosturePatch *BehavioralPosturePatch
	StatusText   *string
	// NextHookIntent carries the runtime-admitted follow-up HookIntent
	// (K-AGCORE-041). `intent_id`, `trigger_family`, `trigger_detail`,
	// `effect`, and `admission_state` are all runtime-bound; admission
	// validation finalizes the state to `pending` on acceptance.
	NextHookIntent *runtimev1.HookIntent
	Summary        string
	TokensUsed     int64
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
	ctx = withPublicChatExecutionIntent(ctx, req.ExecutionBinding, "text.generate")
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
		subjectUserID = strings.TrimSpace(req.Agent.GetLocalAgentRef())
	}
	if err := validateRuntimePrivateExecutorBinding("life turn", req.ExecutionBinding); err != nil {
		return nil, err
	}
	return &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         lifeTurnExecutorAppID,
			SubjectUserId: subjectUserID,
			TimeoutMs:     10_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					SystemPrompt: systemPrompt,
					MaxTokens:    proto.Int32(lifeTurnPromptMaxTokens),
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
	recallRaw, err := json.Marshal(struct {
		Memories []lifeTurnRecallItem `json:"memories"`
	}{Memories: req.Recall})
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
  <next-hook-intent ...>...</next-hook-intent> optional
</life-turn>

Rules:
- Do not emit markdown, prose, code fences, or comments.
- Do not emit initiate_chat_intent or any app-facing action.
- Do not mutate arbitrary attributes or world/user state directly.
- recall, hook context, and conversational evidence are read-only advisory context.
- do not emit Memory candidates or canonical Memory judgments; Runtime commits only the typed terminal activity fact.
- behavioral-posture, if present, may only contain:
  - <posture-class>, <action-family>, <interrupt-mode>, <transition-reason>, repeated <truth-basis-id>, <status-text>
  - action-family: observe | engage | support | assist | reflect | rest
  - interrupt-mode: welcome | cautious | focused
- next-hook-intent, if present, uses:
  - <next-hook-intent trigger-family="TIME|EVENT" effect="FOLLOW_UP_TURN" reason="...">
  - one trigger child only: <time delay="600s"/>, <event-user-idle idle-for="600s"/>, or <event-chat-ended/>
- next-hook-intent is an APML proposal for a typed HookIntent after runtime validation.
- runtime host owns cadence truth; no cadence-interaction tag is admitted.
- no absolute scheduled time, turn_completed, state_condition, world_event,
  or compound trigger is admitted in v1.
- If no follow-up hook is needed, omit <next-hook-intent>.
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
		PosturePatch: nil,
		StatusText:   payload.StatusText,
		Summary:      strings.TrimSpace(payload.Summary),
		TokensUsed:   fallbackTokens,
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
	return result, nil
}

func responseTokensUsed(resp *runtimev1.ExecuteScenarioResponse) int64 {
	if resp == nil || resp.GetUsage() == nil {
		return 0
	}
	return resp.GetUsage().GetInputTokens() + resp.GetUsage().GetOutputTokens()
}
