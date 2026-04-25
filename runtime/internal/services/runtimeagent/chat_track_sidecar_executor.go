package runtimeagent

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const (
	chatTrackSidecarPromptMaxTokens = 768
	chatTrackSidecarExecutorAppID   = "runtime.agent.internal.chat_track_sidecar"
	chatTrackSidecarExecutorModelID = "local/default"
)

type ChatTrackSidecarExecutionRequest struct {
	CallerAppID   string
	AgentID       string
	SourceEventID string
	Messages      []*runtimev1.ChatMessage
}

type ChatTrackSidecarExecutorRequest struct {
	CallerAppID   string
	Agent         *runtimev1.AgentRecord
	State         *runtimev1.AgentStateProjection
	SourceEventID string
	Messages      []*runtimev1.ChatMessage
	PendingHooks  []*runtimev1.PendingHook
}

type ChatTrackSidecarExecutor interface {
	ExecuteChatTrackSidecar(context.Context, *ChatTrackSidecarExecutorRequest) (*ChatTrackSidecarResult, error)
}

type rejectingChatTrackSidecarExecutor struct{}

type chatTrackSidecarScenarioExecutor interface {
	ExecuteScenario(context.Context, *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error)
}

type aiBackedChatTrackSidecarExecutor struct {
	ai chatTrackSidecarScenarioExecutor
}

func (rejectingChatTrackSidecarExecutor) ExecuteChatTrackSidecar(context.Context, *ChatTrackSidecarExecutorRequest) (*ChatTrackSidecarResult, error) {
	return nil, fmt.Errorf("runtime internal chat-track sidecar executor unavailable or not admitted")
}

func NewAIBackedChatTrackSidecarExecutor(ai chatTrackSidecarScenarioExecutor) ChatTrackSidecarExecutor {
	if ai == nil {
		return rejectingChatTrackSidecarExecutor{}
	}
	return &aiBackedChatTrackSidecarExecutor{ai: ai}
}

func (s *Service) HasChatTrackSidecarExecutor() bool {
	return s.chatTrackRuntime().hasSidecarExecutor()
}

func (s *Service) SetChatTrackSidecarExecutor(executor ChatTrackSidecarExecutor) {
	s.setChatTrackSidecarExecutor(executor)
}

func (s *Service) ExecuteChatTrackSidecar(ctx context.Context, req ChatTrackSidecarExecutionRequest) error {
	return s.chatTrackRuntime().executeSidecar(ctx, req)
}

func (s *Service) executeChatTrackSidecar(ctx context.Context, req ChatTrackSidecarExecutionRequest) (*ChatTrackSidecarApplySummary, error) {
	return s.chatTrackRuntime().runSidecarExecution(ctx, req)
}

func (e *aiBackedChatTrackSidecarExecutor) ExecuteChatTrackSidecar(ctx context.Context, req *ChatTrackSidecarExecutorRequest) (*ChatTrackSidecarResult, error) {
	if e == nil || e.ai == nil {
		return nil, fmt.Errorf("runtime internal chat-track sidecar executor unavailable or not admitted")
	}
	execReq, err := buildChatTrackSidecarScenarioRequest(req)
	if err != nil {
		return nil, err
	}
	resp, err := e.ai.ExecuteScenario(ctx, execReq)
	if err != nil {
		return nil, err
	}
	text := strings.TrimSpace(resp.GetOutput().GetTextGenerate().GetText())
	return decodeChatTrackSidecarExecutorResult(text, req)
}

func buildChatTrackSidecarScenarioRequest(req *ChatTrackSidecarExecutorRequest) (*runtimev1.ExecuteScenarioRequest, error) {
	if req == nil || req.Agent == nil || req.State == nil {
		return nil, fmt.Errorf("chat track sidecar requires committed agent and state")
	}
	systemPrompt, userPrompt, err := chatTrackSidecarPrompts(req)
	if err != nil {
		return nil, err
	}
	subjectUserID := strings.TrimSpace(req.State.GetActiveUserId())
	if subjectUserID == "" {
		subjectUserID = strings.TrimSpace(req.Agent.GetAgentId())
	}
	return &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         firstNonEmpty(strings.TrimSpace(req.CallerAppID), chatTrackSidecarExecutorAppID),
			SubjectUserId: subjectUserID,
			ModelId:       chatTrackSidecarExecutorModelID,
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
					MaxTokens:    chatTrackSidecarPromptMaxTokens,
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

func chatTrackSidecarPrompts(req *ChatTrackSidecarExecutorRequest) (string, string, error) {
	marshal := protojson.MarshalOptions{
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	agentRaw, err := marshal.Marshal(req.Agent)
	if err != nil {
		return "", "", fmt.Errorf("marshal chat sidecar agent: %w", err)
	}
	stateRaw, err := marshal.Marshal(req.State)
	if err != nil {
		return "", "", fmt.Errorf("marshal chat sidecar state: %w", err)
	}
	messagesRaw, err := marshal.Marshal(&runtimev1.TextGenerateScenarioSpec{Input: req.Messages})
	if err != nil {
		return "", "", fmt.Errorf("marshal chat sidecar messages: %w", err)
	}
	hooksRaw, err := marshal.Marshal(&runtimev1.ListPendingHooksResponse{Hooks: req.PendingHooks})
	if err != nil {
		return "", "", fmt.Errorf("marshal chat sidecar hooks: %w", err)
	}
	systemPrompt := strings.TrimSpace(`You are the runtime-private Chat Track sidecar executor for Nimi Agent Core.
Return APML only. The first non-whitespace characters must be <chat-track-sidecar>.
Allowed top-level shape:
<chat-track-sidecar>
  <behavioral-posture>...</behavioral-posture> optional
  repeated <cancel-pending-hook-id>...</cancel-pending-hook-id>
  <next-hook-intent ...>...</next-hook-intent> optional
  <canonical-memory-candidates>...</canonical-memory-candidates>
</chat-track-sidecar>

Rules:
- Do not emit markdown, prose, code fences, JSON, or comments.
- Do not emit any tag outside behavioral-posture, cancel-pending-hook-id, next-hook-intent, and canonical-memory-candidates.
- Do not emit proactive initiate-chat semantics, arbitrary state mutation, direct world/user mutation, or free-form scheduling logic.
- current chat transcript is source evidence, not canonical memory truth by default.
- emit canonical-memory-candidates only when the current evidence window supports a stable durable memory proposal.
- absorb explicit same-window self-correction or contradiction before candidate emission; do not emit two conflicting durable candidates from one evidence window.
- if the evidence remains unstable, tentative, or situational, emit empty <canonical-memory-candidates></canonical-memory-candidates> or prefer <observational> over <semantic>.
- behavioral-posture may contain only <posture-class>, <action-family>, <interrupt-mode>, <transition-reason>, repeated <truth-basis-id>, and <status-text>.
- action-family: observe | engage | support | assist | reflect | rest.
- interrupt-mode: welcome | cautious | focused.
- cancel-pending-hook-id may only reference intent ids present in pending_hooks.
- next-hook-intent is an APML proposal for a typed HookIntent after runtime validation and uses one trigger child only: <time delay="600s"/>, <event-user-idle idle-for="600s"/>, or <event-chat-ended/>.
- next-hook-intent attributes: trigger-family="TIME|EVENT", effect="FOLLOW_UP_TURN", optional reason="...".
- runtime host owns cadence truth; no cadence-interaction tag is admitted.
- no absolute scheduled time, turn-completed, state-condition, world-event, or compound trigger is admitted in v1.
- candidate format: <candidate canonical-class="PUBLIC_SHARED|WORLD_SHARED|DYADIC" policy-reason="..."> with exactly one <episodic>, <semantic>, or <observational> child.
- episodic fields: <summary>, optional <occurred-at>, repeated <participant>.
- semantic fields: <subject>, <predicate>, <object>, optional <confidence>.
- observational fields: <observation>, optional <observed-at>, optional <source-ref>.
- If no hooks should be canceled, omit <cancel-pending-hook-id>.
- If no follow-up hook is needed, omit <next-hook-intent>.
- If no canonical memory should be written, emit empty <canonical-memory-candidates></canonical-memory-candidates>.
`)
	userPrompt := strings.TrimSpace(fmt.Sprintf(`Committed agent truth:
agent=%s

Committed state projection:
state=%s

Current chat transcript:
messages=%s

Current pending hooks:
pending_hooks=%s
`, string(agentRaw), string(stateRaw), string(messagesRaw), string(hooksRaw)))
	return systemPrompt, userPrompt, nil
}

func decodeChatTrackSidecarExecutorResult(raw string, req *ChatTrackSidecarExecutorRequest) (*ChatTrackSidecarResult, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, fmt.Errorf("chat track sidecar executor returned empty output")
	}
	var payload chatTrackSidecarExecutorAPML
	if err := decodeStrictAPML(raw, "chat-track-sidecar", &payload); err != nil {
		return nil, fmt.Errorf("chat track sidecar executor output invalid: %w", err)
	}
	result := &ChatTrackSidecarResult{
		CancelPendingHookIDs:      uniqueNonEmptyStrings(payload.CancelPendingHookIDs),
		CanonicalMemoryCandidates: make([]*runtimev1.CanonicalMemoryCandidate, 0, len(payload.CanonicalMemoryCandidates)),
	}
	if payload.BehavioralPosture != nil {
		patch := apmlPosturePatch(payload.BehavioralPosture)
		normalized, err := normalizeBehavioralPosturePatch("chat_track", *patch)
		if err != nil {
			return nil, fmt.Errorf("chat track sidecar executor behavioral_posture invalid: %w", err)
		}
		result.PosturePatch = &BehavioralPosturePatch{
			PostureClass:     normalized.PostureClass,
			ActionFamily:     normalized.ActionFamily,
			InterruptMode:    normalized.InterruptMode,
			TransitionReason: normalized.TransitionReason,
			TruthBasisIDs:    append([]string(nil), normalized.TruthBasisIDs...),
			StatusText:       normalized.StatusText,
		}
	}
	if payload.NextHookIntent != nil {
		intent, err := apmlHookIntentValue(payload.NextHookIntent)
		if err != nil {
			return nil, fmt.Errorf("chat track sidecar executor next_hook_intent invalid: %w", err)
		}
		result.NextHookIntent = intent
	}
	now := time.Now().UTC()
	for _, candidate := range payload.CanonicalMemoryCandidates {
		parsedCandidate, err := apmlMemoryCandidateRaw(candidate)
		if err != nil {
			return nil, fmt.Errorf("chat track sidecar executor canonical_memory_candidate invalid: %w", err)
		}
		item, err := buildChatTrackCanonicalMemoryCandidate(req, &lifeTurnMemoryCandidate{
			CanonicalClass: parsedCandidate.CanonicalClass,
			PolicyReason:   parsedCandidate.PolicyReason,
			RecordRaw:      append([]byte(nil), parsedCandidate.RecordRaw...),
		}, now)
		if err != nil {
			return nil, err
		}
		result.CanonicalMemoryCandidates = append(result.CanonicalMemoryCandidates, item)
	}
	return result, nil
}

func buildChatTrackCanonicalMemoryCandidate(req *ChatTrackSidecarExecutorRequest, input *lifeTurnMemoryCandidate, now time.Time) (*runtimev1.CanonicalMemoryCandidate, error) {
	if req == nil || req.Agent == nil || req.State == nil {
		return nil, fmt.Errorf("chat track memory candidate requires committed agent state")
	}
	if input == nil {
		return nil, fmt.Errorf("chat track memory candidate is required")
	}
	canonicalClass, err := parseLifeTurnCanonicalClass(input.CanonicalClass)
	if err != nil {
		return nil, err
	}
	record := &runtimev1.MemoryRecordInput{}
	if len(input.RecordRaw) == 0 || string(input.RecordRaw) == "null" {
		return nil, fmt.Errorf("chat track memory candidate record is required")
	}
	unmarshal := protojson.UnmarshalOptions{DiscardUnknown: false}
	if err := unmarshal.Unmarshal(input.RecordRaw, record); err != nil {
		return nil, fmt.Errorf("chat track memory candidate record invalid: %v", err)
	}
	if err := validateLifeTurnRecordInput(record); err != nil {
		return nil, err
	}
	entry := &agentEntry{Agent: cloneAgentRecord(req.Agent), State: cloneAgentState(req.State)}
	targetBank, err := targetBankForLifeTurnCanonicalClass(entry, canonicalClass)
	if err != nil {
		return nil, err
	}
	sourceEventID := firstNonEmpty(strings.TrimSpace(req.SourceEventID), "chat_sidecar")
	record.CanonicalClass = canonicalClass
	record.Provenance = normalizeChatTrackSidecarProvenance(record.GetProvenance(), sourceEventID, now)
	return &runtimev1.CanonicalMemoryCandidate{
		CanonicalClass: canonicalClass,
		TargetBank:     targetBank,
		Record:         record,
		SourceEventId:  sourceEventID,
		PolicyReason:   firstNonEmpty(strings.TrimSpace(input.PolicyReason), chatTrackSidecarPolicyReason),
	}, nil
}

func cloneChatMessages(input []*runtimev1.ChatMessage) []*runtimev1.ChatMessage {
	out := make([]*runtimev1.ChatMessage, 0, len(input))
	for _, item := range input {
		if item != nil {
			out = append(out, proto.Clone(item).(*runtimev1.ChatMessage))
		}
	}
	return out
}

func clonePendingHooksSorted(input map[string]*runtimev1.PendingHook) []*runtimev1.PendingHook {
	out := make([]*runtimev1.PendingHook, 0, len(input))
	for _, hook := range input {
		if hook != nil {
			out = append(out, clonePendingHook(hook))
		}
	}
	sort.Slice(out, func(i, j int) bool {
		left := out[i].GetScheduledFor().AsTime()
		right := out[j].GetScheduledFor().AsTime()
		if left.Equal(right) {
			return hookIntentID(out[i]) < hookIntentID(out[j])
		}
		return left.Before(right)
	})
	return out
}
