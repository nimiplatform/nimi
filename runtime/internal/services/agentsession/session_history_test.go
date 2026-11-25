package agentsession

import (
	"context"
	"strconv"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func TestCommittedHistoryPages(t *testing.T) {
	svc := newStage2Service(t, Options{})
	caller := func(op localappop.Operation) context.Context {
		return callerCtxWithExactDomains("app.home", "subj-home", DomainAgentLocal, op, DomainAgentLocal+","+DomainAgentSessionManage)
	}
	route, err := svc.RouteAndSubmitInput(caller(localappop.OperationAgentSessionRouteSubmit), &runtimev1.RouteAndSubmitInputRequest{AgentHandle: "agent-1", RequestId: "sample", Text: "hello", EntrySurface: "home"})
	if err != nil {
		t.Fatal(err)
	}
	ref := route.GetResolvedWorkSessionRef()
	var lastSeq int64
	for i := 0; i < 205; i++ {
		ev, err := svc.store.AppendBrainEvent(context.Background(), "acct-1", ref, "assistant_message", "{}", time.Now())
		if err != nil {
			t.Fatal(err)
		}
		lastSeq = ev.Seq
	}
	t.Run("recent", func(t *testing.T) {
		rec, err := svc.GetSession(caller(localappop.OperationAgentSessionGet), &runtimev1.GetSessionRequest{WorkSessionRef: ref, IncludeRecentEvents: true, MaxEvents: 5})
		if err != nil {
			t.Fatal(err)
		}
		recent := rec.RecentEvents
		if len(recent) != 5 {
			t.Fatalf("received %d events", len(recent))
		}
		if recent[0].Seq != lastSeq-4 || recent[4].Seq != lastSeq {
			t.Errorf("recent events: got %d..%d, expected %d..%d", recent[0].Seq, recent[4].Seq, lastSeq-4, lastSeq)
		}
	})
	t.Run("backlog", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(caller(localappop.OperationAgentSessionBrainEventsSubscribe), 2*time.Second)
		defer cancel()
		stream := &fakeBrainEventStream{ctx: ctx, cancel: cancel, target: int(lastSeq)}
		_ = svc.SubscribeBrainSessionEvents(&runtimev1.SubscribeBrainSessionEventsRequest{WorkSessionRef: ref}, stream)
		for i, event := range stream.events {
			if event.GetSeq() != int64(i+1) {
				t.Fatalf("non-contiguous history at %d: %d", i, event.GetSeq())
			}
		}
		if len(stream.events) != int(lastSeq) {
			t.Errorf("durable history: received %d events, committed head %d", len(stream.events), lastSeq)
		}
	})
}

func TestSlowBrainSubscriberPreservesTerminalOrder(t *testing.T) {
	for _, chunks := range []int{24, 96} {
		t.Run(strconv.Itoa(chunks), func(t *testing.T) {
			caller := func(op localappop.Operation) context.Context {
				return callerCtxWithExactDomains("app.home", "subj-home", DomainAgentLocal, op, DomainAgentLocal)
			}
			ctx, cancel := context.WithTimeout(caller(localappop.OperationAgentSessionBrainEventsSubscribe), 5*time.Second)
			defer cancel()
			baseline, firstChunk, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
			wait := func(ch <-chan struct{}) error {
				select {
				case <-ch:
					return nil
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			svc := newStage2Service(t, Options{BrainTurnExecutor: func(_ context.Context, _ BrainTurnExecutionInput, emit func(string, string, bool) error) error {
				defer close(finished)
				if err := wait(baseline); err != nil {
					return err
				}
				for i := 0; i < chunks; i++ {
					if err := emit("text_delta", `{"delta":"x"}`, false); err != nil {
						return err
					}
					if i == 0 {
						if err := wait(firstChunk); err != nil {
							return err
						}
					}
				}
				return emit("assistant_message", `{"text":"finished"}`, true)
			}})
			route, err := svc.RouteAndSubmitInput(caller(localappop.OperationAgentSessionRouteSubmit),
				&runtimev1.RouteAndSubmitInputRequest{AgentHandle: "agent-1", RequestId: "slow-reader", Text: "hello", EntrySurface: "home"})
			if err != nil {
				t.Fatal(err)
			}
			stream := &fakeBrainEventStream{ctx: ctx, cancel: cancel, target: chunks + 2}
			stream.beforeSend = func(event *runtimev1.BrainSessionEventEnvelope) error {
				switch event.GetEventType() {
				case "user_message":
					close(baseline)
				case "text_delta":
					select {
					case <-firstChunk:
					default:
						close(firstChunk)
						return wait(finished)
					}
				case "assistant_message":
					if chunks == 96 { // A full queue may discard live fragments.
						cancel()
					}
				}
				return nil
			}
			_ = svc.SubscribeBrainSessionEvents(&runtimev1.SubscribeBrainSessionEventsRequest{WorkSessionRef: route.ResolvedWorkSessionRef}, stream)
			events := stream.events
			if len(events) < 3 || events[0].GetEventType() != "user_message" || events[len(events)-1].GetEventType() != "assistant_message" {
				t.Fatalf("missing or out-of-order terminal event: %v", events)
			}
			if chunks == 24 && len(events) != chunks+2 {
				t.Fatalf("received %d events, want %d", len(events), chunks+2)
			}
		})
	}
}

func TestSplitNewSessionOnlyAndReplay(t *testing.T) {
	svc := newStage2Service(t, Options{})
	domains := DomainAgentLocal + "," + DomainAgentSessionManage
	route := callerCtxWithExactDomains("app.home", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit, domains)
	split := callerCtxWithExactDomains("app.home", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionSplitRedirect, domains)
	source, err := svc.RouteAndSubmitInput(route, &runtimev1.RouteAndSubmitInputRequest{AgentHandle: "agent-1", RequestId: "source", Text: "First note", EntrySurface: "home"})
	if err != nil {
		t.Fatal(err)
	}
	target, err := svc.RouteAndSubmitInput(route, &runtimev1.RouteAndSubmitInputRequest{AgentHandle: "agent-1", RequestId: "destination", Text: "Draft", EntrySurface: "harness_new_session", WorkspaceRoot: "workspace"})
	if err != nil {
		t.Fatal(err)
	}
	req := &runtimev1.SplitOrRedirectInputRequest{SourceWorkSessionRef: source.ResolvedWorkSessionRef, TargetWorkSessionRef: target.ResolvedWorkSessionRef, RequestId: "split"}
	if _, err := svc.SplitOrRedirectInput(split, req); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("explicit existing destination: %v", err)
	}
	req.TargetWorkSessionRef = ""
	first, err := svc.SplitOrRedirectInput(split, req)
	if err != nil || first.GetWorkSessionRecord() == nil {
		t.Fatalf("split: %v, %v", first, err)
	}
	replayed, err := svc.SplitOrRedirectInput(split, req)
	if err != nil || !proto.Equal(first, replayed) {
		t.Fatalf("retry: %v, %v; first %v", replayed, err, first)
	}
	req.WorkspaceRoot = "other"
	if _, err := svc.SplitOrRedirectInput(split, req); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("changed workspace: %v", err)
	}
	update := callerCtxWithExactDomains("app.home", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionUpdate, domains)
	if _, err := svc.UpdateSession(update, &runtimev1.UpdateSessionRequest{WorkSessionRef: first.TargetWorkSessionRef, Title: proto.String("Renamed target")}); err != nil {
		t.Fatal(err)
	}
	del := callerCtxWithExactDomains("app.home", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionDelete, domains)
	if _, err := svc.DeleteSession(del, &runtimev1.DeleteSessionRequest{WorkSessionRef: source.ResolvedWorkSessionRef, Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	req.WorkspaceRoot = ""
	replayed, err = svc.SplitOrRedirectInput(split, req)
	if err != nil || !proto.Equal(first, replayed) {
		t.Fatalf("lost receipt after source deletion: %v, %v", replayed, err)
	}
	req.RequestId = "another-split"
	if _, err := svc.SplitOrRedirectInput(split, req); status.Code(err) != codes.NotFound {
		t.Fatalf("new split from deleted source: %v", err)
	}
}
