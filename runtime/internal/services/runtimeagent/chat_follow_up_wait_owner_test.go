package runtimeagent

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type blockedFollowUpAccountProjection struct {
	entered chan struct{}
	release chan struct{}
}

func (p blockedFollowUpAccountProjection) AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool) {
	p.entered <- struct{}{}
	<-p.release
	return nil, false
}

func TestPublicChatFollowUpKeepsWaitOwnerUntilLaunchReturns(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openEnabledPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	svc.SetPublicChatAppEmitter(newPublicChatEmitCapture().emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{})
	owner := blockedFollowUpAccountProjection{entered: make(chan struct{}, 2), release: make(chan struct{})}
	defer close(owner.release)
	svc.SetRuntimeAccountProjectionProvider(owner)
	pending := &publicChatFollowUpState{FollowUpID: "wait-owner", ConversationAnchorID: anchorID, ScheduledFor: time.Now().Add(-time.Second)}
	svc.chatSurfaceMu.Lock()
	svc.chatFollowUps[pending.FollowUpID] = pending
	svc.chatAnchors[anchorID].PendingFollowUpID = pending.FollowUpID
	svc.chatFollowUpWait = func(context.Context, time.Time) bool { return true }
	svc.chatSurfaceMu.Unlock()
	svc.armPublicChatFollowUp(pending)
	select {
	case <-owner.entered:
	case <-time.After(time.Second):
		t.Fatal("launch did not reach account check")
	}
	svc.chatSurfaceMu.Lock()
	firstContext := pending.Context
	armed := pending.Armed
	svc.chatSurfaceMu.Unlock()
	if !armed {
		t.Fatal("due waiter released its claim before launch finished")
	}
	// Text-slot release and recovery can both request this wake while launch
	// is waiting on its existing account owner. Neither may replace Cancel.
	svc.wakeDuePublicChatFollowUp(anchorID)
	svc.chatSurfaceMu.Lock()
	sameContext := pending.Context == firstContext
	svc.chatSurfaceMu.Unlock()
	if !sameContext {
		t.Fatal("a second wake replaced the in-flight wait owner")
	}
}
