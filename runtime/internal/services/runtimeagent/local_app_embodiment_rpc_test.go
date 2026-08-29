package runtimeagent

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestLocalAppEmbodimentSnapshotRPCUsesExactFormalAppScope(t *testing.T) {
	composition := newEmbodimentTestComposition(t)
	entry, err := composition.svc.agentByID(composition.agentRef)
	if err != nil {
		t.Fatal(err)
	}
	decision := localAppConversationDecision(
		accountservice.LocalAppOperationEmbodimentSnapshot,
		0x74,
		entry.Agent.GetOwnerUserId(),
	)
	handle := mintLocalAppAgentHandle(decision, composition.agentRef)
	var revalidations atomic.Int32
	composition.svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
		if ingress != localappop.IngressAgentEmbodimentSnapshotGet {
			t.Fatalf("revalidation ingress = %v", ingress)
		}
		revalidations.Add(1)
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
	}))
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	response, err := composition.svc.GetLocalAppEmbodimentSnapshot(ctx, &runtimev1.GetLocalAppEmbodimentSnapshotRequest{
		AgentHandle: handle, ConversationAnchorId: composition.anchorID,
	})
	if err != nil {
		t.Fatalf("GetLocalAppEmbodimentSnapshot: %v", err)
	}
	if response.GetSnapshot() == nil || response.GetSnapshot().GetSequence() == 0 || revalidations.Load() != 1 {
		t.Fatalf("snapshot = %+v revalidations=%d", response.GetSnapshot(), revalidations.Load())
	}

	_, err = composition.svc.GetLocalAppEmbodimentSnapshot(ctx, &runtimev1.GetLocalAppEmbodimentSnapshotRequest{
		AgentHandle: handle, ConversationAnchorId: "agent_anchor_missing",
	})
	if status.Code(err) != codes.NotFound {
		t.Fatalf("foreign anchor error = %v, want NotFound", err)
	}

	staleDecision := decision
	for index := range staleDecision.SessionID {
		staleDecision.SessionID[index]++
	}
	composition.svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
		if ingress != localappop.IngressAgentEmbodimentSnapshotGet {
			t.Fatalf("stale revalidation ingress = %v", ingress)
		}
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, staleDecision), nil
	}))
	response, err = composition.svc.GetLocalAppEmbodimentSnapshot(ctx, &runtimev1.GetLocalAppEmbodimentSnapshotRequest{
		AgentHandle: handle, ConversationAnchorId: composition.anchorID,
	})
	if response != nil || status.Code(err) != codes.PermissionDenied {
		t.Fatalf("stale formal session = response:%+v error:%v", response, err)
	}
}

func TestLocalAppEmbodimentSubscriptionRPCStreamsBoundedEventsAndRevalidates(t *testing.T) {
	composition := newEmbodimentTestComposition(t)
	entry, err := composition.svc.agentByID(composition.agentRef)
	if err != nil {
		t.Fatal(err)
	}
	decision := localAppConversationDecision(
		accountservice.LocalAppOperationEmbodimentEventsSubscribe,
		0x75,
		entry.Agent.GetOwnerUserId(),
	)
	handle := mintLocalAppAgentHandle(decision, composition.agentRef)
	var revalidations atomic.Int32
	var unexpectedIngress atomic.Bool
	composition.svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
		if ingress != localappop.IngressAgentEmbodimentEventsSubscribe {
			unexpectedIngress.Store(true)
		}
		revalidations.Add(1)
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
	}))
	baseCtx, cancel := context.WithCancel(context.Background())
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(baseCtx, decision)
	stream := &localAppEmbodimentRPCCaptureStream{ctx: ctx, cancel: cancel}
	composition.svc.mu.RLock()
	afterSequence := composition.svc.sequence
	composition.svc.mu.RUnlock()
	done := make(chan error, 1)
	go func() {
		done <- composition.svc.SubscribeLocalAppEmbodimentEvents(
			&runtimev1.SubscribeLocalAppEmbodimentEventsRequest{
				AgentHandle: handle, ConversationAnchorId: composition.anchorID, AfterSequence: afterSequence,
			},
			stream,
		)
	}()
	waitForRuntimeAgentCondition(t, time.Second, func() bool {
		composition.svc.mu.RLock()
		defer composition.svc.mu.RUnlock()
		return len(composition.svc.subscribers) == 1
	})

	event := composition.svc.stateEmotionChangedEvent(
		composition.agentRef,
		"excited",
		"neutral",
		"runtime",
		stateEventOrigin{ConversationAnchorID: composition.anchorID, OriginatingTurnID: "turn-opaque"},
		time.Now().UTC(),
	)
	if err := composition.svc.commitAgentEvents(event); err != nil {
		t.Fatalf("commit embodiment event: %v", err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("SubscribeLocalAppEmbodimentEvents: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("embodiment subscription did not finish after client cancellation")
	}
	stream.mu.Lock()
	events := append([]*runtimev1.LocalAppEmbodimentEvent(nil), stream.events...)
	headerSent := stream.headerSent
	stream.mu.Unlock()
	if !headerSent || len(events) != 1 ||
		events[0].GetKind() != runtimev1.LocalAppEmbodimentEventKind_LOCAL_APP_EMBODIMENT_EVENT_KIND_EMOTION ||
		events[0].GetEmotion().GetName() != "excited" || revalidations.Load() < 2 || unexpectedIngress.Load() {
		t.Fatalf("stream = header:%v events:%+v revalidations:%d unexpectedIngress:%v", headerSent, events, revalidations.Load(), unexpectedIngress.Load())
	}

	invalidBaseCtx, invalidCancel := context.WithCancel(context.Background())
	defer invalidCancel()
	invalidStream := &localAppEmbodimentRPCCaptureStream{
		ctx:    accountservice.ContextWithAuthorizedLocalAppDecision(invalidBaseCtx, decision),
		cancel: invalidCancel,
	}
	composition.svc.mu.RLock()
	invalidCursor := composition.svc.sequence + 1
	composition.svc.mu.RUnlock()
	err = composition.svc.SubscribeLocalAppEmbodimentEvents(
		&runtimev1.SubscribeLocalAppEmbodimentEventsRequest{
			AgentHandle: handle, ConversationAnchorId: composition.anchorID, AfterSequence: invalidCursor,
		},
		invalidStream,
	)
	invalidStream.mu.Lock()
	invalidHeaderSent := invalidStream.headerSent
	invalidStream.mu.Unlock()
	if status.Code(err) != codes.InvalidArgument || invalidHeaderSent {
		t.Fatalf("invalid cursor = header:%v error:%v", invalidHeaderSent, err)
	}
}

type localAppEmbodimentRPCCaptureStream struct {
	ctx        context.Context
	cancel     context.CancelFunc
	mu         sync.Mutex
	headerSent bool
	events     []*runtimev1.LocalAppEmbodimentEvent
}

func (s *localAppEmbodimentRPCCaptureStream) SetHeader(metadata.MD) error { return nil }
func (s *localAppEmbodimentRPCCaptureStream) SendHeader(metadata.MD) error {
	s.mu.Lock()
	s.headerSent = true
	s.mu.Unlock()
	return nil
}
func (*localAppEmbodimentRPCCaptureStream) SetTrailer(metadata.MD)     {}
func (s *localAppEmbodimentRPCCaptureStream) Context() context.Context { return s.ctx }
func (*localAppEmbodimentRPCCaptureStream) SendMsg(any) error          { return nil }
func (*localAppEmbodimentRPCCaptureStream) RecvMsg(any) error          { return nil }
func (s *localAppEmbodimentRPCCaptureStream) Send(event *runtimev1.LocalAppEmbodimentEvent) error {
	s.mu.Lock()
	s.events = append(s.events, event)
	s.mu.Unlock()
	s.cancel()
	return nil
}
