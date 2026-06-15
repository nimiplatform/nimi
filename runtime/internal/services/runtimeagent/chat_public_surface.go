package runtimeagent

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"time"
)

// K-AGCORE-032 reactive chat consume seam constants.
// Primary carrier names are the mounted runtime.agent.turn.* /
// runtime.agent.session.* families only. The retired agent.chat.*.v1 names
// are not admitted anywhere in the primary runtime path; no parallel runtime
// event family is minted under the reserved runtime.agent app target by this
// exec pack. Follow-up cancellation remains internal runtime bookkeeping and
// surfaces only through the unary public chat session snapshot
// (`last_turn.follow_up.status`). No stealth
// `runtime.agent.follow_up.*` public family is emitted.
const (
	publicChatRuntimeAppID                   = "runtime.agent"
	publicChatTurnRequestType                = "runtime.agent.turn.request"
	publicChatTurnInterruptType              = "runtime.agent.turn.interrupt"
	publicChatTurnAcceptedType               = "runtime.agent.turn.accepted"
	publicChatTurnStartedType                = "runtime.agent.turn.started"
	publicChatTurnTextDeltaType              = "runtime.agent.turn.text_delta"
	publicChatTurnReasoningDeltaType         = "runtime.agent.turn.reasoning_delta"
	publicChatTurnStructuredType             = "runtime.agent.turn.structured"
	publicChatTurnMessageCommittedType       = "runtime.agent.turn.message_committed"
	publicChatTurnActionPlannedType          = "runtime.agent.turn.action_planned"
	publicChatTurnActionStartedType          = "runtime.agent.turn.action_started"
	publicChatTurnArtifactReadyType          = "runtime.agent.turn.artifact_ready"
	publicChatTurnActionCompletedType        = "runtime.agent.turn.action_completed"
	publicChatTurnActionFailedType           = "runtime.agent.turn.action_failed"
	publicChatTurnPostTurnType               = "runtime.agent.turn.post_turn"
	publicChatTurnCompletedType              = "runtime.agent.turn.completed"
	publicChatTurnFailedType                 = "runtime.agent.turn.failed"
	publicChatTurnInterruptedType            = "runtime.agent.turn.interrupted"
	publicChatTurnInterruptAckType           = "runtime.agent.turn.interrupt_ack"
	publicChatAssistantMemorySource          = "runtime.agent.chat"
	publicChatAssistantMemoryPolicy          = "runtime_agent_chat_assistant_turn"
	publicChatDefaultTurnTimeoutMs     int32 = 120_000
	publicChatMaxFollowUpTurns               = 8
)
const PublicChatRuntimeAppID = publicChatRuntimeAppID
const (
	publicChatTurnOriginUser     = "user"
	publicChatTurnOriginFollowUp = "follow_up"
)

// publicChatTurnTrackLabel pins the `runtime.agent.turn.started.detail.track`
// value for the public chat reactive surface to the chat track per yaml
// `turn.started.detail.track: enum(chat|life)`. The life track surface
// emits its own `runtime.agent.turn.started` with `track="life"`.
const publicChatTurnTrackLabel = "chat"

type publicChatAppMessageEmitter func(context.Context, *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error)
type publicChatExecutionBinding struct {
	ModelID     string
	RoutePolicy runtimev1.RoutePolicy
	ConnectorID string
}
type publicChatExecutionBindings map[string]publicChatExecutionBinding
type publicChatReasoningConfig struct {
	Mode         runtimev1.ReasoningMode
	TraceMode    runtimev1.ReasoningTraceMode
	BudgetTokens int32
}

type avatarLiveInstanceBindingState struct {
	AvatarInstanceID     string
	ConversationAnchorID string
	AgentID              string
	LocalAgentRef        string
	OwnerUserID          string
	RealmAgentID         string
	CallerAppID          string
	SubjectUserID        string
	RegisteredAt         time.Time
	UpdatedAt            time.Time
}

// publicChatAnchorState is the runtime-owned ConversationAnchor continuity
// state per K-AGCORE-034. It is keyed by `conversation_anchor_id` only;
// `agent_id` is agent identity scope, not continuity scope.
// `subject_user_id` is captured at anchor-open time and is runtime truth.
// ActiveTurn / LastTurn remain anchor-scoped per K-AGCORE-035.
type publicChatAnchorState struct {
	ConversationAnchorID string
	AgentID              string
	LocalAgentRef        string
	OwnerUserID          string
	RealmAgentID         string
	CallerAppID          string
	SubjectUserID        string
	ThreadID             string
	Binding              publicChatExecutionBinding
	Bindings             publicChatExecutionBindings
	ExecutionParams      map[string]map[string]any
	ActiveTurnID         string
	SystemPrompt         string
	MaxTokens            int32
	Reasoning            *publicChatReasoningConfig
	Transcript           []*runtimev1.ChatMessage
	ActiveTurnSnapshot   *publicChatTurnProjectionState
	LastTurnSnapshot     *publicChatTurnProjectionState
	PendingFollowUpID    string
	Status               runtimev1.ConversationAnchorStatus
	LastTurnID           string
	LastMessageID        string
	CreatedAt            time.Time
	UpdatedAt            time.Time
}
type publicChatTurnState struct {
	ConversationAnchorID string
	TurnID               string
	// StreamID identifies the owned foreground presentation/turn stream per
	// K-AGCORE-030. One turn may own multiple stream units; this field is
	// the primary admitted foreground stream for the reactive chat path and
	// is allocated distinctly from `turn_id` so consumers can distinguish
	// turn identity from stream identity without fabrication.
	StreamID string
	// RequestID identifies the upstream `runtime.agent.turn.request` (or the
	// internal follow-up) that opened this turn. It surfaces only on
	// `runtime.agent.turn.accepted.detail.request_id` per yaml
	// `accepted.detail.request_id`; runtime carrier execution truth (trace
	// id, model resolved, etc.) does not live on turn projection events.
	RequestID         string
	AgentID           string
	CallerAppID       string
	SubjectUserID     string
	ThreadID          string
	Cancel            context.CancelFunc
	Interrupted       bool
	InterruptReason   string
	LastKnownTraceID  string
	StreamSequence    uint64
	TimelineStartedAt time.Time
	Origin            string
	ChainID           string
	FollowUpDepth     int
	MaxFollowUpTurns  int
	SourceTurnID      string
	SourceActionID    string
	Projection        *publicChatTurnProjectionState
}
type publicChatMessagePayload struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Name    string `json:"name,omitempty"`
}
type publicChatExecutionBindingPayload struct {
	Route       string `json:"route"`
	ModelID     string `json:"model_id"`
	ConnectorID string `json:"connector_id,omitempty"`
}
type publicChatReasoningPayload struct {
	Mode         string `json:"mode,omitempty"`
	TraceMode    string `json:"trace_mode,omitempty"`
	BudgetTokens int32  `json:"budget_tokens,omitempty"`
}

// publicChatTurnRequestPayload is the mounted `runtime.agent.turn.request`
// ingress payload per K-AGCORE-032 / K-AGCORE-034. `conversation_anchor_id`
// is required; hosts must obtain it through `OpenConversationAnchor` or
// `GetConversationAnchorSnapshot` before turn request. Runtime rejects
// requests that reference a non-existent anchor (no implicit creation).
type publicChatTurnRequestPayload struct {
	AgentID              string                                       `json:"agent_id"`
	LocalAgentRef        string                                       `json:"local_agent_ref"`
	OwnerUserID          string                                       `json:"owner_user_id"`
	RealmAgentID         string                                       `json:"realm_agent_id"`
	ConversationAnchorID string                                       `json:"conversation_anchor_id"`
	RequestID            string                                       `json:"request_id,omitempty"`
	ThreadID             string                                       `json:"thread_id,omitempty"`
	SystemPrompt         string                                       `json:"system_prompt,omitempty"`
	WorldID              string                                       `json:"world_id,omitempty"`
	MaxOutputTokens      int32                                        `json:"max_output_tokens,omitempty"`
	Messages             []publicChatMessagePayload                   `json:"messages"`
	ExecutionBindings    map[string]publicChatExecutionBindingPayload `json:"execution_bindings,omitempty"`
	ExecutionParams      map[string]map[string]any                    `json:"execution_params,omitempty"`
	Reasoning            *publicChatReasoningPayload                  `json:"reasoning,omitempty"`
}
type publicChatTurnInterruptPayload struct {
	ConversationAnchorID string `json:"conversation_anchor_id"`
	TurnID               string `json:"turn_id,omitempty"`
	Reason               string `json:"reason,omitempty"`
}
type PublicChatTurnExecutionRequest struct {
	AppID         string
	SubjectUserID string
	Messages      []*runtimev1.ChatMessage
	SystemPrompt  string
	MaxTokens     int32
	Binding       publicChatExecutionBinding
	Reasoning     *publicChatReasoningConfig
}
type PublicChatTurnExecutor interface {
	StreamChatTurn(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error
}
type rejectingPublicChatTurnExecutor struct{}
type publicChatScenarioStreamer interface {
	StreamScenario(*runtimev1.StreamScenarioRequest, grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) error
}
type aiBackedPublicChatTurnExecutor struct {
	ai publicChatScenarioStreamer
}
type publicChatScenarioStreamServer struct {
	ctx  context.Context
	send func(*runtimev1.StreamScenarioEvent) error
}
type publicChatAssistantMemoryOutcome struct {
	Status        string
	AcceptedCount int
	RejectedCount int
	ReasonCode    runtimev1.ReasonCode
	Message       string
}
type publicChatSidecarOutcome struct {
	Status              string
	AcceptedMemoryCount int
	CanceledHookIDs     []string
	ScheduledHookID     string
	StatusText          string
	ReasonCode          runtimev1.ReasonCode
	Message             string
}
type publicChatPostTurnOutcome struct {
	AssistantMemory publicChatAssistantMemoryOutcome
	Sidecar         publicChatSidecarOutcome
	FollowUp        publicChatFollowUpOutcome
}
type ChatTrackSidecarApplySummary struct {
	AcceptedMemoryCount int
	CanceledHookIDs     []string
	ScheduledHookID     string
	StatusText          string
}
