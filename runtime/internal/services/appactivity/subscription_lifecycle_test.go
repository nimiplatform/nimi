package appactivity

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

type activityRevalidatorFunc func(context.Context, localappop.Ingress) (context.Context, error)

func (f activityRevalidatorFunc) AuthorizeLocalAppIngress(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
	return f(ctx, ingress)
}

func TestChangeSubscriptionEndsBeforeDeliveringIntoReboundSession(t *testing.T) {
	for _, scenario := range []string{"account-change", "same-account-new-session"} {
		t.Run(scenario, func(t *testing.T) {
			h := newHarness(t)
			var rebound atomic.Bool
			h.service.SetIngressRevalidator(activityRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
				if !rebound.Load() {
					return ctx, nil
				}
				decision, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
				decision.SessionID[0]++
				if scenario == "account-change" {
					decision.AccountID = "acct-2"
				}
				return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
			}))
			h.put("acct-1", "subject-a", todo("before", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
			stream, cancel, done := h.subscribe("acct-1", 0)
			defer cancel()
			stream.waitFor(t, 1)
			rebound.Store(true)
			h.put("acct-1", "subject-a", todo("after", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
			if err := receive(t, done); reasonOf(err) != codes.Unauthenticated {
				t.Fatalf("rebound stream must end with session failure: %v", err)
			}
			stream.mu.Lock()
			defer stream.mu.Unlock()
			if len(stream.events) != 1 {
				t.Fatalf("old-account activity delivered after session replacement: %+v", stream.events)
			}
		})
	}
}

type invalidatingChangeStream struct {
	*fakeChangeStream
	invalidated chan struct{}
}

func (stream *invalidatingChangeStream) Send(event *runtimev1.SubscribeAppActivityChangesResponse) error {
	err := stream.fakeChangeStream.Send(event)
	if !closed(stream.invalidated) {
		close(stream.invalidated)
	}
	return err
}

func TestChangeReplayRevalidatesBetweenItems(t *testing.T) {
	h := newHarness(t)
	h.put("acct-1", "subject-a", todo("a", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
	h.put("acct-1", "subject-a", todo("b", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
	ctx, cancel := context.WithTimeout(h.ctx(localappop.OperationAppActivitySubscribe, "acct-1", "subject-b", 2), time.Second)
	defer cancel()
	decision, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	invalidated := make(chan struct{})
	decision.SessionInvalidated = invalidated
	ctx = accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision)
	stream := &invalidatingChangeStream{fakeChangeStream: newFakeChangeStream(ctx), invalidated: invalidated}
	err := h.service.SubscribeAppActivityChanges(&runtimev1.SubscribeAppActivityChangesRequest{}, stream)
	if reasonOf(err) != codes.Unauthenticated || len(stream.events) != 1 {
		t.Fatalf("replay continued past invalidation: events=%d err=%v", len(stream.events), err)
	}
}
