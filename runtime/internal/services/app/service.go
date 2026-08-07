package app

import (
	"context"
	"crypto/rand"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
	runtimeartifactservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
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

type localAppConversationScopeValidator interface {
	ValidateLocalAppConversationScope(context.Context, string, string) error
}

type localAppOperationAuthorizer interface {
	AuthorizeLocalAppProtectedOperation(context.Context, accountservice.LocalAppOperation, localappop.Selector) (accountservice.LocalAppCallerDecision, error)
}

type Option func(*Service)

type subscriber struct {
	id                   uint64
	appID                string
	subjectUserID        string
	conversationAnchorID string
	fromAppFilter        map[string]bool
	relay                *streamutil.Relay[*runtimev1.AppMessageEvent]
}

type InternalConsumer func(context.Context, *runtimev1.AppMessageEvent) error

// Service implements RuntimeAppService with in-memory pub/sub channels.
type Service struct {
	runtimev1.UnimplementedRuntimeAppServiceServer
	runtimev1.UnimplementedRuntimeDevelopmentServiceServer
	logger *slog.Logger

	mu                        sync.RWMutex
	nextSeq                   uint64
	nextSubID                 uint64
	subscribers               map[uint64]subscriber
	internalConsumers         map[string]InternalConsumer
	now                       func() time.Time
	sessionValidator          sessionValidator
	localAppConversationScope localAppConversationScopeValidator
	localAppOperationAuth     localAppOperationAuthorizer
	rateLimiter               *appRateLimiter
	loopDetector              *appLoopDetector
	appStorageDataRoot        string
	accountProjection         runtimeAccountProjectionProvider
	accountSecurity           runtimeAccountSecurityContextProvider
	localDevelopment          *localDevelopmentStore
	localDevelopmentRegistry  *protectedlocal.LocalAppLaunchRegistry
	localDevelopmentVerifier  protectedlocal.LocalDevelopmentProcessVerifier
	directLocalAppLaunches    *protectedlocal.DirectLocalAppLaunches
	localDevelopmentArtifacts runtimeartifactservice.Store
	localAppKernel            *localappkernel.Kernel
	localAppStorageMu         sync.RWMutex
	localAppSessionMu         sync.RWMutex
	localAppSessions          map[*protectedlocal.LocalAppConnection]localAppRuntimeSession
	localAppSessionEntropy    io.Reader
	localAppSessionTTL        time.Duration
	localAppRuntimeGeneration uint64
}

func WithSessionValidator(validator sessionValidator) Option {
	return func(s *Service) {
		s.sessionValidator = validator
	}
}

func WithLocalAppConversationScopeValidator(validator localAppConversationScopeValidator) Option {
	return func(s *Service) {
		s.localAppConversationScope = validator
	}
}

func WithLocalAppOperationAuthorizer(authorizer localAppOperationAuthorizer) Option {
	return func(s *Service) {
		s.localAppOperationAuth = authorizer
	}
}

func WithClock(now func() time.Time) Option {
	return func(s *Service) {
		if now != nil {
			s.now = now
		}
	}
}

// WithAppStorageDataRoot injects the product-selected nimi_data root used for
// app-scoped storage projections. The active path is local development;
// ordinary package release roots are deferred and absent.
func WithAppStorageDataRoot(dataRootRef string) Option {
	return func(s *Service) {
		s.appStorageDataRoot = strings.TrimSpace(dataRootRef)
	}
}

func WithRuntimeAccountProjectionProvider(provider runtimeAccountProjectionProvider) Option {
	return func(s *Service) {
		s.accountProjection = provider
		if security, ok := provider.(runtimeAccountSecurityContextProvider); ok {
			s.accountSecurity = security
		}
	}
}

func WithLocalDevelopmentAuthority(store *localDevelopmentStore, registry *protectedlocal.LocalAppLaunchRegistry, verifier protectedlocal.LocalDevelopmentProcessVerifier, artifacts runtimeartifactservice.Store) Option {
	return func(s *Service) {
		s.localDevelopment = store
		s.localDevelopmentRegistry = registry
		s.localDevelopmentVerifier = verifier
		s.localDevelopmentArtifacts = artifacts
	}
}

func WithDirectLocalDevelopmentAuthority(store *localDevelopmentStore, launches *protectedlocal.DirectLocalAppLaunches, artifacts runtimeartifactservice.Store) Option {
	return func(s *Service) {
		s.localDevelopment = store
		s.directLocalAppLaunches = launches
		s.localDevelopmentArtifacts = artifacts
	}
}

func WithLocalAppKernel(kernel *localappkernel.Kernel) Option {
	return func(s *Service) {
		s.localAppKernel = kernel
	}
}

func WithLocalAppSessionRuntime(entropy io.Reader, ttl time.Duration) Option {
	return func(s *Service) {
		if entropy != nil {
			s.localAppSessionEntropy = entropy
		}
		if ttl > 0 {
			s.localAppSessionTTL = ttl
		}
	}
}

func New(logger *slog.Logger, opts ...Option) *Service {
	svc := &Service{
		logger:                 logger,
		subscribers:            make(map[uint64]subscriber),
		internalConsumers:      make(map[string]InternalConsumer),
		now:                    time.Now,
		rateLimiter:            newAppRateLimiter(),
		loopDetector:           newAppLoopDetector(),
		localAppSessions:       make(map[*protectedlocal.LocalAppConnection]localAppRuntimeSession),
		localAppSessionEntropy: rand.Reader,
		localAppSessionTTL:     10 * time.Minute,
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
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	localDecision, localAppAuthorized := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !localAppAuthorized {
		if connection, protected := protectedlocal.LocalAppConnectionFromContext(ctx); protected && connection != nil {
			if s.localAppOperationAuth == nil || req.GetPayload() == nil {
				return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
			}
			fields := req.GetPayload().GetFields()
			selector := localappop.Selector{
				AgentID:              strings.TrimSpace(fields["local_agent_ref"].GetStringValue()),
				ConversationAnchorID: strings.TrimSpace(fields["conversation_anchor_id"].GetStringValue()),
			}
			var operation accountservice.LocalAppOperation
			switch strings.TrimSpace(req.GetMessageType()) {
			case "runtime.agent.turn.request":
				operation = accountservice.LocalAppOperationSendConversationTurn
				selector.TurnID = strings.TrimSpace(fields["request_id"].GetStringValue())
			case "runtime.agent.turn.interrupt":
				operation = accountservice.LocalAppOperationInterruptConversation
			default:
				return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
			}
			var authorizeErr error
			localDecision, authorizeErr = s.localAppOperationAuth.AuthorizeLocalAppProtectedOperation(ctx, operation, selector)
			if authorizeErr != nil {
				return nil, grpcerr.WrapWithReasonCode(
					codes.PermissionDenied,
					accountservice.LocalAppOperationAuthorizationReason(authorizeErr),
					authorizeErr,
					grpcerr.ReasonOptions{Message: "local app message operation was not authorized"},
				)
			}
			ctx = accountservice.ContextWithAuthorizedLocalAppDecision(ctx, localDecision)
			localAppAuthorized = true
		}
	}
	protectedPrincipal, protectedAuthorized := protectedprincipal.AttachedToContext(ctx)
	if protectedAuthorized && !protectedPrincipal.Valid() {
		return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if localAppAuthorized {
		messageType := strings.TrimSpace(req.GetMessageType())
		validOperation := (localDecision.Operation == accountservice.LocalAppOperationSendConversationTurn && messageType == "runtime.agent.turn.request") ||
			(localDecision.Operation == accountservice.LocalAppOperationInterruptConversation && messageType == "runtime.agent.turn.interrupt")
		if !validOperation || req.GetToAppId() != "runtime.agent" {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
		}
		cloned, ok := proto.Clone(req).(*runtimev1.SendAppMessageRequest)
		if !ok {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		cloned.FromAppId = localDecision.AppID
		cloned.SubjectUserId = localDecision.AccountID
		payload, payloadOK := proto.Clone(cloned.GetPayload()).(*structpb.Struct)
		if !payloadOK || strings.TrimSpace(localDecision.LocalAgentID) == "" {
			return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
		}
		if localDecision.Operation == accountservice.LocalAppOperationSendConversationTurn {
			payload.Fields["local_agent_ref"] = structpb.NewStringValue(localDecision.LocalAgentID)
		} else {
			if strings.TrimSpace(payload.GetFields()["turn_id"].GetStringValue()) != "" {
				return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
			}
			delete(payload.Fields, "local_agent_ref")
		}
		cloned.Payload = payload
		req = cloned
	}
	if protectedAuthorized {
		candidateFromAppID := strings.TrimSpace(req.GetFromAppId())
		if !runtimeagentservice.IsPublicChatIngressMessageType(strings.TrimSpace(req.GetMessageType())) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if (candidateFromAppID != "" && candidateFromAppID != protectedPrincipal.AppID) ||
			strings.TrimSpace(req.GetToAppId()) != "runtime.agent" {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
		}
		cloned, ok := proto.Clone(req).(*runtimev1.SendAppMessageRequest)
		if !ok {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		cloned.FromAppId = protectedPrincipal.AppID
		cloned.SubjectUserId = protectedPrincipal.AccountID
		req = cloned
	}
	fromAppID := strings.TrimSpace(req.GetFromAppId())
	toAppID := strings.TrimSpace(req.GetToAppId())
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())
	messageType := strings.TrimSpace(req.GetMessageType())
	conversationBroadcast := toAppID == "" && isTrustedInternalCaller(ctx, fromAppID) && runtimeAgentConversationBroadcastEnvelope(
		fromAppID, subjectUserID, messageType, req.GetPayload(),
	)
	if fromAppID == "" || (toAppID == "" && !conversationBroadcast) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if contextAppID := appIDFromContext(ctx); contextAppID != "" && contextAppID != fromAppID {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}

	if s.sessionValidator != nil && !localAppAuthorized && !protectedAuthorized && !isTrustedInternalCaller(ctx, fromAppID) {
		sessionID, sessionToken, _ := envelope.ParseSessionFromContext(ctx)
		if reasonCode, ok := s.sessionValidator.ValidateAppSession(fromAppID, sessionID, sessionToken); !ok {
			return nil, grpcerr.WithReasonCode(codes.Unauthenticated, reasonCode)
		}
	}
	if toAppID == "runtime.agent" {
		if !runtimeagentservice.IsPublicChatIngressMessageType(messageType) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if !localAppAuthorized {
			if err := validateRuntimeAgentAccess(ctx, fromAppID, requiredRuntimeAgentSendScope(messageType)); err != nil {
				return nil, err
			}
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
	if req == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	localAppContext := stream.Context()
	localDecision, localAppAuthorized := accountservice.AuthorizedLocalAppDecisionFromContext(localAppContext)
	if !localAppAuthorized {
		if connection, protected := protectedlocal.LocalAppConnectionFromContext(localAppContext); protected && connection != nil {
			if s.localAppOperationAuth == nil {
				return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
			}
			selector := localappop.Selector{AgentID: strings.TrimSpace(req.GetLocalAgentRef()), ConversationAnchorID: strings.TrimSpace(req.GetConversationAnchorId())}
			var authorizeErr error
			localDecision, authorizeErr = s.localAppOperationAuth.AuthorizeLocalAppProtectedOperation(localAppContext, accountservice.LocalAppOperationSubscribeConversation, selector)
			if authorizeErr != nil {
				return grpcerr.WrapWithReasonCode(
					codes.PermissionDenied,
					accountservice.LocalAppOperationAuthorizationReason(authorizeErr),
					authorizeErr,
					grpcerr.ReasonOptions{Message: "local app subscription was not authorized"},
				)
			}
			localAppContext = accountservice.ContextWithAuthorizedLocalAppDecision(localAppContext, localDecision)
			localAppAuthorized = true
		}
	}
	protectedPrincipal, protectedAuthorized := protectedprincipal.AttachedToContext(stream.Context())
	if protectedAuthorized && !protectedPrincipal.Valid() {
		return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	localAppSelector := localappop.Selector{}
	if localAppAuthorized {
		if localDecision.Operation != accountservice.LocalAppOperationSubscribeConversation || len(req.GetFromAppIds()) != 1 || req.GetFromAppIds()[0] != "runtime.agent" || strings.TrimSpace(req.GetLocalAgentRef()) == "" || strings.TrimSpace(req.GetConversationAnchorId()) == "" {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
		}
		agentHandle := strings.TrimSpace(req.GetLocalAgentRef())
		cloned, ok := proto.Clone(req).(*runtimev1.SubscribeAppMessagesRequest)
		if !ok || strings.TrimSpace(localDecision.LocalAgentID) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		cloned.AppId = localDecision.AppID
		cloned.SubjectUserId = localDecision.AccountID
		cloned.LocalAgentRef = localDecision.LocalAgentID
		req = cloned
		if s.localAppConversationScope == nil || s.localAppConversationScope.ValidateLocalAppConversationScope(
			localAppContext, strings.TrimSpace(req.GetLocalAgentRef()), strings.TrimSpace(req.GetConversationAnchorId()),
		) != nil {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
		}
		if s.localAppOperationAuth == nil {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
		}
		localAppSelector = localappop.Selector{
			AgentID: agentHandle, ConversationAnchorID: strings.TrimSpace(req.GetConversationAnchorId()),
		}
	}
	if protectedAuthorized {
		candidateAppID := strings.TrimSpace(req.GetAppId())
		if (candidateAppID != "" && candidateAppID != protectedPrincipal.AppID) ||
			len(req.GetFromAppIds()) != 1 ||
			strings.TrimSpace(req.GetFromAppIds()[0]) != "runtime.agent" {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
		}
		cloned, ok := proto.Clone(req).(*runtimev1.SubscribeAppMessagesRequest)
		if !ok {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		cloned.AppId = protectedPrincipal.AppID
		cloned.SubjectUserId = protectedPrincipal.AccountID
		req = cloned
	}
	if strings.TrimSpace(req.GetAppId()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if strings.TrimSpace(req.GetCursor()) != "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if contextAppID := appIDFromContext(stream.Context()); contextAppID != "" && contextAppID != strings.TrimSpace(req.GetAppId()) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if s.sessionValidator != nil && !localAppAuthorized && !protectedAuthorized && !isTrustedInternalCaller(stream.Context(), strings.TrimSpace(req.GetAppId())) {
		sessionID, sessionToken, _ := envelope.ParseSessionFromContext(stream.Context())
		if reasonCode, ok := s.sessionValidator.ValidateAppSession(strings.TrimSpace(req.GetAppId()), sessionID, sessionToken); !ok {
			return grpcerr.WithReasonCode(codes.Unauthenticated, reasonCode)
		}
	}
	if subscribesRuntimeAgent(req) {
		if !localAppAuthorized {
			if err := validateRuntimeAgentAccess(stream.Context(), strings.TrimSpace(req.GetAppId()), "runtime.agent.turn.read"); err != nil {
				return err
			}
		}
	}
	if err := stream.SendHeader(metadata.MD{}); err != nil {
		return err
	}
	sub := s.addSubscriber(req)
	defer s.removeSubscriber(sub.id)

	err := sub.relay.Run(stream.Context(), func(event *runtimev1.AppMessageEvent) error {
		if localAppAuthorized {
			current, authorizeErr := s.localAppOperationAuth.AuthorizeLocalAppProtectedOperation(
				stream.Context(), accountservice.LocalAppOperationSubscribeConversation, localAppSelector,
			)
			if authorizeErr != nil {
				reason := accountservice.LocalAppOperationAuthorizationReason(authorizeErr)
				return grpcerr.WrapWithReasonCode(
					codes.PermissionDenied,
					reason,
					authorizeErr,
					grpcerr.ReasonOptions{Message: "local app subscription authorization is no longer valid"},
				)
			}
			if current.RegisteredAppSubject != localDecision.RegisteredAppSubject ||
				current.RegistrationHandle != localDecision.RegistrationHandle ||
				current.SourceGeneration != localDecision.SourceGeneration ||
				current.DeclarationGeneration != localDecision.DeclarationGeneration ||
				current.AccountID != localDecision.AccountID {
				return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
			}
		}
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
		id:                   s.nextSubID,
		appID:                strings.TrimSpace(req.GetAppId()),
		subjectUserID:        strings.TrimSpace(req.GetSubjectUserId()),
		conversationAnchorID: strings.TrimSpace(req.GetConversationAnchorId()),
		fromAppFilter:        filter,
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
	if runtimeAgentConversationBroadcastEvent(event) {
		if !sub.fromAppFilter[runtimeagentservice.PublicChatRuntimeAppID] ||
			sub.subjectUserID == "" || sub.subjectUserID != strings.TrimSpace(event.GetSubjectUserId()) {
			return false
		}
		fields := event.GetPayload().GetFields()
		if sub.conversationAnchorID != "" && sub.conversationAnchorID != strings.TrimSpace(fields["conversation_anchor_id"].GetStringValue()) {
			return false
		}
		return true
	}
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

func runtimeAgentConversationBroadcastEnvelope(fromAppID string, subjectUserID string, messageType string, payload *structpb.Struct) bool {
	if strings.TrimSpace(fromAppID) != runtimeagentservice.PublicChatRuntimeAppID ||
		strings.TrimSpace(subjectUserID) == "" || payload == nil {
		return false
	}
	trimmedType := strings.TrimSpace(messageType)
	if !strings.HasPrefix(trimmedType, "runtime.agent.turn.") && !strings.HasPrefix(trimmedType, "runtime.agent.presentation.") {
		return false
	}
	fields := payload.GetFields()
	return strings.TrimSpace(fields["conversation_anchor_id"].GetStringValue()) != ""
}

func runtimeAgentConversationBroadcastEvent(event *runtimev1.AppMessageEvent) bool {
	return event != nil && strings.TrimSpace(event.GetToAppId()) == "" && runtimeAgentConversationBroadcastEnvelope(
		event.GetFromAppId(), event.GetSubjectUserId(), event.GetMessageType(), event.GetPayload(),
	)
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
	return "runtime.agent.turn.write"
}

func validateRuntimeAgentAccess(ctx context.Context, appID string, requiredScope string) error {
	if envelope.HasValidatedProtectedCapability(ctx, appID, requiredScope) {
		return nil
	}
	return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
}
