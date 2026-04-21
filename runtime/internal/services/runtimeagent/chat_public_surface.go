package runtimeagent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const (
	publicChatRuntimeAppID                     = "runtime.agent"
	publicChatTurnRequestType                  = "agent.chat.turn.request.v1"
	publicChatTurnInterruptType                = "agent.chat.turn.interrupt.v1"
	publicChatSessionSnapshotRequestType       = "agent.chat.session.snapshot.request.v1"
	publicChatTurnAcceptedType                 = "agent.chat.turn.accepted.v1"
	publicChatTurnStartedType                  = "agent.chat.turn.started.v1"
	publicChatTurnTextDeltaType                = "agent.chat.turn.text_delta.v1"
	publicChatTurnReasoningDeltaType           = "agent.chat.turn.reasoning_delta.v1"
	publicChatTurnStructuredType               = "agent.chat.turn.structured.v1"
	publicChatTurnPostTurnType                 = "agent.chat.turn.post_turn.v1"
	publicChatTurnCompletedType                = "agent.chat.turn.completed.v1"
	publicChatTurnFailedType                   = "agent.chat.turn.failed.v1"
	publicChatTurnInterruptedType              = "agent.chat.turn.interrupted.v1"
	publicChatTurnInterruptAckType             = "agent.chat.turn.interrupt_ack.v1"
	publicChatSessionSnapshotType              = "agent.chat.session.snapshot.v1"
	publicChatFollowUpCanceledType             = "agent.chat.follow_up.canceled.v1"
	publicChatAssistantMemorySource            = "runtime.agent.chat"
	publicChatAssistantMemoryPolicy            = "runtime_agent_chat_assistant_turn"
	publicChatDefaultTurnTimeoutMs       int32 = 120_000
	publicChatMaxFollowUpTurns                 = 8
)

const PublicChatRuntimeAppID = publicChatRuntimeAppID

const (
	publicChatTurnOriginUser     = "user"
	publicChatTurnOriginFollowUp = "follow_up"
)

type publicChatAppMessageEmitter func(context.Context, *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error)

type publicChatExecutionBinding struct {
	ModelID     string
	RoutePolicy runtimev1.RoutePolicy
	ConnectorID string
}

type publicChatReasoningConfig struct {
	Mode         runtimev1.ReasoningMode
	TraceMode    runtimev1.ReasoningTraceMode
	BudgetTokens int32
}

type publicChatSessionState struct {
	SessionID          string
	AgentID            string
	CallerAppID        string
	SubjectUserID      string
	ThreadID           string
	Binding            publicChatExecutionBinding
	ActiveTurnID       string
	SystemPrompt       string
	MaxTokens          int32
	Reasoning          *publicChatReasoningConfig
	Transcript         []*runtimev1.ChatMessage
	ActiveTurnSnapshot *publicChatTurnProjectionState
	LastTurnSnapshot   *publicChatTurnProjectionState
	PendingFollowUpID  string
}

type publicChatTurnState struct {
	SessionID        string
	TurnID           string
	AgentID          string
	CallerAppID      string
	SubjectUserID    string
	ThreadID         string
	Cancel           context.CancelFunc
	Interrupted      bool
	InterruptReason  string
	LastKnownTraceID string
	StreamSequence   uint64
	Origin           string
	ChainID          string
	FollowUpDepth    int
	MaxFollowUpTurns int
	SourceTurnID     string
	SourceActionID   string
	Projection       *publicChatTurnProjectionState
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

type publicChatTurnRequestPayload struct {
	AgentID          string                             `json:"agent_id"`
	SessionID        string                             `json:"session_id,omitempty"`
	ThreadID         string                             `json:"thread_id,omitempty"`
	SystemPrompt     string                             `json:"system_prompt,omitempty"`
	WorldID          string                             `json:"world_id,omitempty"`
	MaxOutputTokens  int32                              `json:"max_output_tokens,omitempty"`
	Messages         []publicChatMessagePayload         `json:"messages"`
	ExecutionBinding *publicChatExecutionBindingPayload `json:"execution_binding,omitempty"`
	Reasoning        *publicChatReasoningPayload        `json:"reasoning,omitempty"`
}

type publicChatTurnInterruptPayload struct {
	SessionID string `json:"session_id"`
	TurnID    string `json:"turn_id,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

type publicChatSessionSnapshotRequestPayload struct {
	SessionID string `json:"session_id"`
	RequestID string `json:"request_id,omitempty"`
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

func (rejectingPublicChatTurnExecutor) StreamChatTurn(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error {
	return fmt.Errorf("runtime public chat turn executor unavailable or not admitted")
}

func IsPublicChatIngressMessageType(messageType string) bool {
	switch strings.TrimSpace(messageType) {
	case publicChatTurnRequestType, publicChatTurnInterruptType, publicChatSessionSnapshotRequestType:
		return true
	default:
		return false
	}
}

func NewAIBackedPublicChatTurnExecutor(ai publicChatScenarioStreamer) PublicChatTurnExecutor {
	if ai == nil {
		return rejectingPublicChatTurnExecutor{}
	}
	return &aiBackedPublicChatTurnExecutor{ai: ai}
}

func (s *publicChatScenarioStreamServer) SetHeader(metadata.MD) error { return nil }

func (s *publicChatScenarioStreamServer) SendHeader(metadata.MD) error { return nil }

func (s *publicChatScenarioStreamServer) SetTrailer(metadata.MD) {}

func (s *publicChatScenarioStreamServer) Context() context.Context {
	if s == nil || s.ctx == nil {
		return context.Background()
	}
	return s.ctx
}

func (s *publicChatScenarioStreamServer) SendMsg(message any) error {
	event, ok := message.(*runtimev1.StreamScenarioEvent)
	if !ok {
		return status.Error(codes.Internal, "public chat scenario stream message type invalid")
	}
	return s.Send(event)
}

func (s *publicChatScenarioStreamServer) RecvMsg(any) error {
	return io.EOF
}

func (s *publicChatScenarioStreamServer) Send(event *runtimev1.StreamScenarioEvent) error {
	if s == nil || s.send == nil || event == nil {
		return nil
	}
	return s.send(proto.Clone(event).(*runtimev1.StreamScenarioEvent))
}

func (e *aiBackedPublicChatTurnExecutor) StreamChatTurn(
	ctx context.Context,
	req *PublicChatTurnExecutionRequest,
	emit func(*runtimev1.StreamScenarioEvent) error,
) error {
	if e == nil || e.ai == nil {
		return fmt.Errorf("runtime public chat turn executor unavailable or not admitted")
	}
	if req == nil {
		return status.Error(codes.InvalidArgument, "public chat turn request is required")
	}
	streamReq := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         firstNonEmpty(strings.TrimSpace(req.AppID), publicChatRuntimeAppID),
			SubjectUserId: strings.TrimSpace(req.SubjectUserID),
			ModelId:       strings.TrimSpace(req.Binding.ModelID),
			RoutePolicy:   req.Binding.RoutePolicy,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     publicChatDefaultTurnTimeoutMs,
			ConnectorId:   strings.TrimSpace(req.Binding.ConnectorID),
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input:        cloneChatMessages(req.Messages),
					SystemPrompt: strings.TrimSpace(req.SystemPrompt),
					MaxTokens:    req.MaxTokens,
					Reasoning:    toProtoReasoningConfig(req.Reasoning),
				},
			},
		},
	}
	return e.ai.StreamScenario(streamReq, &publicChatScenarioStreamServer{
		ctx: ctx,
		send: func(event *runtimev1.StreamScenarioEvent) error {
			if emit == nil {
				return nil
			}
			return emit(event)
		},
	})
}

func (s *Service) SetPublicChatTurnExecutor(executor PublicChatTurnExecutor) {
	if s == nil || s.isClosed() {
		return
	}
	s.setPublicChatTurnExecutor(executor)
	s.resumeRecoveredPublicChatFollowUps()
}

func (s *Service) HasPublicChatTurnExecutor() bool {
	if s == nil || s.isClosed() {
		return false
	}
	_, rejecting := s.currentPublicChatTurnExecutor().(rejectingPublicChatTurnExecutor)
	return !rejecting
}

func (s *Service) SetPublicChatAppEmitter(emitter publicChatAppMessageEmitter) {
	if s == nil || s.isClosed() {
		return
	}
	s.chatAppEmit = emitter
	if emitter != nil {
		s.resumeRecoveredPublicChatFollowUps()
	}
}

func (s *Service) ConsumePublicChatAppMessage(ctx context.Context, event *runtimev1.AppMessageEvent) error {
	return s.publicChatRuntime().consumeAppMessage(ctx, event)
}

func (s *Service) handlePublicChatTurnRequest(
	ctx context.Context,
	event *runtimev1.AppMessageEvent,
	req publicChatTurnRequestPayload,
) error {
	return s.publicChatRuntime().handleTurnRequest(ctx, event, req)
}

func (s *Service) handlePublicChatTurnInterrupt(
	event *runtimev1.AppMessageEvent,
	req publicChatTurnInterruptPayload,
) error {
	return s.publicChatRuntime().handleTurnInterrupt(event, req)
}

func (s *Service) handlePublicChatSessionSnapshotRequest(
	event *runtimev1.AppMessageEvent,
	req publicChatSessionSnapshotRequestPayload,
) error {
	return s.publicChatRuntime().handleSessionSnapshotRequest(event, req)
}

func (s *Service) runPublicChatTurn(
	ctx context.Context,
	session publicChatSessionState,
	turn publicChatTurnState,
	req publicChatTurnRequestPayload,
) {
	s.publicChatRuntime().runTurn(ctx, session, turn, req)
}

func (s *Service) reservePublicChatTurn(
	parent context.Context,
	callerAppID string,
	subjectUserID string,
	req publicChatTurnRequestPayload,
) (publicChatSessionState, publicChatTurnState, context.Context, error) {
	return s.publicChatRuntime().reserveTurn(parent, callerAppID, subjectUserID, req)
}

func (s *Service) releasePublicChatTurn(sessionID string, turnID string) {
	s.publicChatRuntime().releaseTurn(sessionID, turnID)
}

func (s *Service) lookupPublicChatTurnForInterrupt(
	callerAppID string,
	req publicChatTurnInterruptPayload,
) (publicChatSessionState, publicChatTurnState, error) {
	return s.publicChatRuntime().lookupTurnForInterrupt(callerAppID, req)
}

func (s *Service) publicChatInterruptStatus(turnID string) (bool, string, string) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	turn := s.chatTurns[strings.TrimSpace(turnID)]
	if turn == nil {
		return false, "", ""
	}
	return turn.Interrupted, turn.InterruptReason, turn.LastKnownTraceID
}

func (s *Service) nextPublicChatStreamSequence(turnID string) uint64 {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	turn := s.chatTurns[strings.TrimSpace(turnID)]
	if turn == nil {
		return 0
	}
	turn.StreamSequence++
	if turn.Projection != nil {
		turn.Projection.StreamSequence = turn.StreamSequence
		if session := s.chatSessions[turn.SessionID]; session != nil && session.ActiveTurnSnapshot != nil {
			session.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(turn.Projection)
		}
	}
	return turn.StreamSequence
}

func (s *Service) recordPublicChatTraceID(turnID string, traceID string) {
	if strings.TrimSpace(turnID) == "" || strings.TrimSpace(traceID) == "" {
		return
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	if turn := s.chatTurns[strings.TrimSpace(turnID)]; turn != nil {
		turn.LastKnownTraceID = strings.TrimSpace(traceID)
		if turn.Projection != nil {
			turn.Projection.TraceID = strings.TrimSpace(traceID)
			turn.Projection.UpdatedAt = time.Now().UTC()
			if session := s.chatSessions[turn.SessionID]; session != nil {
				session.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(turn.Projection)
			}
		}
	}
}

func (s *Service) setPublicChatExecutionState(
	agentID string,
	subjectUserID string,
	worldID string,
	state runtimev1.AgentExecutionState,
) error {
	return s.publicChatRuntime().setExecutionState(agentID, subjectUserID, worldID, state)
}

func (s *Service) emitPublicChatTurnInterrupted(
	session publicChatSessionState,
	turn publicChatTurnState,
	traceID string,
	modelResolved string,
	routeDecision runtimev1.RoutePolicy,
	reason string,
) {
	s.publicChatRuntime().emitTurnInterrupted(session, turn, traceID, modelResolved, routeDecision, reason)
}

func (s *Service) emitPublicChatTurnFailed(
	session publicChatSessionState,
	turn publicChatTurnState,
	traceID string,
	modelResolved string,
	routeDecision runtimev1.RoutePolicy,
	reasonCode runtimev1.ReasonCode,
	message string,
	actionHint string,
) {
	s.publicChatRuntime().emitTurnFailed(session, turn, traceID, modelResolved, routeDecision, reasonCode, message, actionHint)
}

func (s *Service) emitPublicChatTurnEvent(
	session publicChatSessionState,
	turnID string,
	messageType string,
	payload map[string]any,
) error {
	return s.publicChatRuntime().emitTurnEvent(session, turnID, messageType, payload)
}

func (s *Service) emitPublicChatEvent(
	callerAppID string,
	subjectUserID string,
	messageType string,
	payload map[string]any,
) error {
	return s.publicChatRuntime().emitEvent(callerAppID, subjectUserID, messageType, payload)
}

func (s *Service) shutdownPublicChatSurface() {
	s.publicChatRuntime().shutdownSurface()
}

func (s *Service) applyPublicChatPostTurn(
	ctx context.Context,
	session publicChatSessionState,
	turn publicChatTurnState,
	req publicChatTurnRequestPayload,
	structured *publicChatStructuredEnvelope,
) publicChatPostTurnOutcome {
	return s.publicChatRuntime().applyPostTurn(ctx, session, turn, req, structured)
}

func (s *Service) applyPublicChatAssistantTurnMemory(
	ctx context.Context,
	session publicChatSessionState,
	turn publicChatTurnState,
	assistantText string,
) publicChatAssistantMemoryOutcome {
	return s.publicChatRuntime().applyAssistantTurnMemory(ctx, session, turn, assistantText)
}

func normalizePublicChatReasoning(input *publicChatReasoningPayload) *publicChatReasoningConfig {
	if input == nil {
		return nil
	}
	mode := parsePublicChatReasoningMode(input.Mode)
	traceMode := parsePublicChatReasoningTraceMode(input.TraceMode)
	if mode == runtimev1.ReasoningMode_REASONING_MODE_UNSPECIFIED &&
		traceMode == runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_UNSPECIFIED &&
		input.BudgetTokens <= 0 {
		return nil
	}
	return &publicChatReasoningConfig{
		Mode:         mode,
		TraceMode:    traceMode,
		BudgetTokens: input.BudgetTokens,
	}
}

func toProtoReasoningConfig(input *publicChatReasoningConfig) *runtimev1.ReasoningConfig {
	if input == nil {
		return nil
	}
	return &runtimev1.ReasoningConfig{
		Mode:         input.Mode,
		TraceMode:    input.TraceMode,
		BudgetTokens: input.BudgetTokens,
	}
}

func toProtoPublicChatMessages(input []publicChatMessagePayload) []*runtimev1.ChatMessage {
	out := make([]*runtimev1.ChatMessage, 0, len(input))
	for _, item := range input {
		role := strings.TrimSpace(item.Role)
		content := strings.TrimSpace(item.Content)
		if role == "" || content == "" {
			continue
		}
		out = append(out, &runtimev1.ChatMessage{
			Role:    role,
			Content: content,
			Name:    strings.TrimSpace(item.Name),
		})
	}
	return out
}

func decodePublicChatTurnRequestPayload(payload any) (publicChatTurnRequestPayload, error) {
	raw, err := decodePublicChatStructPayload(payload)
	if err != nil {
		return publicChatTurnRequestPayload{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var decoded publicChatTurnRequestPayload
	if err := decoder.Decode(&decoded); err != nil {
		return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat turn payload invalid")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat turn payload must contain one object")
		}
		return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat turn payload invalid")
	}
	if strings.TrimSpace(decoded.AgentID) == "" || len(toProtoPublicChatMessages(decoded.Messages)) == 0 {
		return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat turn payload requires agent_id and messages")
	}
	if decoded.MaxOutputTokens < 0 {
		return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat max_output_tokens must be non-negative")
	}
	if decoded.ExecutionBinding != nil {
		if strings.TrimSpace(decoded.ExecutionBinding.ModelID) == "" {
			return publicChatTurnRequestPayload{}, status.Error(codes.InvalidArgument, "public chat execution_binding.model_id is required")
		}
		if _, err := parseOptionalPublicChatRoutePolicy(decoded.ExecutionBinding.Route); err != nil {
			return publicChatTurnRequestPayload{}, err
		}
	}
	return decoded, nil
}

func decodePublicChatTurnInterruptPayload(payload any) (publicChatTurnInterruptPayload, error) {
	raw, err := decodePublicChatStructPayload(payload)
	if err != nil {
		return publicChatTurnInterruptPayload{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var decoded publicChatTurnInterruptPayload
	if err := decoder.Decode(&decoded); err != nil {
		return publicChatTurnInterruptPayload{}, status.Error(codes.InvalidArgument, "public chat interrupt payload invalid")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return publicChatTurnInterruptPayload{}, status.Error(codes.InvalidArgument, "public chat interrupt payload must contain one object")
		}
		return publicChatTurnInterruptPayload{}, status.Error(codes.InvalidArgument, "public chat interrupt payload invalid")
	}
	if strings.TrimSpace(decoded.SessionID) == "" {
		return publicChatTurnInterruptPayload{}, status.Error(codes.InvalidArgument, "public chat interrupt payload requires session_id")
	}
	return decoded, nil
}

func decodePublicChatSessionSnapshotRequestPayload(payload any) (publicChatSessionSnapshotRequestPayload, error) {
	raw, err := decodePublicChatStructPayload(payload)
	if err != nil {
		return publicChatSessionSnapshotRequestPayload{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var decoded publicChatSessionSnapshotRequestPayload
	if err := decoder.Decode(&decoded); err != nil {
		return publicChatSessionSnapshotRequestPayload{}, status.Error(codes.InvalidArgument, "public chat session snapshot payload invalid")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return publicChatSessionSnapshotRequestPayload{}, status.Error(codes.InvalidArgument, "public chat session snapshot payload must contain one object")
		}
		return publicChatSessionSnapshotRequestPayload{}, status.Error(codes.InvalidArgument, "public chat session snapshot payload invalid")
	}
	if strings.TrimSpace(decoded.SessionID) == "" {
		return publicChatSessionSnapshotRequestPayload{}, status.Error(codes.InvalidArgument, "public chat session snapshot payload requires session_id")
	}
	return decoded, nil
}

func decodePublicChatStructPayload(payload any) ([]byte, error) {
	structPayload, ok := payload.(interface{ AsMap() map[string]any })
	if !ok || structPayload == nil {
		return nil, status.Error(codes.InvalidArgument, "public chat payload is required")
	}
	raw, err := json.Marshal(structPayload.AsMap())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "public chat payload invalid")
	}
	return raw, nil
}

func parsePublicChatRoutePolicy(value string) (runtimev1.RoutePolicy, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "local", "route_policy_local":
		return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, nil
	case "cloud", "route_policy_cloud":
		return runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, nil
	default:
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, status.Error(codes.InvalidArgument, "public chat execution_binding.route must be local or cloud")
	}
}

func parseOptionalPublicChatRoutePolicy(value string) (runtimev1.RoutePolicy, error) {
	if strings.TrimSpace(value) == "" {
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, nil
	}
	return parsePublicChatRoutePolicy(value)
}

func parsePublicChatReasoningMode(value string) runtimev1.ReasoningMode {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "off", "reasoning_mode_off":
		return runtimev1.ReasoningMode_REASONING_MODE_OFF
	case "on", "reasoning_mode_on":
		return runtimev1.ReasoningMode_REASONING_MODE_ON
	default:
		return runtimev1.ReasoningMode_REASONING_MODE_UNSPECIFIED
	}
}

func parsePublicChatReasoningTraceMode(value string) runtimev1.ReasoningTraceMode {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "hide", "reasoning_trace_mode_hide":
		return runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_HIDE
	case "separate", "reasoning_trace_mode_separate":
		return runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_SEPARATE
	default:
		return runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_UNSPECIFIED
	}
}

func publicChatRouteLabel(route runtimev1.RoutePolicy) string {
	switch route {
	case runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD:
		return "cloud"
	case runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL:
		return "local"
	default:
		return "unspecified"
	}
}

func publicChatExecutionBindingMismatch(left publicChatExecutionBinding, right publicChatExecutionBinding) bool {
	return strings.TrimSpace(left.ModelID) != strings.TrimSpace(right.ModelID) ||
		left.RoutePolicy != right.RoutePolicy ||
		strings.TrimSpace(left.ConnectorID) != strings.TrimSpace(right.ConnectorID)
}

func publicChatFinishReasonLabel(reason runtimev1.FinishReason) string {
	switch reason {
	case runtimev1.FinishReason_FINISH_REASON_STOP:
		return "stop"
	case runtimev1.FinishReason_FINISH_REASON_LENGTH:
		return "length"
	case runtimev1.FinishReason_FINISH_REASON_TOOL_CALL:
		return "tool_call"
	case runtimev1.FinishReason_FINISH_REASON_CONTENT_FILTER:
		return "content_filter"
	case runtimev1.FinishReason_FINISH_REASON_ERROR:
		return "error"
	default:
		return "unspecified"
	}
}

func publicChatReasonCodeLabel(code runtimev1.ReasonCode) string {
	if code == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return "REASON_CODE_UNSPECIFIED"
	}
	return code.String()
}

func usagePayload(usage *runtimev1.UsageStats) map[string]any {
	if usage == nil {
		return map[string]any{}
	}
	return map[string]any{
		"input_tokens":  usage.GetInputTokens(),
		"output_tokens": usage.GetOutputTokens(),
		"compute_ms":    usage.GetComputeMs(),
	}
}

func (o publicChatAssistantMemoryOutcome) payload() map[string]any {
	payload := map[string]any{
		"status":         o.Status,
		"accepted_count": o.AcceptedCount,
		"rejected_count": o.RejectedCount,
	}
	if o.ReasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		payload["reason_code"] = publicChatReasonCodeLabel(o.ReasonCode)
	}
	if strings.TrimSpace(o.Message) != "" {
		payload["message"] = strings.TrimSpace(o.Message)
	}
	return payload
}

func (o publicChatSidecarOutcome) payload() map[string]any {
	payload := map[string]any{
		"status":                o.Status,
		"accepted_memory_count": o.AcceptedMemoryCount,
		"canceled_hook_ids":     stringSlicePayload(o.CanceledHookIDs),
	}
	if strings.TrimSpace(o.ScheduledHookID) != "" {
		payload["scheduled_hook_id"] = o.ScheduledHookID
	}
	if strings.TrimSpace(o.StatusText) != "" {
		payload["status_text"] = o.StatusText
	}
	if o.ReasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		payload["reason_code"] = publicChatReasonCodeLabel(o.ReasonCode)
	}
	if strings.TrimSpace(o.Message) != "" {
		payload["message"] = strings.TrimSpace(o.Message)
	}
	return payload
}

func stringSlicePayload(values []string) []any {
	out := make([]any, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
