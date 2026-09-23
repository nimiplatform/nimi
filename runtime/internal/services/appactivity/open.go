package appactivity

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
)

// openRequest is Host-private and memory-only. It never survives a Runtime
// restart and is bound to the consumer session that created it.
type openRequest struct {
	id              string
	deliveryID      string
	accountID       string
	consumerSession string
	// consumerCtx is the consumer's open stream; it is used only to revalidate
	// the consumer session at delivery and completion.
	consumerCtx         context.Context
	consumerExpiresAt   time.Time
	consumerInvalidated <-chan struct{}
	sourceSubject       string
	source              SourceFacts
	activityID          string
	objectRef           string
	activityType        string
	deadline            time.Time
	result              chan *runtimev1.AppActivityOpenResult
	resolved            bool
	launchResolved      bool
	deliveredTo         *openSubscriber
}

type openSubscriber struct {
	id         uint64
	accountID  string
	subject    string
	session    string
	deliveries chan *openRequest
}

type openBroker struct {
	service        *Service
	mu             sync.Mutex
	requests       map[string]*openRequest
	deliveries     map[string]*openRequest
	subscribers    map[uint64]*openSubscriber
	nextSubscriber uint64
	closed         bool
}

func newOpenBroker(service *Service) *openBroker {
	return &openBroker{
		service: service, requests: map[string]*openRequest{}, deliveries: map[string]*openRequest{},
		subscribers: map[uint64]*openSubscriber{},
	}
}

func randomRef(prefix string) (string, error) {
	var buffer [24]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(buffer[:]), nil
}

func (broker *openBroker) create(request *openRequest) error {
	id, err := randomRef("aor_")
	if err != nil {
		return err
	}
	request.id = id
	request.result = make(chan *runtimev1.AppActivityOpenResult, 1)
	broker.mu.Lock()
	if broker.closed {
		broker.mu.Unlock()
		return ErrUnavailable
	}
	broker.requests[id] = request
	broker.mu.Unlock()
	broker.dispatch(request)
	return nil
}

// dispatch delivers an undelivered request to the newest ready subscriber of
// the exact source subject in the same account.
func (broker *openBroker) dispatch(request *openRequest) {
	broker.mu.Lock()
	defer broker.mu.Unlock()
	if broker.closed || request.resolved || request.deliveredTo != nil {
		return
	}
	var target *openSubscriber
	for _, subscriber := range broker.subscribers {
		if subscriber.accountID == request.accountID && subscriber.subject == request.sourceSubject &&
			(target == nil || subscriber.id > target.id) {
			target = subscriber
		}
	}
	if target == nil {
		return
	}
	deliveryID, err := randomRef("aod_")
	if err != nil {
		return
	}
	select {
	case target.deliveries <- request:
		request.deliveredTo = target
		request.deliveryID = deliveryID
		broker.deliveries[deliveryID] = request
	default:
	}
}

func (broker *openBroker) subscribe(accountID, subject, session string) (*openSubscriber, error) {
	broker.mu.Lock()
	if broker.closed {
		broker.mu.Unlock()
		return nil, ErrUnavailable
	}
	broker.nextSubscriber++
	subscriber := &openSubscriber{
		id: broker.nextSubscriber, accountID: accountID, subject: subject, session: session,
		deliveries: make(chan *openRequest, 16),
	}
	broker.subscribers[subscriber.id] = subscriber
	pending := make([]*openRequest, 0)
	for _, request := range broker.requests {
		if !request.resolved && request.deliveredTo == nil && request.accountID == accountID && request.sourceSubject == subject {
			pending = append(pending, request)
		}
	}
	broker.mu.Unlock()
	for _, request := range pending {
		broker.dispatch(request)
	}
	return subscriber, nil
}

// unsubscribe cancels every request assigned to this source subscription.
// A later source session must never replay an earlier navigation request.
func (broker *openBroker) unsubscribe(subscriber *openSubscriber) {
	broker.mu.Lock()
	defer broker.mu.Unlock()
	delete(broker.subscribers, subscriber.id)
	for deliveryID, request := range broker.deliveries {
		if request.deliveredTo == subscriber {
			delete(broker.deliveries, deliveryID)
			broker.resolveLocked(request, openResult(runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_FAILED, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_CANCELED))
		}
	}
}

func (broker *openBroker) resolve(request *openRequest, result *runtimev1.AppActivityOpenResult) bool {
	broker.mu.Lock()
	defer broker.mu.Unlock()
	return broker.resolveLocked(request, result)
}

func (broker *openBroker) resolveLocked(request *openRequest, result *runtimev1.AppActivityOpenResult) bool {
	if request.resolved {
		return false
	}
	request.resolved = true
	delete(broker.requests, request.id)
	if request.deliveryID != "" {
		delete(broker.deliveries, request.deliveryID)
	}
	if result != nil {
		request.result <- result
	}
	return true
}

// delivered returns the unresolved request only to the exact source session it
// was delivered to, before its deadline.
func (broker *openBroker) delivered(deliveryID, accountID, subject, session string, now time.Time) *openRequest {
	broker.mu.Lock()
	defer broker.mu.Unlock()
	request := broker.deliveries[deliveryID]
	if request == nil || request.resolved || request.deliveredTo == nil ||
		request.deliveredTo.session != session || request.accountID != accountID || request.sourceSubject != subject ||
		!now.Before(request.deadline) {
		return nil
	}
	return request
}

func (broker *openBroker) resolveLaunch(openRequestID, accountID string) *openRequest {
	broker.mu.Lock()
	defer broker.mu.Unlock()
	request := broker.requests[openRequestID]
	if request == nil || request.resolved || request.launchResolved || request.accountID != accountID {
		return nil
	}
	request.launchResolved = true
	return request
}

func (broker *openBroker) closeAll() {
	broker.mu.Lock()
	broker.closed = true
	requests := make([]*openRequest, 0, len(broker.requests))
	for _, request := range broker.requests {
		requests = append(requests, request)
	}
	broker.mu.Unlock()
	for _, request := range requests {
		broker.resolve(request, openResult(runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_FAILED, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_CANCELED))
	}
}

func openResult(outcome runtimev1.AppActivityOpenOutcome, reason runtimev1.AppActivityOpenReason) *runtimev1.AppActivityOpenResult {
	return &runtimev1.AppActivityOpenResult{Outcome: outcome, Reason: reason}
}

func closed(signal <-chan struct{}) bool {
	if signal == nil {
		return false
	}
	select {
	case <-signal:
		return true
	default:
		return false
	}
}

// sessionLive reports whether an admitted session is still current: its call
// is live, it has not been invalidated, protected admission still accepts it
// for the same account and session, and it has not expired. Routine renewal
// extends a session in place, so the expiry of the fresh admission wins.
func (s *Service) sessionLive(ctx context.Context, ingress localappop.Ingress, accountID, session string, expiresAt time.Time, invalidated <-chan struct{}) bool {
	if !s.available() || ctx.Err() != nil || closed(invalidated) {
		return false
	}
	if s.revalidator != nil {
		authorized, err := s.revalidator.AuthorizeLocalAppIngress(ctx, ingress)
		if err != nil {
			return false
		}
		decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(authorized)
		if !ok || decision.AccountID != accountID || sessionKey(decision) != session {
			return false
		}
		expiresAt = decision.ExpiresAt
	}
	return expiresAt.IsZero() || s.now().Before(expiresAt)
}

// openRequestFailure revalidates the consumer session, source registration,
// and record an open request is bound to. It returns the typed result that
// resolves a request that is no longer valid, or nil while it still is.
// @nimi-authority: rule.nimi.platform.core-protocol.p-actv-005
func (s *Service) openRequestFailure(ctx context.Context, request *openRequest) *runtimev1.AppActivityOpenResult {
	if !s.now().Before(request.deadline) {
		return openResult(runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_FAILED, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_SOURCE_NOT_READY)
	}
	if !s.sessionLive(request.consumerCtx, localappop.IngressAppActivityOpen, request.accountID, request.consumerSession,
		request.consumerExpiresAt, request.consumerInvalidated) {
		return openResult(runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_FAILED, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_CANCELED)
	}
	source, err := s.registrations.ActivitySource(ctx, request.sourceSubject)
	if err != nil || !source.Active {
		return openResult(runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_UNAVAILABLE, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_SOURCE_UNAVAILABLE)
	}
	record, err := loadRecordByID(ctx, s.backend.DB(), request.accountID, request.activityID)
	if err != nil || record.PublisherKind != publisherKindApp || record.PublisherRef != request.sourceSubject ||
		record.ObjectRef != request.objectRef || record.ActivityType != request.activityType {
		return openResult(runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_UNAVAILABLE, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_ACTIVITY_UNAVAILABLE)
	}
	return nil
}

func sessionKey(decision accountservice.LocalAppCallerDecision) string {
	return hex.EncodeToString(decision.SessionID[:])
}

func sendOpenResult(stream runtimev1.RuntimeAppActivityService_OpenAppActivityServer, result *runtimev1.AppActivityOpenResult) error {
	return stream.Send(&runtimev1.OpenAppActivityResponse{Event: &runtimev1.OpenAppActivityResponse_Result{Result: result}})
}

// @nimi-authority: rule.nimi.platform.core-protocol.p-actv-005
// @nimi-authority: rule.nimi.runtime.app-surface.r103
func (s *Service) OpenAppActivity(req *runtimev1.OpenAppActivityRequest, stream runtimev1.RuntimeAppActivityService_OpenAppActivityServer) error {
	ctx := stream.Context()
	decision, err := s.decision(ctx, localappop.OperationAppActivityOpen)
	if err != nil {
		return err
	}
	if req == nil || !validActivityID(req.GetActivityId()) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_ACTIVITY_INPUT_INVALID)
	}
	record, err := loadRecordByID(ctx, s.backend.DB(), decision.AccountID, req.GetActivityId())
	if errors.Is(err, ErrNotFound) {
		return sendOpenResult(stream, openResult(runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_UNAVAILABLE, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_ACTIVITY_UNAVAILABLE))
	}
	if err != nil {
		return publicError(err)
	}
	if record.PublisherKind != publisherKindApp || record.ObjectRef == "" {
		return sendOpenResult(stream, openResult(runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_UNAVAILABLE, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_NOT_OPENABLE))
	}
	source, err := s.registrations.ActivitySource(ctx, record.PublisherRef)
	if err != nil || !source.Active || !launchableSourceClass(source.SourceClass) || len(source.LaunchSelector) == 0 {
		return sendOpenResult(stream, openResult(runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_UNAVAILABLE, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_SOURCE_UNAVAILABLE))
	}
	request := &openRequest{
		accountID: decision.AccountID, consumerSession: sessionKey(decision),
		consumerCtx: ctx, consumerExpiresAt: decision.ExpiresAt, consumerInvalidated: decision.SessionInvalidated,
		sourceSubject: record.PublisherRef, source: source, activityID: record.ActivityID, objectRef: record.ObjectRef,
		activityType: record.ActivityType, deadline: s.now().Add(OpenRequestTimeout),
	}
	if err := s.opens.create(request); err != nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_ACTIVITY_UNAVAILABLE)
	}
	if err := stream.Send(&runtimev1.OpenAppActivityResponse{Event: &runtimev1.OpenAppActivityResponse_OpenRequestId{OpenRequestId: request.id}}); err != nil {
		s.opens.resolve(request, nil)
		return err
	}
	timer := time.NewTimer(request.deadline.Sub(s.now()))
	defer timer.Stop()
	revalidate := time.NewTicker(time.Second)
	defer revalidate.Stop()
	for {
		select {
		case result := <-request.result:
			return sendOpenResult(stream, result)
		case <-ctx.Done():
			s.opens.resolve(request, nil)
			return nil
		case <-decision.SessionInvalidated:
			s.opens.resolve(request, openResult(runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_FAILED, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_CANCELED))
			return sendOpenResult(stream, <-request.result)
		case <-timer.C:
			s.opens.resolve(request, openResult(runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_FAILED, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_SOURCE_NOT_READY))
			return sendOpenResult(stream, <-request.result)
		case <-revalidate.C:
			// Session loss or an account change cancels the request; nothing
			// is replayed to a later session.
			if failure := s.openRequestFailure(ctx, request); failure != nil {
				s.opens.resolve(request, failure)
				return sendOpenResult(stream, <-request.result)
			}
		}
	}
}

func launchableSourceClass(sourceClass string) bool {
	switch sourceClass {
	case SourceClassVerified, SourceClassUserImported, SourceClassLocalDevelopment:
		return true
	default:
		return false
	}
}

// @nimi-authority: rule.nimi.runtime.app-surface.r103
func (s *Service) SubscribeAppActivityOpenRequests(req *runtimev1.SubscribeAppActivityOpenRequestsRequest, stream runtimev1.RuntimeAppActivityService_SubscribeAppActivityOpenRequestsServer) error {
	ctx := stream.Context()
	decision, err := s.decision(ctx, localappop.OperationAppActivityOpenRequestSubscribe)
	if err != nil {
		return err
	}
	if req == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_ACTIVITY_INPUT_INVALID)
	}
	subscriber, err := s.opens.subscribe(decision.AccountID, decision.RegisteredAppSubject, sessionKey(decision))
	if err != nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_ACTIVITY_UNAVAILABLE)
	}
	defer s.opens.unsubscribe(subscriber)
	// Establish the stream once the subscriber is registered; an idle source App
	// would otherwise hold a half-open subscription until its first request.
	if err := stream.SendHeader(metadata.MD{}); err != nil {
		return err
	}
	revalidate := time.NewTicker(time.Second)
	defer revalidate.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-s.lifecycleCtx.Done():
			return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_ACTIVITY_UNAVAILABLE)
		case <-decision.SessionInvalidated:
			return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
		case request := <-subscriber.deliveries:
			s.opens.mu.Lock()
			deliveryID := request.deliveryID
			live := !request.resolved && request.deliveredTo == subscriber
			s.opens.mu.Unlock()
			if !live {
				continue
			}
			// Losing the source session cancels this delivery through unsubscribe.
			if !s.sessionLive(ctx, localappop.IngressAppActivityOpenRequestSubscribe, decision.AccountID, subscriber.session,
				decision.ExpiresAt, decision.SessionInvalidated) {
				return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
			}
			if failure := s.openRequestFailure(ctx, request); failure != nil {
				s.opens.resolve(request, failure)
				continue
			}
			if err := stream.Send(&runtimev1.SubscribeAppActivityOpenRequestsResponse{
				DeliveryId: deliveryID, ActivityId: request.activityID, ObjectRef: request.objectRef, ActivityType: request.activityType,
			}); err != nil {
				return err
			}
		case <-revalidate.C:
			if !s.sessionLive(ctx, localappop.IngressAppActivityOpenRequestSubscribe, decision.AccountID, subscriber.session,
				decision.ExpiresAt, decision.SessionInvalidated) {
				return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
			}
		}
	}
}

// @nimi-authority: rule.nimi.runtime.app-surface.r103
func (s *Service) CompleteAppActivityOpenRequest(ctx context.Context, req *runtimev1.CompleteAppActivityOpenRequestRequest) (*runtimev1.CompleteAppActivityOpenRequestResponse, error) {
	decision, err := s.decision(ctx, localappop.OperationAppActivityOpenRequestComplete)
	if err != nil {
		return nil, err
	}
	if req == nil || !strings.HasPrefix(req.GetDeliveryId(), "aod_") || !boundedLine(req.GetDeliveryId(), 64) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_ACTIVITY_INPUT_INVALID)
	}
	var result *runtimev1.AppActivityOpenResult
	switch req.GetCompletion() {
	case runtimev1.AppActivityOpenCompletion_APP_ACTIVITY_OPEN_COMPLETION_OPENED:
		result = openResult(runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_OPENED, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_OPENED)
	case runtimev1.AppActivityOpenCompletion_APP_ACTIVITY_OPEN_COMPLETION_OBJECT_UNAVAILABLE:
		result = openResult(runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_UNAVAILABLE, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_OBJECT_UNAVAILABLE)
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_ACTIVITY_INPUT_INVALID)
	}
	request := s.opens.delivered(req.GetDeliveryId(), decision.AccountID, decision.RegisteredAppSubject, sessionKey(decision), s.now())
	if request == nil {
		return &runtimev1.CompleteAppActivityOpenRequestResponse{Accepted: false}, nil
	}
	// The consumer session, source, and record are revalidated at completion;
	// a confirmation for a request that no longer holds resolves it with the
	// typed failure instead of opened.
	if failure := s.openRequestFailure(ctx, request); failure != nil {
		s.opens.resolve(request, failure)
		return &runtimev1.CompleteAppActivityOpenRequestResponse{Accepted: false}, nil
	}
	return &runtimev1.CompleteAppActivityOpenRequestResponse{Accepted: s.opens.resolve(request, result)}, nil
}

// @nimi-authority: rule.nimi.desktop.bridge-ipc.r022
// ResolveAppActivityOpenLaunch accepts only the Desktop built-in formal Host
// session carried by the protected Desktop transport. It resolves each pending
// open request of the same account at most once and never serves another App.
func (s *Service) ResolveAppActivityOpenLaunch(ctx context.Context, req *runtimev1.ResolveAppActivityOpenLaunchRequest) (*runtimev1.ResolveAppActivityOpenLaunchResponse, error) {
	decision, err := s.decision(ctx, localappop.OperationAppActivityOpen)
	if err != nil {
		return nil, err
	}
	if decision.AppID != desktopHostAppID || decision.TrustClass != accountservice.LocalAppTrustClassBuiltIn {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED)
	}
	if req == nil || !strings.HasPrefix(req.GetOpenRequestId(), "aor_") || !boundedLine(req.GetOpenRequestId(), 64) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_ACTIVITY_INPUT_INVALID)
	}
	request := s.opens.resolveLaunch(req.GetOpenRequestId(), decision.AccountID)
	if request == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_APP_ACTIVITY_OPEN_REQUEST_UNAVAILABLE)
	}
	if failure := s.openRequestFailure(ctx, request); failure != nil {
		s.opens.resolve(request, failure)
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_ACTIVITY_OPEN_REQUEST_UNAVAILABLE)
	}
	source := request.source
	response := &runtimev1.ResolveAppActivityOpenLaunchResponse{AppId: source.AppID, LaunchSelector: append([]byte(nil), source.LaunchSelector...)}
	switch source.SourceClass {
	case SourceClassVerified, SourceClassUserImported:
		response.SourceClass = runtimev1.AppActivityOpenLaunchSourceClass_APP_ACTIVITY_OPEN_LAUNCH_SOURCE_CLASS_INSTALLED
	case SourceClassLocalDevelopment:
		response.SourceClass = runtimev1.AppActivityOpenLaunchSourceClass_APP_ACTIVITY_OPEN_LAUNCH_SOURCE_CLASS_LOCAL_DEVELOPMENT
	default:
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_ACTIVITY_OPEN_REQUEST_UNAVAILABLE)
	}
	return response, nil
}

const desktopHostAppID = "nimi.desktop"
