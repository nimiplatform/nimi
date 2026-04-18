package agentcore

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const (
	chatTrackSidecarPromptMaxTokens = 768
	chatTrackSidecarExecutorAppID   = "runtime.agentcore"
	chatTrackSidecarExecutorModelID = "local/default"
)

type ChatTrackSidecarExecutionRequest struct {
	AgentID       string
	SourceEventID string
	Messages      []*runtimev1.ChatMessage
}

type ChatTrackSidecarExecutorRequest struct {
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

type chatTrackSidecarExecutorJSON struct {
	BehavioralPosture         *lifeTurnBehavioralPostureJSON `json:"behavioral_posture"`
	CancelPendingHookIDs      []string                       `json:"cancel_pending_hook_ids"`
	NextHookIntent            json.RawMessage                `json:"next_hook_intent"`
	CanonicalMemoryCandidates []lifeTurnMemoryCandidateJSON  `json:"canonical_memory_candidates"`
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
	if s.chatExec == nil {
		return false
	}
	_, rejecting := s.chatExec.(rejectingChatTrackSidecarExecutor)
	return !rejecting
}

func (s *Service) SetChatTrackSidecarExecutor(executor ChatTrackSidecarExecutor) {
	if executor == nil {
		s.chatExec = rejectingChatTrackSidecarExecutor{}
		return
	}
	s.chatExec = executor
}

func (s *Service) ExecuteChatTrackSidecar(ctx context.Context, req ChatTrackSidecarExecutionRequest) error {
	entry, err := s.agentByID(strings.TrimSpace(req.AgentID))
	if err != nil {
		return err
	}
	if s.chatExec == nil {
		s.chatExec = rejectingChatTrackSidecarExecutor{}
	}
	result, err := s.chatExec.ExecuteChatTrackSidecar(ctx, &ChatTrackSidecarExecutorRequest{
		Agent:         cloneAgentRecord(entry.Agent),
		State:         cloneAgentState(entry.State),
		SourceEventID: strings.TrimSpace(req.SourceEventID),
		Messages:      cloneChatMessages(req.Messages),
		PendingHooks:  clonePendingHooksSorted(entry.Hooks),
	})
	if err != nil {
		return err
	}
	if result == nil {
		result = &ChatTrackSidecarResult{}
	}
	return s.ApplyChatTrackSidecar(ctx, entry.Agent.GetAgentId(), req.SourceEventID, *result)
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
			AppId:         chatTrackSidecarExecutorAppID,
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
Return exactly one JSON object and nothing else.
Allowed top-level fields:
- behavioral_posture: object or null
- cancel_pending_hook_ids: string[]
- next_hook_intent: object or null
- canonical_memory_candidates: array

Rules:
- Do not emit markdown, prose, code fences, or comments.
- Do not emit any field outside behavioral_posture, cancel_pending_hook_ids, next_hook_intent, and canonical_memory_candidates.
- Do not emit proactive initiate-chat semantics, arbitrary state mutation, direct world/user mutation, or free-form scheduling logic.
- current chat transcript is source evidence, not canonical memory truth by default.
- emit canonical_memory_candidates only when the current evidence window supports a stable durable memory proposal.
- absorb explicit same-window self-correction or contradiction before candidate emission; do not emit two conflicting durable candidates from one evidence window.
- if the evidence remains unstable, tentative, or situational, emit [] or prefer OBSERVATIONAL over SEMANTIC.
- behavioral_posture, if present, may only contain:
  - posture_class: string
  - action_family: observe | engage | support | assist | reflect | rest
  - interrupt_mode: welcome | cautious | focused
  - transition_reason: string
  - truth_basis_ids: array of truth ids
  - status_text: string
- cancel_pending_hook_ids may only reference hook ids present in pending_hooks.
- next_hook_intent must be valid NextHookIntent proto-json if present.
- next_hook_intent remains callback intent only; runtime host still owns cadence truth.
- next_hook_intent may set cadence_interaction only as:
  - NORMAL
  - SUPPRESS_BASE_TICK_UNTIL_FIRED
  - SUPPRESS_BASE_TICK_UNTIL_EXPIRED
- use suppress_base_tick_until_fired only when the follow-up hook itself represents the next meaningful wake-up for a sustained state.
- use suppress_base_tick_until_expired only for a sustained state with a clear suppression boundary, and always include expires_at when using it.
- do not invent cadence_interaction for ordinary short follow-ups, lightweight reminders, or generic "check back later" timing.
- examples that may justify suppression: sleep, meditation, focused deep work, long travel, or another explicitly continuous state.
- canonical_memory_candidates entries may only contain:
  - canonical_class: PUBLIC_SHARED | WORLD_SHARED | DYADIC
  - policy_reason: string
  - record: MemoryRecordInput proto-json using exactly one payload branch: episodic, semantic, or observational
- If no hooks should be canceled, return [].
- If no follow-up hook is needed, set next_hook_intent to null.
- If no canonical memory should be written, set canonical_memory_candidates to [].
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
	decoder := json.NewDecoder(bytes.NewBufferString(raw))
	decoder.DisallowUnknownFields()
	var payload chatTrackSidecarExecutorJSON
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("chat track sidecar executor output invalid: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("chat track sidecar executor output must contain a single JSON object")
		}
		return nil, fmt.Errorf("chat track sidecar executor output invalid: %w", err)
	}
	result := &ChatTrackSidecarResult{
		CancelPendingHookIDs:      append([]string(nil), payload.CancelPendingHookIDs...),
		CanonicalMemoryCandidates: make([]*runtimev1.CanonicalMemoryCandidate, 0, len(payload.CanonicalMemoryCandidates)),
	}
	if payload.BehavioralPosture != nil {
		patch := &BehavioralPosturePatch{
			PostureClass:     payload.BehavioralPosture.PostureClass,
			ActionFamily:     payload.BehavioralPosture.ActionFamily,
			InterruptMode:    payload.BehavioralPosture.InterruptMode,
			TransitionReason: payload.BehavioralPosture.TransitionReason,
			TruthBasisIDs:    append([]string(nil), payload.BehavioralPosture.TruthBasisIDs...),
			StatusText:       payload.BehavioralPosture.StatusText,
		}
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
	if len(payload.NextHookIntent) > 0 && string(payload.NextHookIntent) != "null" {
		intent := &runtimev1.NextHookIntent{}
		unmarshal := protojson.UnmarshalOptions{DiscardUnknown: false}
		if err := unmarshal.Unmarshal(payload.NextHookIntent, intent); err != nil {
			return nil, fmt.Errorf("chat track sidecar executor next_hook_intent invalid: %w", err)
		}
		if err := validateNextHookIntent(intent); err != nil {
			return nil, fmt.Errorf("chat track sidecar executor next_hook_intent invalid: %w", err)
		}
		result.NextHookIntent = intent
	}
	now := time.Now().UTC()
	for _, candidate := range payload.CanonicalMemoryCandidates {
		item, err := buildChatTrackCanonicalMemoryCandidate(req, &lifeTurnMemoryCandidate{
			CanonicalClass: candidate.CanonicalClass,
			PolicyReason:   strings.TrimSpace(candidate.PolicyReason),
			RecordRaw:      append([]byte(nil), candidate.Record...),
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
			return out[i].GetHookId() < out[j].GetHookId()
		}
		return left.Before(right)
	})
	return out
}
