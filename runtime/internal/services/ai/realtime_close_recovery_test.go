package ai

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

type closeRecoveryProvider struct {
	*realtimeTestProvider
	closes atomic.Int32
}

func TestRealtimeTerminalReceiptBoundsAndOwnership(t *testing.T) {
	store := newRealtimeSessionStore()
	now := time.Unix(1000, 0)
	store.now = func() time.Time { return now }
	invalidated := make(chan struct{})
	var ownerSession protectedlocal.Identifier
	ownerSession[0] = 1
	svc := &Service{realtimeSessions: store}
	decision := accountservice.LocalAppCallerDecision{SessionID: ownerSession, AccountID: "account", AppID: "app", RegisteredAppSubject: "subject", SessionInvalidated: invalidated}
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	add := func(id string) {
		store.finish(&realtimeSessionRecord{sessionID: id, appID: "app", subjectUserID: "account", ownerSessionID: ownerSession, ownerInvalidated: invalidated}, &runtimev1.RealtimeControlStatus{RealtimeSessionId: id, Generation: 1, Lifecycle: runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_CLOSED})
	}
	add("receipt")
	if store.create(&realtimeSessionRecord{sessionID: "receipt"}) {
		t.Fatal("terminal identity was reused")
	}
	req := &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: "receipt", Generation: 1}
	first, ok := svc.ReplayClosedRealtimeSession(ctx, req)
	if !ok {
		t.Fatal("same owner failed")
	}
	first.Control.Lifecycle = runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_READY
	for _, change := range []string{"account", "app", "session"} {
		wrong := decision
		switch change {
		case "account":
			wrong.AccountID = "other"
		case "app":
			wrong.AppID = "other"
		case "session":
			wrong.SessionID[0] = 2
		}
		if _, ok := svc.ReplayClosedRealtimeSession(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), wrong), req); ok {
			t.Fatalf("foreign %s read receipt", change)
		}
	}
	now = now.Add(realtimeTerminalTTL - time.Second)
	if got, ok := svc.ReplayClosedRealtimeSession(ctx, req); !ok || got.Control.Lifecycle != runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_CLOSED {
		t.Fatal("receipt mutated or prematurely expired")
	}
	now = now.Add(time.Second)
	if _, ok := svc.ReplayClosedRealtimeSession(ctx, req); ok {
		t.Fatal("observation renewed receipt TTL")
	}
	for i := 0; i <= realtimeTerminalLimit; i++ {
		now = now.Add(time.Millisecond)
		add(fmt.Sprint(i))
	}
	if len(store.terminals) != realtimeTerminalLimit {
		t.Fatal("terminal metadata is unbounded")
	}
	if _, ok := store.terminal("0"); ok {
		t.Fatal("oldest receipt not evicted")
	}
	close(invalidated)
	if _, ok := store.terminal(fmt.Sprint(realtimeTerminalLimit)); ok || len(store.terminals) != 0 {
		t.Fatal("invalidated owner receipt retained")
	}
}

func (p *closeRecoveryProvider) Close() error { p.closes.Add(1); return nil }

func TestRealtimeCloseRecoversLostReplyAfterOwnerRemoval(t *testing.T) {
	stream, err := realtimecore.NewStream[*runtimev1.AiRealtimeEvent](realtimecore.Config{RealtimeSessionID: "lost-reply", ChannelID: "channel", AdapterKind: "ai", Generation: 1, Capacity: 4})
	if err != nil {
		t.Fatal(err)
	}
	provider := &closeRecoveryProvider{realtimeTestProvider: newRealtimeTestProvider()}
	record := &realtimeSessionRecord{sessionID: "lost-reply", channelID: "channel", generation: 1, appID: "app", subjectUserID: "account", stream: stream, provider: provider}
	svc := &Service{realtimeSessions: newRealtimeSessionStore()}
	svc.realtimeSessions.create(record)
	ctx := metadata.NewIncomingContext(authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "account"}), metadata.Pairs(metadataAppIDKey, "app"))
	req := &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: record.sessionID, Generation: 1}
	first, err := svc.CloseRealtimeSession(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := svc.realtimeSessions.get(record.sessionID); ok {
		t.Fatal("closed owner remained active")
	}
	// Discard the first transport reply; the actual owner and provider are gone.
	second, err := svc.CloseRealtimeSession(ctx, req)
	if err != nil {
		t.Fatalf("retry after lost reply: %v", err)
	}
	if !proto.Equal(first, second) || provider.closes.Load() != 1 {
		t.Fatalf("retry changed terminal or repeated provider close: %v / %v", first, second)
	}
}

type blockedCloseProvider struct {
	*closeRecoveryProvider
	entered, release chan struct{}
}

func (p *blockedCloseProvider) Close() error {
	p.closes.Add(1)
	close(p.entered)
	<-p.release
	return nil
}

func TestRealtimeCloseReceiptRequiresCompletedCleanup(t *testing.T) {
	stream, err := realtimecore.NewStream[*runtimev1.AiRealtimeEvent](realtimecore.Config{RealtimeSessionID: "closing", ChannelID: "channel", AdapterKind: "ai", Generation: 1, Capacity: 4})
	if err != nil {
		t.Fatal(err)
	}
	provider := &blockedCloseProvider{closeRecoveryProvider: &closeRecoveryProvider{realtimeTestProvider: newRealtimeTestProvider()}, entered: make(chan struct{}), release: make(chan struct{})}
	t.Cleanup(func() {
		select {
		case <-provider.release:
		default:
			close(provider.release)
		}
	})
	record := &realtimeSessionRecord{sessionID: "closing", channelID: "channel", generation: 1, appID: "app", subjectUserID: "account", stream: stream, provider: provider}
	svc := &Service{realtimeSessions: newRealtimeSessionStore()}
	svc.realtimeSessions.create(record)
	ctx := metadata.NewIncomingContext(authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "account"}), metadata.Pairs(metadataAppIDKey, "app"))
	req := &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: "closing", Generation: 1}
	done := make(chan error, 1)
	go func() { _, err := svc.CloseRealtimeSession(ctx, req); done <- err }()
	<-provider.entered
	if _, ok := svc.ReplayClosedRealtimeSession(ctx, req); ok {
		t.Fatal("cleanup in flight advertised closed")
	}
	cancelCtx, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := svc.CloseRealtimeSession(cancelCtx, req); status.Code(err) != codes.Canceled {
		t.Fatalf("canceled retry did not remain unconfirmed: %v", err)
	}
	close(provider.release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CloseRealtimeSession(ctx, req); err != nil || provider.closes.Load() != 1 {
		t.Fatalf("final retry: %v calls=%d", err, provider.closes.Load())
	}
}

func TestRealtimeCloseReplaysActualOwnerFailureWithoutRewritingIt(t *testing.T) {
	stream, err := realtimecore.NewStream[*runtimev1.AiRealtimeEvent](realtimecore.Config{RealtimeSessionID: "failed", ChannelID: "channel", AdapterKind: "ai", Generation: 1, Capacity: 4})
	if err != nil {
		t.Fatal(err)
	}
	record := &realtimeSessionRecord{sessionID: "failed", channelID: "channel", generation: 1, appID: "app", subjectUserID: "account", stream: stream}
	svc := &Service{realtimeSessions: newRealtimeSessionStore()}
	svc.realtimeSessions.create(record)
	svc.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, realtimecore.TerminalOwnerFailed)
	ctx := metadata.NewIncomingContext(authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "account"}), metadata.Pairs(metadataAppIDKey, "app"))
	reply, err := svc.CloseRealtimeSession(ctx, &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: "failed", Generation: 1})
	if err != nil || reply.GetControl().GetLifecycle() != runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_FAILED || reply.GetControl().GetTerminalReason() != runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_OWNER_FAILED {
		t.Fatalf("failure was rewritten as a successful cancel: %v %v", reply, err)
	}
}
