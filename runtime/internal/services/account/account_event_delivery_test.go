package account

import (
	"math"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestAccountEventReplayCursorComparisonDoesNotOverflow(t *testing.T) {
	service := newHarnessService(t, nil)
	completeLogin(t, service)

	replay, snapshot, subscriber := service.subscribe(&runtimev1.SubscribeAccountSessionEventsRequest{
		AfterSequence: math.MaxUint64,
	})
	defer service.removeSubscriber(subscriber.id)

	if len(replay) != 0 || snapshot.GetReplayTruncated() {
		t.Fatalf("max cursor replay=%d truncated=%t", len(replay), snapshot.GetReplayTruncated())
	}
}

func TestAccountEventReplaySnapshotAndLiveSequenceContract(t *testing.T) {
	service := newHarnessService(t, nil, WithEventRetention(16))
	completeLogin(t, service)
	service.mu.RLock()
	retained := append([]*runtimev1.AccountSessionEvent(nil), service.events...)
	service.mu.RUnlock()
	if len(retained) < 2 {
		t.Fatalf("precondition: retained events = %d", len(retained))
	}
	after := retained[0].GetSequence()
	replay, snapshot, subscriber := service.subscribe(&runtimev1.SubscribeAccountSessionEventsRequest{AfterSequence: after})
	defer service.removeSubscriber(subscriber.id)
	if len(replay) != len(retained)-1 {
		t.Fatalf("replay length = %d, want %d", len(replay), len(retained)-1)
	}
	lastSequence := after
	for _, event := range replay {
		if event.GetDeliveryKind() != runtimev1.AccountSessionDeliveryKind_ACCOUNT_SESSION_DELIVERY_KIND_REPLAY ||
			event.GetSequence() <= lastSequence {
			t.Fatalf("replay order/delivery = %+v after %d", event, lastSequence)
		}
		lastSequence = event.GetSequence()
	}
	if snapshot.GetDeliveryKind() != runtimev1.AccountSessionDeliveryKind_ACCOUNT_SESSION_DELIVERY_KIND_SNAPSHOT ||
		snapshot.GetSequence() != lastSequence || snapshot.GetSnapshot().GetSequence() != snapshot.GetSequence() {
		t.Fatalf("snapshot after replay = %+v last=%d", snapshot, lastSequence)
	}

	service.mu.Lock()
	service.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED)
	service.mu.Unlock()
	received := <-subscriber.ch
	if received.GetDeliveryKind() != runtimev1.AccountSessionDeliveryKind_ACCOUNT_SESSION_DELIVERY_KIND_LIVE ||
		received.GetSequence() <= snapshot.GetSequence() || received.GetSnapshot().GetSequence() != received.GetSequence() {
		t.Fatalf("live event after snapshot = %+v snapshot=%d", received, snapshot.GetSequence())
	}
}

func TestAccountEventSubscriberOverflowClosesInsteadOfSilentlyDropping(t *testing.T) {
	service := newHarnessService(t, nil)
	_, _, subscriber := service.subscribe(&runtimev1.SubscribeAccountSessionEventsRequest{})

	for index := 0; index <= cap(subscriber.ch); index++ {
		service.mu.Lock()
		service.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED)
		service.mu.Unlock()
	}
	service.mu.RLock()
	_, registered := service.subscribers[subscriber.id]
	service.mu.RUnlock()
	if registered {
		t.Fatal("overflowed subscriber remained registered")
	}
	for range subscriber.ch {
	}
}

func TestStoredAccountEventsDeliverAtomicallyInSequence(t *testing.T) {
	service := newHarnessService(t, nil, WithEventRetention(16))
	_, snapshot, subscriber := service.subscribe(&runtimev1.SubscribeAccountSessionEventsRequest{})
	defer service.removeSubscriber(subscriber.id)

	const eventCount = 8
	var wait sync.WaitGroup
	wait.Add(eventCount)
	for range eventCount {
		go func() {
			defer wait.Done()
			service.mu.Lock()
			service.appendEventLocked(
				runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS,
				runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
			)
			service.mu.Unlock()
		}()
	}
	wait.Wait()

	last := snapshot.GetSequence()
	for range eventCount {
		event, ok := <-subscriber.ch
		if !ok {
			t.Fatal("subscriber closed during bounded concurrent delivery")
		}
		if event.GetSequence() != last+1 {
			t.Fatalf("event sequence = %d, want %d", event.GetSequence(), last+1)
		}
		last = event.GetSequence()
	}
}
