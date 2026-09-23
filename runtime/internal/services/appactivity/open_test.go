package appactivity

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
)

type fakeOpenStream struct {
	grpc.ServerStream
	ctx    context.Context
	events chan *runtimev1.OpenAppActivityResponse
}

func (stream *fakeOpenStream) Context() context.Context { return stream.ctx }
func (stream *fakeOpenStream) Send(event *runtimev1.OpenAppActivityResponse) error {
	stream.events <- event
	return nil
}

type fakeOpenRequestStream struct {
	grpc.ServerStream
	ctx        context.Context
	deliveries chan *runtimev1.SubscribeAppActivityOpenRequestsResponse
}

func (stream *fakeOpenRequestStream) Context() context.Context { return stream.ctx }
func (stream *fakeOpenRequestStream) Send(event *runtimev1.SubscribeAppActivityOpenRequestsResponse) error {
	stream.deliveries <- event
	return nil
}

func (harness *testHarness) open(activityID string, session byte) (*fakeOpenStream, context.CancelFunc, chan error) {
	return harness.openWith(harness.ctx(localappop.OperationAppActivityOpen, "acct-1", "subject-b", session), activityID)
}

func (harness *testHarness) openWith(consumer context.Context, activityID string) (*fakeOpenStream, context.CancelFunc, chan error) {
	ctx, cancel := context.WithCancel(consumer)
	stream := &fakeOpenStream{ctx: ctx, events: make(chan *runtimev1.OpenAppActivityResponse, 4)}
	done := make(chan error, 1)
	go func() {
		done <- harness.service.OpenAppActivity(&runtimev1.OpenAppActivityRequest{ActivityId: activityID}, stream)
	}()
	return stream, cancel, done
}

func (harness *testHarness) sourceSubscribe(account string, session byte) (*fakeOpenRequestStream, context.CancelFunc) {
	ctx, cancel := context.WithCancel(harness.ctx(localappop.OperationAppActivityOpenRequestSubscribe, account, "subject-a", session))
	stream := &fakeOpenRequestStream{ctx: ctx, deliveries: make(chan *runtimev1.SubscribeAppActivityOpenRequestsResponse, 4)}
	go func() {
		_ = harness.service.SubscribeAppActivityOpenRequests(&runtimev1.SubscribeAppActivityOpenRequestsRequest{}, stream)
	}()
	return stream, cancel
}

func (harness *testHarness) complete(deliveryID string, account string, session byte, completion runtimev1.AppActivityOpenCompletion) bool {
	harness.t.Helper()
	response, err := harness.service.CompleteAppActivityOpenRequest(
		harness.ctx(localappop.OperationAppActivityOpenRequestComplete, account, "subject-a", session),
		&runtimev1.CompleteAppActivityOpenRequestRequest{DeliveryId: deliveryID, Completion: completion},
	)
	if err != nil {
		harness.t.Fatalf("complete: %v", err)
	}
	return response.GetAccepted()
}

func receive[T any](t *testing.T, channel chan T) T {
	t.Helper()
	select {
	case value := <-channel:
		return value
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for stream value")
		var zero T
		return zero
	}
}

func desktopCtx(harness *testHarness, account string) context.Context {
	ctx := harness.ctx(localappop.OperationAppActivityOpen, account, "subject-desktop", 9)
	decision, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	decision.AppID = "nimi.desktop"
	decision.TrustClass = accountservice.LocalAppTrustClassBuiltIn
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
}

func TestOpenReturnsOpenedOnlyAfterSourceConfirmation(t *testing.T) {
	harness := newHarness(t)
	record := harness.put("acct-1", "subject-a", todo("open-me", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)).GetRecord()
	consumer, cancelConsumer, done := harness.open(record.GetActivityId(), 2)
	defer cancelConsumer()
	pending := receive(t, consumer.events)
	openRequestID := pending.GetOpenRequestId()
	if openRequestID == "" {
		t.Fatalf("first event must carry the Host-private open request id: %+v", pending)
	}
	// Desktop resolves the exact source once, and only for the same account.
	if _, err := harness.service.ResolveAppActivityOpenLaunch(desktopCtx(harness, "acct-2"), &runtimev1.ResolveAppActivityOpenLaunchRequest{OpenRequestId: openRequestID}); reasonOf(err) != codes.NotFound {
		t.Fatalf("foreign account launch resolution must fail, got %v", err)
	}
	launch, err := harness.service.ResolveAppActivityOpenLaunch(desktopCtx(harness, "acct-1"), &runtimev1.ResolveAppActivityOpenLaunchRequest{OpenRequestId: openRequestID})
	if err != nil || launch.GetSourceClass() != runtimev1.AppActivityOpenLaunchSourceClass_APP_ACTIVITY_OPEN_LAUNCH_SOURCE_CLASS_INSTALLED ||
		string(launch.GetLaunchSelector()) != "rar_v1_handle-a" || launch.GetAppId() != "nimi.app-a" {
		t.Fatalf("launch resolution: %v %+v", err, launch)
	}
	if _, err := harness.service.ResolveAppActivityOpenLaunch(desktopCtx(harness, "acct-1"), &runtimev1.ResolveAppActivityOpenLaunchRequest{OpenRequestId: openRequestID}); reasonOf(err) != codes.NotFound {
		t.Fatalf("launch resolution is one-use, got %v", err)
	}
	if _, err := harness.service.ResolveAppActivityOpenLaunch(harness.ctx(localappop.OperationAppActivityOpen, "acct-1", "subject-b", 2), &runtimev1.ResolveAppActivityOpenLaunchRequest{OpenRequestId: openRequestID}); reasonOf(err) != codes.PermissionDenied {
		t.Fatalf("ordinary Apps cannot resolve launch targets, got %v", err)
	}
	// Cold start: the source subscribes only after its handler is ready.
	source, cancelSource := harness.sourceSubscribe("acct-1", 5)
	defer cancelSource()
	delivery := receive(t, source.deliveries)
	if delivery.GetObjectRef() != "draft:open-me" || delivery.GetActivityId() != record.GetActivityId() {
		t.Fatalf("source must receive its own object reference: %+v", delivery)
	}
	if harness.complete(delivery.GetDeliveryId(), "acct-1", 6, runtimev1.AppActivityOpenCompletion_APP_ACTIVITY_OPEN_COMPLETION_OPENED) {
		t.Fatalf("another source session cannot confirm the delivery")
	}
	select {
	case event := <-consumer.events:
		t.Fatalf("no result before the source confirms: %+v", event)
	case <-time.After(50 * time.Millisecond):
	}
	if !harness.complete(delivery.GetDeliveryId(), "acct-1", 5, runtimev1.AppActivityOpenCompletion_APP_ACTIVITY_OPEN_COMPLETION_OPENED) {
		t.Fatalf("delivered source session must be able to confirm")
	}
	result := receive(t, consumer.events).GetResult()
	if result.GetOutcome() != runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_OPENED {
		t.Fatalf("expected opened, got %+v", result)
	}
	if err := receive(t, done); err != nil {
		t.Fatalf("open stream error: %v", err)
	}
	if harness.complete(delivery.GetDeliveryId(), "acct-1", 5, runtimev1.AppActivityOpenCompletion_APP_ACTIVITY_OPEN_COMPLETION_OPENED) {
		t.Fatalf("a resolved request cannot be confirmed twice")
	}
}

func TestOpenCancellationAndTimeoutNeverReportOpened(t *testing.T) {
	harness := newHarness(t)
	record := harness.put("acct-1", "subject-a", todo("cancel-me", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)).GetRecord()
	source, cancelSource := harness.sourceSubscribe("acct-1", 5)
	defer cancelSource()
	// Account mismatch: a source session of another account never receives it.
	otherAccount, cancelOther := harness.sourceSubscribe("acct-2", 7)
	defer cancelOther()
	consumer, cancelConsumer, done := harness.open(record.GetActivityId(), 2)
	receive(t, consumer.events)
	delivery := receive(t, source.deliveries)
	select {
	case wrong := <-otherAccount.deliveries:
		t.Fatalf("delivery crossed accounts: %+v", wrong)
	default:
	}
	cancelConsumer()
	if err := receive(t, done); err != nil {
		t.Fatalf("cancelled consumer must end quietly: %v", err)
	}
	if harness.complete(delivery.GetDeliveryId(), "acct-1", 5, runtimev1.AppActivityOpenCompletion_APP_ACTIVITY_OPEN_COMPLETION_OPENED) {
		t.Fatalf("late confirmation after consumer cancellation must not be accepted")
	}
	// Deadline without confirmation reports failed/source-not-ready.
	var wg sync.WaitGroup
	timed, cancelTimed, timedDone := harness.open(record.GetActivityId(), 3)
	defer cancelTimed()
	receive(t, timed.events)
	late := receive(t, source.deliveries)
	wg.Add(1)
	go func() {
		defer wg.Done()
		harness.advance(OpenRequestTimeout + time.Second)
	}()
	wg.Wait()
	// The broker deadline is enforced on confirmation even before the timer fires.
	if harness.complete(late.GetDeliveryId(), "acct-1", 5, runtimev1.AppActivityOpenCompletion_APP_ACTIVITY_OPEN_COMPLETION_OPENED) {
		t.Fatalf("confirmation after the deadline must not be accepted")
	}
	cancelTimed()
	<-timedDone
}

func TestOpenReportsUnavailableForUnopenableAndMissingSources(t *testing.T) {
	harness := newHarness(t)
	activity := todo("plain", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_UNSPECIFIED)
	activity.Kind = runtimev1.AppActivityKind_APP_ACTIVITY_KIND_ACTIVITY
	activity.ObjectRef = ""
	plain := harness.put("acct-1", "subject-a", activity).GetRecord()
	stream, cancel, done := harness.open(plain.GetActivityId(), 2)
	defer cancel()
	if result := receive(t, stream.events).GetResult(); result.GetReason() != runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_NOT_OPENABLE {
		t.Fatalf("activity without object must be not-openable: %+v", result)
	}
	<-done
	withObject := harness.put("acct-1", "subject-a", todo("gone", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)).GetRecord()
	harness.registrations.set("subject-a", SourceFacts{AppID: "nimi.app-a", DisplayName: "App A", Active: false, SourceClass: SourceClassUserImported})
	removed, cancelRemoved, removedDone := harness.open(withObject.GetActivityId(), 2)
	defer cancelRemoved()
	if result := receive(t, removed.events).GetResult(); result.GetReason() != runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_SOURCE_UNAVAILABLE {
		t.Fatalf("removed source must be unavailable: %+v", result)
	}
	<-removedDone
	list, _ := harness.service.ListAppActivities(harness.ctx(localappop.OperationAppActivityList, "acct-1", "subject-b", 2), &runtimev1.ListAppActivitiesRequest{})
	for _, record := range list.GetRecords() {
		if record.GetActivityId() == withObject.GetActivityId() && record.GetSource().GetAvailable() {
			t.Fatalf("removed source must project as unavailable while its summary stays readable")
		}
	}
	missing, cancelMissing, missingDone := harness.open("act_01MISSINGMISSINGMISSINGMISS", 2)
	defer cancelMissing()
	if result := receive(t, missing.events).GetResult(); result.GetReason() != runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_ACTIVITY_UNAVAILABLE {
		t.Fatalf("unknown activity must be unavailable: %+v", result)
	}
	<-missingDone
}

// fakeRevalidator re-admits a session unless it was revoked.
type fakeRevalidator struct {
	mu      sync.Mutex
	revoked map[byte]bool
}

func (revalidator *fakeRevalidator) AuthorizeLocalAppIngress(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	revalidator.mu.Lock()
	defer revalidator.mu.Unlock()
	if !ok || revalidator.revoked[decision.SessionID[0]] {
		return nil, errors.New("session revoked")
	}
	return ctx, nil
}

func (revalidator *fakeRevalidator) revoke(session byte) {
	revalidator.mu.Lock()
	defer revalidator.mu.Unlock()
	revalidator.revoked[session] = true
}

func expectOpenResult(t *testing.T, stream *fakeOpenStream, outcome runtimev1.AppActivityOpenOutcome, reason runtimev1.AppActivityOpenReason) {
	t.Helper()
	result := receive(t, stream.events).GetResult()
	if result.GetOutcome() != outcome || result.GetReason() != reason {
		t.Fatalf("expected %v/%v, got %+v", outcome, reason, result)
	}
}

func TestOpenConfirmationRevalidatesTheConsumerSession(t *testing.T) {
	harness := newHarness(t)
	revalidator := &fakeRevalidator{revoked: map[byte]bool{}}
	harness.service.SetIngressRevalidator(revalidator)
	record := harness.put("acct-1", "subject-a", todo("session", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)).GetRecord()
	source, cancelSource := harness.sourceSubscribe("acct-1", 5)
	defer cancelSource()

	// The consumer session expires after delivery but before the deadline.
	short := harness.ctx(localappop.OperationAppActivityOpen, "acct-1", "subject-b", 2)
	decision, _ := accountservice.AuthorizedLocalAppDecisionFromContext(short)
	decision.ExpiresAt = harness.clock().Add(10 * time.Second)
	expiring, cancelExpiring, expiringDone := harness.openWith(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), record.GetActivityId())
	defer cancelExpiring()
	receive(t, expiring.events)
	delivery := receive(t, source.deliveries)
	harness.advance(20 * time.Second)
	if harness.complete(delivery.GetDeliveryId(), "acct-1", 5, runtimev1.AppActivityOpenCompletion_APP_ACTIVITY_OPEN_COMPLETION_OPENED) {
		t.Fatalf("confirmation for an expired consumer session must not be accepted")
	}
	expectOpenResult(t, expiring, runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_FAILED, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_CANCELED)
	<-expiringDone

	// A revoked consumer session is rejected at completion.
	revoked, cancelRevoked, revokedDone := harness.open(record.GetActivityId(), 3)
	defer cancelRevoked()
	receive(t, revoked.events)
	second := receive(t, source.deliveries)
	revalidator.revoke(3)
	if harness.complete(second.GetDeliveryId(), "acct-1", 5, runtimev1.AppActivityOpenCompletion_APP_ACTIVITY_OPEN_COMPLETION_OPENED) {
		t.Fatalf("confirmation for a revoked consumer session must not be accepted")
	}
	expectOpenResult(t, revoked, runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_FAILED, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_CANCELED)
	<-revokedDone

	// A request whose consumer session was revoked before the source became
	// ready is never delivered.
	cancelSource()
	late, cancelLate, lateDone := harness.open(record.GetActivityId(), 4)
	defer cancelLate()
	receive(t, late.events)
	revalidator.revoke(4)
	cold, cancelCold := harness.sourceSubscribe("acct-1", 6)
	defer cancelCold()
	expectOpenResult(t, late, runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_FAILED, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_CANCELED)
	<-lateDone
	select {
	case delivered := <-cold.deliveries:
		t.Fatalf("a request of a lost consumer session must not be delivered: %+v", delivered)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestOpenConfirmationRevalidatesTheRecord(t *testing.T) {
	harness := newHarness(t)
	record := harness.put("acct-1", "subject-a", todo("gone", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)).GetRecord()
	source, cancelSource := harness.sourceSubscribe("acct-1", 5)
	defer cancelSource()

	// The record is removed after delivery.
	removed, cancelRemoved, removedDone := harness.open(record.GetActivityId(), 2)
	defer cancelRemoved()
	receive(t, removed.events)
	delivery := receive(t, source.deliveries)
	if err := harness.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		return removeRecordsTx(context.Background(), tx, "acct-1", []string{record.GetActivityId()}, false, harness.clock().UnixMilli())
	}); err != nil {
		t.Fatalf("remove record: %v", err)
	}
	if harness.complete(delivery.GetDeliveryId(), "acct-1", 5, runtimev1.AppActivityOpenCompletion_APP_ACTIVITY_OPEN_COMPLETION_OPENED) {
		t.Fatalf("confirmation for a removed record must not be accepted")
	}
	expectOpenResult(t, removed, runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_UNAVAILABLE, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_ACTIVITY_UNAVAILABLE)
	<-removedDone

	// The record now points at another object than the delivered one.
	moved := harness.put("acct-1", "subject-a", todo("moved", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)).GetRecord()
	stale, cancelStale, staleDone := harness.open(moved.GetActivityId(), 2)
	defer cancelStale()
	receive(t, stale.events)
	staleDelivery := receive(t, source.deliveries)
	revised := todo("moved", 2, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)
	revised.ObjectRef = "draft:elsewhere"
	harness.put("acct-1", "subject-a", revised)
	if harness.complete(staleDelivery.GetDeliveryId(), "acct-1", 5, runtimev1.AppActivityOpenCompletion_APP_ACTIVITY_OPEN_COMPLETION_OPENED) {
		t.Fatalf("confirmation for a stale object must not be accepted")
	}
	expectOpenResult(t, stale, runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_UNAVAILABLE, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_ACTIVITY_UNAVAILABLE)
	<-staleDone

	// A source registration lost after delivery reports the source unavailable.
	current := harness.put("acct-1", "subject-a", todo("source", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)).GetRecord()
	lost, cancelLost, lostDone := harness.open(current.GetActivityId(), 2)
	defer cancelLost()
	receive(t, lost.events)
	lostDelivery := receive(t, source.deliveries)
	harness.registrations.set("subject-a", SourceFacts{AppID: "nimi.app-a", DisplayName: "App A", Active: false, SourceClass: SourceClassUserImported})
	if harness.complete(lostDelivery.GetDeliveryId(), "acct-1", 5, runtimev1.AppActivityOpenCompletion_APP_ACTIVITY_OPEN_COMPLETION_OPENED) {
		t.Fatalf("confirmation after source registration loss must not be accepted")
	}
	expectOpenResult(t, lost, runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_UNAVAILABLE, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_SOURCE_UNAVAILABLE)
	<-lostDone
}
