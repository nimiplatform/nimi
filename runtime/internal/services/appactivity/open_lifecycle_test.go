package appactivity

import (
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestRemoteParticipantOpensOnlyTheNewestOnlineSourceWithoutLaunch(t *testing.T) {
	for _, remoteSource := range []bool{false, true} {
		h := newHarness(t)
		if remoteSource {
			h.registrations.set("subject-a", SourceFacts{AppID: "nimi.app-a", Active: true, SourceClass: SourceClassRemote})
		}
		record := h.put("acct-1", "subject-a", todo("remote-open", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)).GetRecord()
		consumerCtx := h.ctx(localappop.OperationAppActivityOpen, "acct-1", "subject-b", 2)
		if !remoteSource {
			decision, _ := accountservice.AuthorizedLocalAppDecisionFromContext(consumerCtx)
			decision.TrustClass = accountservice.LocalAppTrustClassRemote
			consumerCtx = accountservice.ContextWithAuthorizedLocalAppDecision(consumerCtx, decision)
		}
		// No online source: resolve now, never hold a future browser navigation.
		absent, stopAbsent, absentDone := h.openWith(consumerCtx, record.GetActivityId())
		expectOpenResult(t, absent, runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_UNAVAILABLE, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_SOURCE_UNAVAILABLE)
		if err := receive(t, absentDone); err != nil {
			t.Fatal(err)
		}
		stopAbsent()
		old, stopOld := h.sourceSubscribe("acct-1", 5)
		defer stopOld()
		receive(t, old.established)
		latest, stopLatest := h.sourceSubscribe("acct-1", 6)
		defer stopLatest()
		receive(t, latest.established)
		consumer, stopConsumer, done := h.openWith(consumerCtx, record.GetActivityId())
		defer stopConsumer()
		delivery := receive(t, latest.deliveries)
		select {
		case event := <-consumer.events:
			t.Fatalf("unexpected native launch or early success: %+v", event)
		default:
		}
		select {
		case <-old.deliveries:
			t.Fatal("older subscriber received a navigation")
		default:
		}
		if h.complete(delivery.GetDeliveryId(), "acct-1", 5, runtimev1.AppActivityOpenCompletion_APP_ACTIVITY_OPEN_COMPLETION_OPENED) {
			t.Fatal("wrong source session completed navigation")
		}
		h.service.opens.mu.Lock()
		request := h.service.opens.deliveries[delivery.GetDeliveryId()]
		id := request.id
		h.service.opens.mu.Unlock()
		if h.service.opens.resolveLaunch(id, "acct-1") != nil {
			t.Fatal("online-only request became a launch target")
		}
		if !h.complete(delivery.GetDeliveryId(), "acct-1", 6, runtimev1.AppActivityOpenCompletion_APP_ACTIVITY_OPEN_COMPLETION_OPENED) {
			t.Fatal("live source could not confirm its navigation")
		}
		expectOpenResult(t, consumer, runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_OPENED, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_OPENED)
		if err := receive(t, done); err != nil {
			t.Fatal(err)
		}
	}
}

func TestOpenCancelsAfterSourceSubscriptionLossWithoutReplay(t *testing.T) {
	h := newHarness(t)
	record := h.put("acct-1", "subject-a", todo("source-session", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)).GetRecord()
	source, stopSource := h.sourceSubscribe("acct-1", 5)
	defer stopSource()
	consumer, stopConsumer, done := h.open(record.GetActivityId(), 2)
	defer stopConsumer()
	receive(t, consumer.events)
	first := receive(t, source.deliveries)
	stopSource()
	expectOpenResult(t, consumer, runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_FAILED, runtimev1.AppActivityOpenReason_APP_ACTIVITY_OPEN_REASON_CANCELED)
	if err := receive(t, done); err != nil {
		t.Fatal(err)
	}
	if h.complete(first.GetDeliveryId(), "acct-1", 5, runtimev1.AppActivityOpenCompletion_APP_ACTIVITY_OPEN_COMPLETION_OPENED) {
		t.Fatal("lost source subscription must not confirm its old delivery")
	}
	rebound, stopRebound := h.sourceSubscribe("acct-1", 6)
	defer stopRebound()
	select {
	case replay := <-rebound.deliveries:
		t.Fatalf("navigation replayed across source sessions: %+v", replay)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestLaunchResolutionRevalidatesThePendingRequest(t *testing.T) {
	for _, scenario := range []string{"source-removed", "consumer-revoked", "deadline"} {
		t.Run(scenario, func(t *testing.T) {
			h := newHarness(t)
			revalidator := &fakeRevalidator{revoked: map[byte]bool{}}
			h.service.SetIngressRevalidator(revalidator)
			record := h.put("acct-1", "subject-a", todo("launch", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)).GetRecord()
			consumer, cancel, _ := h.open(record.GetActivityId(), 2)
			defer cancel()
			request := receive(t, consumer.events).GetOpenRequestId()
			switch scenario {
			case "source-removed":
				h.registrations.set("subject-a", SourceFacts{AppID: "nimi.app-a", Active: false})
			case "consumer-revoked":
				revalidator.revoke(2)
			case "deadline":
				h.advance(OpenRequestTimeout + time.Second)
			}
			target, err := h.service.ResolveAppActivityOpenLaunch(desktopCtx(h, "acct-1"), &runtimev1.ResolveAppActivityOpenLaunchRequest{OpenRequestId: request})
			if err == nil || target != nil {
				t.Fatalf("invalid request still resolved to a launch target: %+v, %v", target, err)
			}
			if result := receive(t, consumer.events).GetResult(); result.GetOutcome() == runtimev1.AppActivityOpenOutcome_APP_ACTIVITY_OPEN_OUTCOME_OPENED {
				t.Fatalf("invalid request reported opened: %+v", result)
			}
		})
	}
}
