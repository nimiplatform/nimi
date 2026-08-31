package realmrealtime

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

const (
	realmEventBufferCapacity = 128
	realmHTTPResponseMax     = 8 << 20
	realmOperationTimeout    = 10 * time.Second
)

type AccountProvider interface {
	BindRealmRealtimeAccount(context.Context) (accountservice.RealmRealtimeAccountLease, error)
	RefreshRealmRealtimeAccount(context.Context, uint64, string) (accountservice.RealmRealtimeAccountLease, error)
}

type Service struct {
	runtimev1.UnimplementedRuntimeRealmRealtimeServiceServer
	logger     *slog.Logger
	accounts   AccountProvider
	httpClient *http.Client

	mu         sync.Mutex
	closed     bool
	generation atomic.Uint64
	channels   map[string]*realmChannel
	remote     *realmConnection
}

type realmConnection struct {
	lease            accountservice.RealmRealtimeAccountLease
	driver           *socketIOClient
	ctx              context.Context
	cancel           context.CancelFunc
	openMu           sync.Mutex
	presenceMu       sync.Mutex
	presenceRevision map[string]uint64
}

type realmChannel struct {
	mu                sync.Mutex
	realtimeSessionID string
	channelID         string
	appID             string
	appSessionID      string
	accountID         string
	accountGeneration uint64
	generation        uint64
	closed            bool
	subscriptions     map[string]*realmSubscription
}

type realmSubscriptionKind uint8

const (
	realmSubscriptionChat realmSubscriptionKind = iota + 1
	realmSubscriptionPresence
	realmSubscriptionInbox
)

type realmSubscription struct {
	mu              sync.Mutex
	id              string
	kind            realmSubscriptionKind
	chatID          string
	remoteSessionID string
	resumeToken     string
	lastCursor      uint64
	lastAckCursor   uint64
	sequence        uint64
	recovering      bool
	remoteOpening   bool
	stream          *realtimecore.Stream[*runtimev1.SubscribeRealmRealtimeEventsResponse]
}

// @nimi-authority: rule.nimi.runtime.realm-realtime.r001
// @nimi-authority: rule.nimi.runtime.realm-realtime.r002
// @nimi-authority: rule.nimi.runtime.realm-realtime.r003
func New(logger *slog.Logger, accounts AccountProvider) *Service {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	return &Service{
		logger: logger, accounts: accounts,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		channels:   make(map[string]*realmChannel),
	}
}

// @nimi-authority: rule.nimi.runtime.realm-realtime.r001
func (s *Service) ListRealmChats(ctx context.Context, req *runtimev1.ListRealmChatsRequest) (output *runtimev1.ListRealmChatsResponse, resultErr error) {
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if _, _, err := realtimeCaller(ctx); err != nil {
		return nil, err
	}
	limit := req.GetLimit()
	if limit == 0 {
		limit = 20
	}
	if limit < 1 || limit > 50 || strings.TrimSpace(req.GetCursor()) != req.GetCursor() {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	lease, err := s.accounts.BindRealmRealtimeAccount(ctx)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	target, err := url.Parse(lease.RealmBaseURL + "/api/human/chats")
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REALM_UNAVAILABLE)
	}
	query := target.Query()
	query.Set("limit", fmt.Sprintf("%d", limit))
	if req.GetCursor() != "" {
		query.Set("cursor", req.GetCursor())
	}
	target.RawQuery = query.Encode()
	operationCtx, cancel := context.WithTimeout(ctx, realmOperationTimeout)
	defer cancel()
	httpRequest, err := http.NewRequestWithContext(operationCtx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REALM_UNAVAILABLE)
	}
	httpRequest.Header.Set("authorization", "Bearer "+lease.AccessToken)
	response, err := s.httpClient.Do(httpRequest)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REALM_UNAVAILABLE)
	}
	defer func() {
		if err := response.Body.Close(); resultErr == nil && err != nil {
			output = nil
			resultErr = grpcerr.WithReasonCode(codes.DataLoss, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	}()
	limited := io.LimitReader(response.Body, realmHTTPResponseMax+1)
	body, err := io.ReadAll(limited)
	if err != nil || len(body) > realmHTTPResponseMax {
		return nil, grpcerr.WithReasonCode(codes.DataLoss, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if response.StatusCode != http.StatusOK {
		return nil, realmChatListHTTPError(response.StatusCode)
	}
	var result wireChatListResult
	if err := decodeStrictJSON(body, &result); err != nil {
		return nil, grpcerr.WithReasonCode(codes.DataLoss, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	projected, err := convertWireChatList(result)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.DataLoss, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return projected, nil
}

func realmChatListHTTPError(statusCode int) error {
	switch statusCode {
	case http.StatusUnauthorized:
		return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	case http.StatusForbidden:
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	case http.StatusNotFound:
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_REALM_NOT_FOUND)
	case http.StatusTooManyRequests:
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_REALM_OPERATION_FAILED)
	default:
		if statusCode >= 500 {
			return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REALM_UNAVAILABLE)
		}
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_REALM_OPERATION_FAILED)
	}
}

func (s *Service) OpenRealmRealtimeChannel(ctx context.Context, _ *runtimev1.OpenRealmRealtimeChannelRequest) (*runtimev1.OpenRealmRealtimeChannelResponse, error) {
	appID, appSessionID, err := realtimeCaller(ctx)
	if err != nil {
		return nil, err
	}
	lease, err := s.accounts.BindRealmRealtimeAccount(ctx)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	if err := s.ensureConnection(ctx, lease); err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REALM_UNAVAILABLE)
	}
	generation := s.generation.Add(1)
	if generation == 0 {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_REALM_OPERATION_FAILED)
	}
	channel := &realmChannel{
		realtimeSessionID: ulid.Make().String(), channelID: ulid.Make().String(),
		appID: appID, appSessionID: appSessionID, accountID: lease.AccountID,
		accountGeneration: lease.Generation, generation: generation,
		subscriptions: make(map[string]*realmSubscription),
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REALM_UNAVAILABLE)
	}
	s.channels[channel.channelID] = channel
	s.mu.Unlock()
	status := channelControl(channel, "", runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_READY, realtimecore.BackpressureNormal, 0, 0, runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_UNSPECIFIED, "")
	return &runtimev1.OpenRealmRealtimeChannelResponse{
		RealtimeSessionId: channel.realtimeSessionID,
		ChannelId:         channel.channelID,
		Generation:        generation,
		Status:            status,
	}, nil
}

func (s *Service) SubscribeRealmRealtimeEvents(req *runtimev1.SubscribeRealmRealtimeEventsRequest, stream runtimev1.RuntimeRealmRealtimeService_SubscribeRealmRealtimeEventsServer) error {
	if req == nil || stream == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	channel, err := s.authorizeChannel(stream.Context(), req.GetChannelId())
	if err != nil {
		return err
	}
	subscriptionID := ulid.Make().String()
	coreStream, err := realtimecore.NewStream[*runtimev1.SubscribeRealmRealtimeEventsResponse](realtimecore.Config{
		RealtimeSessionID: channel.realtimeSessionID, ChannelID: channel.channelID,
		SubscriptionID: subscriptionID, AdapterKind: "realm", Generation: channel.generation,
		Capacity: realmEventBufferCapacity, PressureAt: realmEventBufferCapacity * 3 / 4,
	})
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_REALM_OPERATION_FAILED)
	}
	subscription := &realmSubscription{id: subscriptionID, stream: coreStream}
	switch target := req.Target.(type) {
	case *runtimev1.SubscribeRealmRealtimeEventsRequest_Chat:
		if target.Chat == nil || strings.TrimSpace(target.Chat.GetChatId()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		subscription.kind = realmSubscriptionChat
		subscription.chatID = strings.TrimSpace(target.Chat.GetChatId())
	case *runtimev1.SubscribeRealmRealtimeEventsRequest_Presence:
		if target.Presence == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		subscription.kind = realmSubscriptionPresence
	case *runtimev1.SubscribeRealmRealtimeEventsRequest_Inbox:
		if target.Inbox == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		subscription.kind = realmSubscriptionInbox
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	channel.mu.Lock()
	if channel.closed {
		channel.mu.Unlock()
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_REALM_UNAVAILABLE)
	}
	channel.subscriptions[subscriptionID] = subscription
	channel.mu.Unlock()
	cleanup := true
	defer func() {
		if cleanup {
			s.removeSubscription(channel, subscription, realtimecore.TerminalCancelled)
		}
	}()

	if subscription.kind == realmSubscriptionChat || subscription.kind == realmSubscriptionInbox {
		if err := s.openRemoteChatSubscription(stream.Context(), channel, subscription); err != nil {
			return err
		}
	} else {
		_ = coreStream.Transition(channel.generation, realtimecore.LifecycleReady)
		if err := s.publishControl(channel, subscription, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_READY, ""); err != nil {
			return err
		}
	}
	reader, release, err := coreStream.ClaimReader()
	if err != nil {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	defer release()
	for {
		select {
		case <-stream.Context().Done():
			return stream.Context().Err()
		case event, ok := <-reader:
			if !ok {
				cleanup = false
				return s.sendTerminalControl(stream, channel, subscription)
			}
			if event == nil {
				continue
			}
			terminal := realmSubscriptionEventTerminal(event)
			if err := stream.Send(event); err != nil {
				return err
			}
			if terminal {
				cleanup = false
				return nil
			}
		}
	}
}

func (s *Service) AckRealmRealtimeEvents(ctx context.Context, req *runtimev1.AckRealmRealtimeEventsRequest) (*runtimev1.AckRealmRealtimeEventsResponse, error) {
	channel, err := s.authorizeChannel(ctx, req.GetChannelId())
	if err != nil {
		return nil, err
	}
	subscription, err := channelSubscription(channel, req.GetSubscriptionId())
	if err != nil || subscription.kind != realmSubscriptionChat || req.GetCursor() == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	subscription.mu.Lock()
	if req.GetCursor() > subscription.lastCursor {
		subscription.mu.Unlock()
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if req.GetCursor() <= subscription.lastAckCursor {
		subscription.mu.Unlock()
		return &runtimev1.AckRealmRealtimeEventsResponse{Ack: &runtimev1.Ack{Ok: true}}, nil
	}
	remoteSessionID := subscription.remoteSessionID
	subscription.mu.Unlock()
	operationCtx, cancel := context.WithTimeout(ctx, realmOperationTimeout)
	defer cancel()
	response, err := s.emitRemoteAck(operationCtx, "chat:event.ack", map[string]any{
		"chatId": subscription.chatID, "sessionId": remoteSessionID, "ackSeq": req.GetCursor(),
	})
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REALM_UNAVAILABLE)
	}
	if response.Status != "ok" {
		return nil, realmOperationError(response)
	}
	subscription.mu.Lock()
	if req.GetCursor() > subscription.lastAckCursor {
		subscription.lastAckCursor = req.GetCursor()
	}
	subscription.mu.Unlock()
	return &runtimev1.AckRealmRealtimeEventsResponse{Ack: &runtimev1.Ack{Ok: true}}, nil
}

func (s *Service) CloseRealmRealtimeSubscription(ctx context.Context, req *runtimev1.CloseRealmRealtimeSubscriptionRequest) (*runtimev1.CloseRealmRealtimeSubscriptionResponse, error) {
	channel, err := s.authorizeChannel(ctx, req.GetChannelId())
	if err != nil {
		return nil, err
	}
	subscription, err := channelSubscription(channel, req.GetSubscriptionId())
	if err != nil {
		return nil, err
	}
	s.removeSubscription(channel, subscription, realtimecore.TerminalCancelled)
	return &runtimev1.CloseRealmRealtimeSubscriptionResponse{Ack: &runtimev1.Ack{Ok: true}}, nil
}

func (s *Service) CloseRealmRealtimeChannel(ctx context.Context, req *runtimev1.CloseRealmRealtimeChannelRequest) (*runtimev1.CloseRealmRealtimeChannelResponse, error) {
	channel, err := s.authorizeChannel(ctx, req.GetChannelId())
	if err != nil {
		return nil, err
	}
	s.closeChannel(channel, realtimecore.TerminalCancelled)
	return &runtimev1.CloseRealmRealtimeChannelResponse{Ack: &runtimev1.Ack{Ok: true}}, nil
}

func (s *Service) Close() {
	if s == nil {
		return
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	remote := s.remote
	s.remote = nil
	channels := make([]*realmChannel, 0, len(s.channels))
	for _, channel := range s.channels {
		channels = append(channels, channel)
	}
	s.channels = make(map[string]*realmChannel)
	s.mu.Unlock()
	if remote != nil {
		remote.cancel()
		remote.driver.Close()
	}
	for _, channel := range channels {
		s.closeChannel(channel, realtimecore.TerminalRuntimeShutdown)
	}
}

func (s *Service) ensureConnection(ctx context.Context, lease accountservice.RealmRealtimeAccountLease) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("Runtime realtime service is closed")
	}
	if s.remote != nil && s.remote.lease.AccountID == lease.AccountID && s.remote.lease.Generation == lease.Generation {
		return nil
	}
	if s.remote != nil {
		s.remote.cancel()
		s.remote.driver.Close()
	}
	connectionCtx, cancel := context.WithCancel(context.Background())
	driver, err := dialSocketIO(connectionCtx, lease.RealmRealtimeURL, lease.AccessToken)
	if err != nil {
		cancel()
		return err
	}
	remote := &realmConnection{
		lease: lease, driver: driver, ctx: connectionCtx, cancel: cancel,
		presenceRevision: make(map[string]uint64),
	}
	s.remote = remote
	go s.runConnection(remote)
	go func() {
		select {
		case <-lease.Invalidated:
			s.failAccountGeneration(remote)
		case <-connectionCtx.Done():
		}
	}()
	return nil
}

func (s *Service) openRemoteChatSubscription(ctx context.Context, channel *realmChannel, subscription *realmSubscription) error {
	s.mu.Lock()
	remote := s.remote
	s.mu.Unlock()
	if remote == nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REALM_UNAVAILABLE)
	}
	remote.openMu.Lock()
	defer remote.openMu.Unlock()
	subscription.mu.Lock()
	subscription.remoteOpening = true
	subscription.mu.Unlock()
	defer func() {
		subscription.mu.Lock()
		subscription.remoteOpening = false
		subscription.mu.Unlock()
	}()
	operationCtx, cancel := context.WithTimeout(ctx, realmOperationTimeout)
	defer cancel()
	event, payload := "chat:session.open", map[string]any{"chatId": subscription.chatID}
	if subscription.kind == realmSubscriptionInbox {
		event, payload = "chat:inbox.open", map[string]any{}
	}
	response, err := s.emitRemoteAck(operationCtx, event, payload)
	if err != nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REALM_UNAVAILABLE)
	}
	if response.Status != "opened" {
		return realmOperationError(response)
	}
	if strings.TrimSpace(response.SessionID) == "" {
		return grpcerr.WithReasonCode(codes.DataLoss, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	subscription.mu.Lock()
	if subscription.remoteSessionID == "" {
		subscription.remoteSessionID = strings.TrimSpace(response.SessionID)
	}
	subscription.mu.Unlock()
	if subscription.kind == realmSubscriptionInbox {
		_ = subscription.stream.Transition(channel.generation, realtimecore.LifecycleReady)
		if err := s.publishControl(channel, subscription, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_READY, "refresh-chat-list"); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) emitRemoteAck(ctx context.Context, event string, payload any) (wireOperationResult, error) {
	s.mu.Lock()
	remote := s.remote
	s.mu.Unlock()
	if remote == nil || remote.driver == nil {
		return wireOperationResult{}, errSocketClosed
	}
	raw, err := remote.driver.EmitAck(ctx, event, payload)
	if err != nil {
		return wireOperationResult{}, err
	}
	var result wireOperationResult
	if err := decodeStrictJSON(raw, &result); err != nil || strings.TrimSpace(result.Status) == "" {
		return wireOperationResult{}, errSocketProtocol
	}
	return result, nil
}

func (s *Service) authorizeChannel(ctx context.Context, channelID string) (*realmChannel, error) {
	appID, appSessionID, err := realtimeCaller(ctx)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	channel := s.channels[strings.TrimSpace(channelID)]
	s.mu.Unlock()
	if channel == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_REALM_NOT_FOUND)
	}
	lease, err := s.accounts.BindRealmRealtimeAccount(ctx)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	channel.mu.Lock()
	valid := !channel.closed && channel.appID == appID && channel.appSessionID == appSessionID && channel.accountID == lease.AccountID && channel.accountGeneration == lease.Generation
	channel.mu.Unlock()
	if !valid {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	return channel, nil
}

func realtimeCaller(ctx context.Context) (string, string, error) {
	if decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); ok {
		sessionID := hex.EncodeToString(decision.SessionID[:])
		if strings.TrimSpace(decision.AppID) == "" || sessionID == "" {
			return "", "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
		}
		return strings.TrimSpace(decision.AppID), sessionID, nil
	}
	md, _ := metadata.FromIncomingContext(ctx)
	appIDs := md.Get("x-nimi-app-id")
	if len(appIDs) != 1 || strings.TrimSpace(appIDs[0]) == "" {
		return "", "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	appSessionIDs := md.Get("x-nimi-session-id")
	appSessionID := "desktop-account-session"
	if len(appSessionIDs) == 1 && strings.TrimSpace(appSessionIDs[0]) != "" {
		appSessionID = strings.TrimSpace(appSessionIDs[0])
	}
	return strings.TrimSpace(appIDs[0]), appSessionID, nil
}

func channelSubscription(channel *realmChannel, subscriptionID string) (*realmSubscription, error) {
	channel.mu.Lock()
	defer channel.mu.Unlock()
	subscription := channel.subscriptions[strings.TrimSpace(subscriptionID)]
	if channel.closed || subscription == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_REALM_NOT_FOUND)
	}
	return subscription, nil
}

func (s *Service) removeSubscription(channel *realmChannel, subscription *realmSubscription, reason realtimecore.TerminalReason) {
	if channel == nil || subscription == nil {
		return
	}
	channel.mu.Lock()
	if channel.subscriptions[subscription.id] == subscription {
		delete(channel.subscriptions, subscription.id)
	}
	channel.mu.Unlock()
	s.closeRemoteChatSubscription(subscription)
	_ = subscription.stream.Close(channel.generation, reason)
}

func (s *Service) terminalizeSubscription(channel *realmChannel, subscription *realmSubscription, reason realtimecore.TerminalReason) {
	if channel == nil || subscription == nil {
		return
	}
	channel.mu.Lock()
	if channel.subscriptions[subscription.id] == subscription {
		delete(channel.subscriptions, subscription.id)
	}
	channel.mu.Unlock()
	s.closeRemoteChatSubscription(subscription)
	lifecycle := runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_FAILED
	terminal := runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_OWNER_FAILED
	if reason == realtimecore.TerminalSlowConsumer {
		terminal = runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_SLOW_CONSUMER
	} else if reason == realtimecore.TerminalStaleGeneration {
		terminal = runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_STALE_GENERATION
	} else if reason == realtimecore.TerminalCancelled || reason == realtimecore.TerminalRuntimeShutdown {
		lifecycle = runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_CLOSED
		terminal = runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_CANCELLED
	}
	event := subscriptionEvent(channel, subscription)
	event.Event = &runtimev1.SubscribeRealmRealtimeEventsResponse_Control{Control: channelControl(
		channel, subscription.id, lifecycle, realtimecore.BackpressureBlocked, 0,
		realmEventBufferCapacity, terminal, "reopen-subscription",
	)}
	_ = subscription.stream.PublishTerminal(channel.generation, event, reason)
}

func (s *Service) closeRemoteChatSubscription(subscription *realmSubscription) {
	if subscription == nil || (subscription.kind != realmSubscriptionChat && subscription.kind != realmSubscriptionInbox) {
		return
	}
	subscription.mu.Lock()
	chatID, remoteSessionID := subscription.chatID, subscription.remoteSessionID
	subscription.remoteSessionID = ""
	subscription.mu.Unlock()
	if remoteSessionID == "" || (subscription.kind == realmSubscriptionChat && chatID == "") {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), realmOperationTimeout)
	defer cancel()
	event, payload := "chat:session.close", map[string]any{"chatId": chatID, "sessionId": remoteSessionID}
	if subscription.kind == realmSubscriptionInbox {
		event, payload = "chat:inbox.close", map[string]any{"subscriptionId": remoteSessionID}
	}
	_, _ = s.emitRemoteAck(ctx, event, payload)
}

func (s *Service) closeChannel(channel *realmChannel, reason realtimecore.TerminalReason) {
	if channel == nil {
		return
	}
	channel.mu.Lock()
	if channel.closed {
		channel.mu.Unlock()
		return
	}
	channel.closed = true
	subscriptions := make([]*realmSubscription, 0, len(channel.subscriptions))
	for _, subscription := range channel.subscriptions {
		subscriptions = append(subscriptions, subscription)
	}
	channel.subscriptions = make(map[string]*realmSubscription)
	channel.mu.Unlock()
	s.mu.Lock()
	delete(s.channels, channel.channelID)
	s.mu.Unlock()
	for _, subscription := range subscriptions {
		s.closeRemoteChatSubscription(subscription)
		_ = subscription.stream.Close(channel.generation, reason)
	}
}

func (s *Service) publishControl(channel *realmChannel, subscription *realmSubscription, lifecycle runtimev1.RealtimeLifecycle, actionHint string) error {
	snapshot := subscription.stream.Snapshot()
	event := subscriptionEvent(channel, subscription)
	event.Event = &runtimev1.SubscribeRealmRealtimeEventsResponse_Control{Control: channelControl(
		channel, subscription.id, lifecycle, snapshot.Backpressure, snapshot.BufferedItems,
		snapshot.Config.Capacity, runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_UNSPECIFIED, actionHint,
	)}
	if _, err := subscription.stream.Publish(channel.generation, event); err != nil {
		return grpcerr.WrapWithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_REALM_OPERATION_FAILED, err, grpcerr.ReasonOptions{})
	}
	return nil
}

func realmSubscriptionEventTerminal(event *runtimev1.SubscribeRealmRealtimeEventsResponse) bool {
	control := event.GetControl()
	return control != nil && control.GetTerminalReason() != runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_UNSPECIFIED
}

func subscriptionEvent(channel *realmChannel, subscription *realmSubscription) *runtimev1.SubscribeRealmRealtimeEventsResponse {
	subscription.mu.Lock()
	subscription.sequence++
	sequence := subscription.sequence
	subscription.mu.Unlock()
	return &runtimev1.SubscribeRealmRealtimeEventsResponse{
		RealtimeSessionId: channel.realtimeSessionID, ChannelId: channel.channelID,
		SubscriptionId: subscription.id, Generation: channel.generation, Sequence: sequence,
		CorrelationId: ulid.Make().String(), OccurredAt: timestamppb.Now(),
	}
}

func channelControl(channel *realmChannel, subscriptionID string, lifecycle runtimev1.RealtimeLifecycle, pressure realtimecore.Backpressure, buffered int, capacity int, terminal runtimev1.RealtimeTerminalReason, actionHint string) *runtimev1.RealtimeControlStatus {
	backpressure := runtimev1.RealtimeBackpressureState_REALTIME_BACKPRESSURE_STATE_NORMAL
	if pressure == realtimecore.BackpressurePressured {
		backpressure = runtimev1.RealtimeBackpressureState_REALTIME_BACKPRESSURE_STATE_PRESSURED
	} else if pressure == realtimecore.BackpressureBlocked {
		backpressure = runtimev1.RealtimeBackpressureState_REALTIME_BACKPRESSURE_STATE_BLOCKED
	}
	return &runtimev1.RealtimeControlStatus{
		RealtimeSessionId: channel.realtimeSessionID, ChannelId: channel.channelID,
		SubscriptionId: subscriptionID, AdapterKind: runtimev1.RealtimeAdapterKind_REALTIME_ADAPTER_KIND_REALM,
		Lifecycle: lifecycle, Generation: channel.generation, CorrelationId: ulid.Make().String(),
		Backpressure: backpressure, BufferedItems: uint32(max(0, buffered)), BufferCapacity: uint32(max(0, capacity)),
		TerminalReason: terminal, ActionHint: actionHint, OccurredAt: timestamppb.Now(),
	}
}

func (s *Service) sendTerminalControl(stream runtimev1.RuntimeRealmRealtimeService_SubscribeRealmRealtimeEventsServer, channel *realmChannel, subscription *realmSubscription) error {
	snapshot := subscription.stream.Snapshot()
	lifecycle := runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_CLOSED
	terminal := runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_CANCELLED
	if snapshot.Lifecycle == realtimecore.LifecycleFailed {
		lifecycle = runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_FAILED
		terminal = runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_OWNER_FAILED
		if snapshot.TerminalReason == realtimecore.TerminalSlowConsumer {
			terminal = runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_SLOW_CONSUMER
		} else if snapshot.TerminalReason == realtimecore.TerminalStaleGeneration {
			terminal = runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_STALE_GENERATION
		}
	} else if snapshot.TerminalReason == realtimecore.TerminalRuntimeShutdown {
		terminal = runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_RUNTIME_SHUTDOWN
	}
	event := subscriptionEvent(channel, subscription)
	event.Event = &runtimev1.SubscribeRealmRealtimeEventsResponse_Control{Control: channelControl(channel, subscription.id, lifecycle, snapshot.Backpressure, 0, snapshot.Config.Capacity, terminal, "reopen-channel")}
	return stream.Send(event)
}

func (s *Service) fetchChatSnapshot(ctx context.Context, lease accountservice.RealmRealtimeAccountLease, chatID string) (output *runtimev1.RealmChatSnapshot, resultErr error) {
	target, err := url.Parse(lease.RealmBaseURL + "/api/human/chats/" + url.PathEscape(chatID) + "/sync")
	if err != nil {
		return nil, err
	}
	query := target.Query()
	query.Set("afterSeq", "0")
	query.Set("limit", "200")
	query.Set("mode", "full")
	target.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("authorization", "Bearer "+lease.AccessToken)
	response, err := s.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := response.Body.Close(); resultErr == nil && err != nil {
			output = nil
			resultErr = fmt.Errorf("close Realm Chat snapshot response: %w", err)
		}
	}()
	limited := io.LimitReader(response.Body, realmHTTPResponseMax+1)
	body, err := io.ReadAll(limited)
	if err != nil || len(body) > realmHTTPResponseMax {
		return nil, fmt.Errorf("Realm Chat snapshot response is unavailable")
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Realm Chat snapshot returned HTTP %d", response.StatusCode)
	}
	var result wireChatSnapshotResult
	if err := decodeStrictJSON(body, &result); err != nil {
		return nil, fmt.Errorf("Realm Chat snapshot contract is invalid")
	}
	return convertWireSnapshot(result)
}

func parseOperationResult(raw json.RawMessage) (wireOperationResult, error) {
	var result wireOperationResult
	if err := decodeStrictJSON(raw, &result); err != nil {
		return wireOperationResult{}, err
	}
	return result, nil
}

func realmOperationError(result wireOperationResult) error {
	reason, code := runtimev1.ReasonCode_REALM_UNAVAILABLE, codes.Unavailable
	switch strings.TrimSpace(result.ReasonCode) {
	case "CHAT_AUTH_REQUIRED":
		reason, code = runtimev1.ReasonCode_AUTH_TOKEN_INVALID, codes.Unauthenticated
	case "CHAT_SESSION_INVALID", "CHAT_NOT_FOUND", "CHAT_TARGET_NOT_FOUND":
		reason, code = runtimev1.ReasonCode_REALM_NOT_FOUND, codes.NotFound
	case "CHAT_TARGET_RESTRICTED", "CHAT_ACCESS_DENIED", "CHAT_FORBIDDEN":
		reason, code = runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN, codes.PermissionDenied
	case "CHAT_CONTRACT_INVALID", "CHAT_ACK_OUT_OF_RANGE", "CHAT_SYNC_CURSOR_INVALID":
		reason, code = runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, codes.InvalidArgument
	}
	return grpcerr.WithReasonCodeOptions(code, reason, grpcerr.ReasonOptions{
		ActionHint: strings.TrimSpace(result.ActionHint),
		TraceID:    strings.TrimSpace(result.TraceID),
	})
}
