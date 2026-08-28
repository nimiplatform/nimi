package runtimeagent

import (
	"context"
	"encoding/json"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/structpb"
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
	publicChatTurnReasoningStatusType        = "runtime.agent.turn.reasoning_status"
	publicChatTurnStructuredType             = "runtime.agent.turn.structured"
	publicChatTurnMessageCommittedType       = "runtime.agent.turn.message_committed"
	publicChatTurnActionPlannedType          = "runtime.agent.turn.action_planned"
	publicChatTurnActionStartedType          = "runtime.agent.turn.action_started"
	publicChatTurnArtifactReadyType          = "runtime.agent.turn.artifact_ready"
	publicChatTurnActionCompletedType        = "runtime.agent.turn.action_completed"
	publicChatTurnActionFailedType           = "runtime.agent.turn.action_failed"
	publicChatTurnLiveActionType             = "runtime.agent.turn.live_action"
	publicChatTurnLiveToolType               = "runtime.agent.turn.live_tool"
	publicChatTurnPostTurnType               = "runtime.agent.turn.post_turn"
	publicChatTurnCompletedType              = "runtime.agent.turn.completed"
	publicChatTurnFailedType                 = "runtime.agent.turn.failed"
	publicChatTurnInterruptedType            = "runtime.agent.turn.interrupted"
	publicChatTurnInterruptAckType           = "runtime.agent.turn.interrupt_ack"
	publicChatTurnVoiceRenderType            = "runtime.agent.turn.voice_render"
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
	BindingAlias        string
	ModelID             string
	RoutePolicy         runtimev1.RoutePolicy
	ConnectorID         string
	TargetRef           *runtimeidentity.Target
	ExecutionIntent     executionintent.Intent                 `json:"-"`
	LocalExecution      *localexecution.SelectedLocalExecution `json:"-"`
	SelectedParams      *structpb.Struct
	CapabilityContract  string
	RequiredFeatures    []string
	LocalAIConfigIntent bool
	ContextWindowTokens uint64
	CatalogRevision     string
	ModelRevision       string
	ProviderID          string
	RouteDigest         string
}
type publicChatExecutionBindings map[string]publicChatExecutionBinding
type publicChatReasoningConfig struct {
	Mode         runtimev1.ReasoningMode
	TraceMode    runtimev1.ReasoningTraceMode
	BudgetTokens int32
}

// publicChatImageActionAvailability is the K-AGCORE-148 tri-state derived at
// turn admission from committed Runtime Agent AI Config presence plus the
// current readiness projection. Values match
// tables/runtime-agent-ai-config.yaml turn_action_availability_states.
type publicChatImageActionAvailability string

const (
	publicChatImageActionAvailable     publicChatImageActionAvailability = "available"
	publicChatImageActionNotConfigured publicChatImageActionAvailability = "not_configured"
	publicChatImageActionUnavailable   publicChatImageActionAvailability = "unavailable"
)

type publicChatAvailableActions struct {
	ImageGenerate publicChatImageActionAvailability
}

// publicChatCommittedTranscriptTurn is the single Runtime-owned conversation
// history record for a ConversationAnchor. User turns and Runtime-admitted
// follow-up turns share this one ordered transcript; app-facing ChatMessage
// history is derived from user-origin records and is never stored separately.
type publicChatCommittedTranscriptTurn struct {
	TurnID        string `json:"turnId"`
	Sequence      uint64 `json:"sequence"`
	Origin        string `json:"origin"`
	InputText     string `json:"inputText"`
	AssistantText string `json:"assistantText"`
	// InputAttachment carries the Runtime-validated user attachment of this
	// turn (artifact reference + store-trusted mime). Nil for text-only turns.
	InputAttachment *publicChatCommittedTranscriptAttachment `json:"inputAttachment,omitempty"`
	// OutputArtifacts carries Runtime-produced assistant media references after
	// the action result has been validated against the Runtime artifact store.
	// Artifact bytes remain owned exclusively by that store.
	OutputArtifacts []publicChatCommittedTranscriptAttachment `json:"outputArtifacts,omitempty"`
}

// publicChatCommittedTranscriptAttachment is the durable user-attachment
// truth of a committed turn (rule.nimi.runtime.agent-participation.r173).
// MimeType is the artifact store record mime, never a caller-declared value.
type publicChatCommittedTranscriptAttachment struct {
	ArtifactID  string `json:"artifactId"`
	MimeType    string `json:"mimeType"`
	DisplayName string `json:"displayName,omitempty"`
}

type publicChatVoiceSidecarState struct {
	VoiceID    string               `json:"voiceId"`
	TurnID     string               `json:"turnId"`
	MessageID  string               `json:"messageId"`
	State      string               `json:"state"`
	ArtifactID string               `json:"artifactId,omitempty"`
	ReasonCode runtimev1.ReasonCode `json:"reasonCode,omitempty"`
	Message    string               `json:"message,omitempty"`
}

type avatarLiveInstanceBindingState struct {
	AvatarInstanceID     string
	ConversationAnchorID string
	AgentID              string
	LocalAgentRef        string
	OwnerUserID          string
	RuntimeSourceRef     string
	CallerAppID          string
	SubjectUserID        string
	RegisteredAt         time.Time
	UpdatedAt            time.Time
}

// publicChatAnchorState is the Runtime-owned continuity state for a
// LocalAgent's single conversation. ConversationAnchorID is its issued
// continuity token; OwnerUserID plus LocalAgentRef resolves the singleton.
// SubjectUserID is captured at first open and must equal OwnerUserID.
type publicChatAnchorState struct {
	ConversationAnchorID string
	AgentID              string
	LocalAgentRef        string
	OwnerUserID          string
	RuntimeSourceRef     string
	CallerAppID          string
	RegisteredAppSubject string
	SubjectUserID        string
	ThreadID             string
	Binding              publicChatExecutionBinding
	Bindings             publicChatExecutionBindings
	// ConfigRevision is the committed Runtime Agent AI Config revision fixed into
	// the anchor at the most recent turn admission (K-AGCORE-147). It is
	// per-turn admission truth projected on the session snapshot; the anchor
	// does not own binding truth.
	ConfigRevision         uint64
	ActiveTurnID           string
	MaxTokens              int32
	Reasoning              *publicChatReasoningConfig
	CommittedTranscript    []publicChatCommittedTranscriptTurn
	ConversationSummary    *publicChatConversationSummaryState
	ActiveTurnSnapshot     *publicChatTurnProjectionState
	LastTurnSnapshot       *publicChatTurnProjectionState
	CompletedTurnSnapshots map[string]*publicChatTurnProjectionState
	VoiceSidecars          map[string]*publicChatVoiceSidecarState
	PendingFollowUpID      string
	Status                 runtimev1.ConversationAnchorStatus
	LastTurnID             string
	LastMessageID          string
	// LocalAppSequence is the protected Conversation projection high-water.
	// It advances for every source event before protected filtering and is
	// persisted with the Runtime-owned Conversation anchor.
	LocalAppSequence uint64
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type publicChatConversationSummaryState struct {
	LastValid   *publicChatConversationSummaryValidState  `json:"lastValid,omitempty"`
	LastAttempt publicChatConversationSummaryAttemptState `json:"lastAttempt"`
}

// publicChatConversationSummaryValidState is the last summary payload that
// passed both structure and continuous-sequence validation. A later failed or
// unavailable attempt never overwrites it.
type publicChatConversationSummaryValidState struct {
	Revision             uint64    `json:"revision"`
	CoveredSequenceStart uint64    `json:"coveredSequenceStart"`
	CoveredSequenceEnd   uint64    `json:"coveredSequenceEnd"`
	Text                 string    `json:"text"`
	GeneratedAt          time.Time `json:"generatedAt"`
	RouteCorrelation     string    `json:"routeCorrelation"`
}

// publicChatConversationSummaryAttemptState is bounded diagnostic truth. It
// deliberately excludes provider text and raw errors.
type publicChatConversationSummaryAttemptState struct {
	Status            string    `json:"status"`
	TargetSequenceEnd uint64    `json:"targetSequenceEnd"`
	AttemptedAt       time.Time `json:"attemptedAt"`
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
	// ConfigRevision and AvailableActions are fixed at turn admission from
	// the committed Runtime Agent AI Config plus readiness (K-AGCORE-147/148).
	// A config mutation during an in-flight turn affects the next turn only.
	ConfigRevision   uint64
	AvailableActions publicChatAvailableActions
	// Reasoning is the single effective config captured at turn admission.
	// Provider rounds and capacity planning never reread mutable anchor state.
	Reasoning *publicChatReasoningConfig
	// BindingRelease holds the once-safe outer local-model lease acquired while
	// resolving live execution capacity. Reservation release owns invoking it.
	BindingRelease func()
	Projection     *publicChatTurnProjectionState
	// TerminalProjection is staged separately from the app-facing active turn.
	// A committed message may still be running independent post-turn work, so a
	// terminal snapshot must not become observable until the reservation is
	// released at the completed/failed/interrupted delivery boundary.
	TerminalProjection *publicChatTurnProjectionState
}
type publicChatMessagePayload struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Name    string `json:"name,omitempty"`
	// Attachments carries at most one Runtime artifact reference uploaded
	// through RuntimeArtifactService.PutArtifact
	// (rule.nimi.runtime.agent-participation.r172). Bytes and mime truth never
	// travel on the request; only the artifact id plus an optional display
	// hint are admitted.
	Attachments []publicChatAttachmentPayload `json:"attachments,omitempty"`
}

// publicChatAttachmentPayload is the caller-carried attachment reference on a
// turn request. ArtifactID is a selector only; ownership, existence, and the
// trusted mime are revalidated by Runtime at turn admission.
type publicChatAttachmentPayload struct {
	ArtifactID  string `json:"artifact_id"`
	DisplayName string `json:"display_name,omitempty"`
}

// publicChatResolvedAttachment is the Runtime-validated attachment truth
// fixed at turn admission: the artifact store record mime is the only trusted
// mime, and the caller display hint is carried separately.
type publicChatResolvedAttachment struct {
	ArtifactID  string
	MimeType    string
	DisplayName string
}
type publicChatExecutionBindingPayload struct {
	Route       string          `json:"route"`
	ModelID     string          `json:"model_id"`
	ConnectorID string          `json:"connector_id,omitempty"`
	TargetRef   json.RawMessage `json:"target_ref,omitempty"`
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
	RuntimeSourceRef     string                                       `json:"runtime_source_ref"`
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
	// resolvedAttachments is Runtime-internal admission truth, never caller
	// JSON: store-validated attachment references fixed at turn admission.
	resolvedAttachments []publicChatResolvedAttachment
}
type publicChatTurnInterruptPayload struct {
	ConversationAnchorID string `json:"conversation_anchor_id"`
	TurnID               string `json:"turn_id,omitempty"`
	Reason               string `json:"reason,omitempty"`
}
type publicChatTurnVoiceRenderPayload struct {
	ConversationAnchorID string `json:"conversation_anchor_id"`
	TurnID               string `json:"turn_id"`
	MessageID            string `json:"message_id"`
	Text                 string `json:"text,omitempty"`
	PlaybackTarget       string `json:"playback_target,omitempty"`
}
type PublicChatTurnExecutionRequest struct {
	AppID            string
	SubjectUserID    string
	Messages         []*runtimev1.ChatMessage
	SystemPrompt     string
	MaxTokens        int32
	Binding          publicChatExecutionBinding
	AvailableActions publicChatAvailableActions
	Reasoning        *publicChatReasoningConfig
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
type publicChatSidecarOutcome struct {
	Status          string
	CanceledHookIDs []string
	ScheduledHookID string
	StatusText      string
	ReasonCode      runtimev1.ReasonCode
	Message         string
}
type publicChatPostTurnOutcome struct {
	Sidecar  publicChatSidecarOutcome
	FollowUp publicChatFollowUpOutcome
}
type ChatTrackSidecarApplySummary struct {
	CanceledHookIDs []string
	ScheduledHookID string
	StatusText      string
}
