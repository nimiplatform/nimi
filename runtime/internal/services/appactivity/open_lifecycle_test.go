package appactivity

import (
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

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
