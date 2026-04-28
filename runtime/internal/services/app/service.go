package app

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"github.com/nimiplatform/nimi/runtime/internal/streamutil"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type trustedInternalCallerContextKey struct{}

type trustedInternalCaller struct {
	appID string
}

type sessionValidator interface {
	ValidateAppSession(appID string, sessionID string, sessionToken string) (runtimev1.ReasonCode, bool)
}

type scopedBindingValidator interface {
	ValidateScopedBinding(bindingID string, actual *runtimev1.ScopedAppBindingRelation, requiredScope string) (runtimev1.AccountReasonCode, bool)
}

type Option func(*Service)

type subscriber struct {
	id            uint64
	appID         string
	subjectUserID string
	fromAppFilter map[string]bool
	scopedBinding *runtimev1.ScopedRuntimeBindingAttachment
	relay         *streamutil.Relay[*runtimev1.AppMessageEvent]
}

type InternalConsumer func(context.Context, *runtimev1.AppMessageEvent) error

// Service implements RuntimeAppService with in-memory pub/sub channels.
type Service struct {
	runtimev1.UnimplementedRuntimeAppServiceServer
	logger *slog.Logger

	mu                sync.RWMutex
	nextSeq           uint64
	nextSubID         uint64
	subscribers       map[uint64]subscriber
	internalConsumers map[string]InternalConsumer
	now               func() time.Time
	sessionValidator  sessionValidator
	bindingValidator  scopedBindingValidator
	rateLimiter       *appRateLimiter
	loopDetector      *appLoopDetector
}

func WithSessionValidator(validator sessionValidator) Option {
	return func(s *Service) {
		s.sessionValidator = validator
	}
}

func WithScopedBindingValidator(validator scopedBindingValidator) Option {
	return func(s *Service) {
		s.bindingValidator = validator
	}
}

func WithClock(now func() time.Time) Option {
	return func(s *Service) {
		if now != nil {
			s.now = now
		}
	}
}

func New(logger *slog.Logger, opts ...Option) *Service {
	svc := &Service{
		logger:            logger,
		subscribers:       make(map[uint64]subscriber),
		internalConsumers: make(map[string]InternalConsumer),
		now:               time.Now,
		rateLimiter:       newAppRateLimiter(),
		loopDetector:      newAppLoopDetector(),
	}
	for _, opt := range opts {
		if opt != nil {
			opt(svc)
		}
	}
	return svc
}

func WithTrustedInternalCaller(ctx context.Context, appID string) context.Context {
	trimmed := strings.TrimSpace(appID)
	if trimmed == "" {
		return ctx
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, trustedInternalCallerContextKey{}, trustedInternalCaller{appID: trimmed})
}

func (s *Service) SendAppMessage(ctx context.Context, req *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
	fromAppID := strings.TrimSpace(req.GetFromAppId())
	toAppID := strings.TrimSpace(req.GetToAppId())
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())
	messageType := strings.TrimSpace(req.GetMessageType())
	if fromAppID == "" || toAppID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if contextAppID := appIDFromContext(ctx); contextAppID != "" && contextAppID != fromAppID {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}

	if s.sessionValidator != nil && !isTrustedInternalCaller(ctx, fromAppID) {
		sessionID, sessionToken, _ := envelope.ParseSessionFromContext(ctx)
		if reasonCode, ok := s.sessionValidator.ValidateAppSession(fromAppID, sessionID, sessionToken); !ok {
			return nil, grpcerr.WithReasonCode(codes.Unauthenticated, reasonCode)
		}
	}
	if toAppID == "runtime.agent" {
		if err := s.validateRuntimeAgentBinding(req.GetScopedBinding(), fromAppID, requiredRuntimeAgentSendScope(messageType)); err != nil {
			return nil, err
		}
	}

	if payload := req.GetPayload(); payload != nil && proto.Size(payload) > maxPayloadBytes {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_MESSAGE_PAYLOAD_TOO_LARGE)
	}

	now := s.now().UTC()
	if !s.rateLimiter.Allow(fromAppID, now) {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_APP_MESSAGE_RATE_LIMITED)
	}
	if !s.loopDetector.Allow(fromAppID, toAppID, now) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_MESSAGE_LOOP_DETECTED)
	}

	messageID := ulid.Make().String()
	traceID := ulid.Make().String()

	receivedEvent := &runtimev1.AppMessageEvent{
		EventType:     runtimev1.AppMessageEventType_APP_MESSAGE_EVENT_RECEIVED,
		MessageId:     messageID,
		FromAppId:     fromAppID,
		ToAppId:       toAppID,
		SubjectUserId: subjectUserID,
		MessageType:   messageType,
		Payload:       clonePayload(req.GetPayload()),
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       traceID,
		Timestamp:     timestamppb.New(now),
	}
	if consumer := s.internalConsumer(toAppID); consumer != nil {
		if err := consumer(ctx, cloneEvent(receivedEvent)); err != nil {
			return nil, err
		}
	}
	s.publish(receivedEvent)

	if req.GetRequireAck() {
		s.publish(&runtimev1.AppMessageEvent{
			EventType:     runtimev1.AppMessageEventType_APP_MESSAGE_EVENT_ACKED,
			MessageId:     messageID,
			FromAppId:     fromAppID,
			ToAppId:       toAppID,
			SubjectUserId: subjectUserID,
			MessageType:   messageType,
			ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
			TraceId:       traceID,
			Timestamp:     timestamppb.New(s.now().UTC()),
		})
	}

	s.logger.Info(
		"app message sent",
		"message_id", messageID,
		"from_app_id", fromAppID,
		"to_app_id", toAppID,
		"subject_user_id", subjectUserID,
		"message_type", messageType,
	)
	return &runtimev1.SendAppMessageResponse{
		MessageId:  messageID,
		Accepted:   true,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RegisterInternalConsumer(appID string, consumer InternalConsumer) {
	key := strings.TrimSpace(appID)
	s.mu.Lock()
	defer s.mu.Unlock()
	if key == "" || consumer == nil {
		delete(s.internalConsumers, key)
		return
	}
	s.internalConsumers[key] = consumer
}

func (s *Service) HasInternalConsumer(appID string) bool {
	return s.internalConsumer(strings.TrimSpace(appID)) != nil
}

func (s *Service) SubscribeAppMessages(req *runtimev1.SubscribeAppMessagesRequest, stream runtimev1.RuntimeAppService_SubscribeAppMessagesServer) error {
	if req == nil || strings.TrimSpace(req.GetAppId()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if contextAppID := appIDFromContext(stream.Context()); contextAppID != "" && contextAppID != strings.TrimSpace(req.GetAppId()) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if s.sessionValidator != nil && !isTrustedInternalCaller(stream.Context(), strings.TrimSpace(req.GetAppId())) {
		sessionID, sessionToken, _ := envelope.ParseSessionFromContext(stream.Context())
		if reasonCode, ok := s.sessionValidator.ValidateAppSession(strings.TrimSpace(req.GetAppId()), sessionID, sessionToken); !ok {
			return grpcerr.WithReasonCode(codes.Unauthenticated, reasonCode)
		}
	}
	if subscribesRuntimeAgent(req) {
		if err := s.validateRuntimeAgentBinding(req.GetScopedBinding(), strings.TrimSpace(req.GetAppId()), "runtime.agent.turn.read"); err != nil {
			return err
		}
	}
	if err := stream.SendHeader(metadata.MD{}); err != nil {
		return err
	}
	sub := s.addSubscriber(req)
	defer s.removeSubscriber(sub.id)

	err := sub.relay.Run(stream.Context(), func(event *runtimev1.AppMessageEvent) error {
		return stream.Send(event)
	})
	if err == nil && rpcctx.WasServerShutdown(stream.Context()) {
		return rpcctx.ServerShutdownError()
	}
	return err
}

func appIDFromContext(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	values := md.Get("x-nimi-app-id")
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

func isTrustedInternalCaller(ctx context.Context, appID string) bool {
	if ctx == nil {
		return false
	}
	caller, ok := ctx.Value(trustedInternalCallerContextKey{}).(trustedInternalCaller)
	if !ok {
		return false
	}
	return strings.TrimSpace(caller.appID) != "" && strings.TrimSpace(caller.appID) == strings.TrimSpace(appID)
}

func (s *Service) addSubscriber(req *runtimev1.SubscribeAppMessagesRequest) subscriber {
	filter := make(map[string]bool, len(req.GetFromAppIds()))
	for _, appID := range req.GetFromAppIds() {
		trimmed := strings.TrimSpace(appID)
		if trimmed == "" {
			continue
		}
		filter[trimmed] = true
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.nextSubID++
	sub := subscriber{
		id:            s.nextSubID,
		appID:         strings.TrimSpace(req.GetAppId()),
		subjectUserID: strings.TrimSpace(req.GetSubjectUserId()),
		fromAppFilter: filter,
		scopedBinding: cloneScopedBindingAttachment(req.GetScopedBinding()),
		relay: streamutil.NewRelay(streamutil.RelayOptions[*runtimev1.AppMessageEvent]{
			Budget:              32,
			MaxConsecutiveDrops: 3,
			CloseErr:            status.Error(codes.ResourceExhausted, "slow consumer"),
		}),
	}
	s.subscribers[sub.id] = sub
	return sub
}

func (s *Service) removeSubscriber(id uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	sub, exists := s.subscribers[id]
	if !exists {
		return
	}
	delete(s.subscribers, id)
	sub.relay.Close()
}

func (s *Service) publish(event *runtimev1.AppMessageEvent) {
	s.mu.Lock()
	s.nextSeq++
	event.Sequence = s.nextSeq

	targets := make([]subscriber, 0, len(s.subscribers))
	for _, sub := range s.subscribers {
		targets = append(targets, sub)
	}
	s.mu.Unlock()

	for _, sub := range targets {
		if !matches(sub, event) {
			continue
		}
		if event.GetFromAppId() == "runtime.agent" && sub.scopedBinding != nil {
			if err := s.validateRuntimeAgentBinding(sub.scopedBinding, sub.appID, "runtime.agent.turn.read"); err != nil {
				sub.relay.CloseWithError(err)
				continue
			}
		}
		if err := sub.relay.Enqueue(cloneEvent(event)); err != nil && s.logger != nil {
			s.logger.Warn("app subscriber relay closed", "subscriber_id", sub.id, "error", err)
		}
	}
}

func (s *Service) internalConsumer(appID string) InternalConsumer {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.internalConsumers[strings.TrimSpace(appID)]
}

func matches(sub subscriber, event *runtimev1.AppMessageEvent) bool {
	if sub.appID != "" && sub.appID != event.GetToAppId() {
		return false
	}
	if sub.subjectUserID != "" && sub.subjectUserID != event.GetSubjectUserId() {
		return false
	}
	if len(sub.fromAppFilter) > 0 && !sub.fromAppFilter[event.GetFromAppId()] {
		return false
	}
	return true
}

func cloneEvent(event *runtimev1.AppMessageEvent) *runtimev1.AppMessageEvent {
	cloned := proto.Clone(event)
	out, ok := cloned.(*runtimev1.AppMessageEvent)
	if !ok {
		return &runtimev1.AppMessageEvent{}
	}
	return out
}

func clonePayload(input *structpb.Struct) *structpb.Struct {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	out, ok := cloned.(*structpb.Struct)
	if !ok {
		return nil
	}
	return out
}

func subscribesRuntimeAgent(req *runtimev1.SubscribeAppMessagesRequest) bool {
	for _, appID := range req.GetFromAppIds() {
		if strings.TrimSpace(appID) == "runtime.agent" {
			return true
		}
	}
	return false
}

func requiredRuntimeAgentSendScope(messageType string) string {
	switch strings.TrimSpace(messageType) {
	case "runtime.agent.session.snapshot.request":
		return "runtime.agent.turn.read"
	default:
		return "runtime.agent.turn.write"
	}
}

func (s *Service) validateRuntimeAgentBinding(attachment *runtimev1.ScopedRuntimeBindingAttachment, fallbackRuntimeAppID string, requiredScope string) error {
	if attachment == nil || strings.TrimSpace(attachment.GetBindingId()) == "" {
		return runtimeAgentBindingError(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND)
	}
	if s.bindingValidator == nil {
		return runtimeAgentBindingError(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE)
	}
	actual := relationFromAttachment(attachment, fallbackRuntimeAppID)
	if reason, ok := s.bindingValidator.ValidateScopedBinding(strings.TrimSpace(attachment.GetBindingId()), actual, requiredScope); !ok {
		return runtimeAgentBindingError(reason)
	}
	return nil
}

func relationFromAttachment(attachment *runtimev1.ScopedRuntimeBindingAttachment, fallbackRuntimeAppID string) *runtimev1.ScopedAppBindingRelation {
	if attachment == nil {
		return nil
	}
	runtimeAppID := strings.TrimSpace(attachment.GetRuntimeAppId())
	if runtimeAppID == "" {
		runtimeAppID = strings.TrimSpace(fallbackRuntimeAppID)
	}
	return &runtimev1.ScopedAppBindingRelation{
		RuntimeAppId:         runtimeAppID,
		AppInstanceId:        strings.TrimSpace(attachment.GetAppInstanceId()),
		WindowId:             strings.TrimSpace(attachment.GetWindowId()),
		AvatarInstanceId:     strings.TrimSpace(attachment.GetAvatarInstanceId()),
		AgentId:              strings.TrimSpace(attachment.GetAgentId()),
		ConversationAnchorId: strings.TrimSpace(attachment.GetConversationAnchorId()),
		WorldId:              strings.TrimSpace(attachment.GetWorldId()),
	}
}

func runtimeAgentBindingError(reason runtimev1.AccountReasonCode) error {
	code := codes.PermissionDenied
	if reason == runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND {
		code = codes.InvalidArgument
	}
	return grpcerr.WithReasonCodeOptions(code, runtimev1.ReasonCode_APP_GRANT_INVALID, grpcerr.ReasonOptions{
		ActionHint: "attach_active_scoped_runtime_binding",
		Metadata: map[string]string{
			"account_reason_code": reason.String(),
		},
	})
}

func cloneScopedBindingAttachment(input *runtimev1.ScopedRuntimeBindingAttachment) *runtimev1.ScopedRuntimeBindingAttachment {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	out, ok := cloned.(*runtimev1.ScopedRuntimeBindingAttachment)
	if !ok {
		return nil
	}
	return out
}
