package runtimeagent

import (
	"context"
	"fmt"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestPublicChatSessionSnapshotUnaryDoesNotRequireAppEmitter(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")

	snapshot := requestPublicChatSessionSnapshot(t, svc, nil, anchorID, "snapshot-without-emitter")
	payload := publicChatSessionSnapshotDetail(t, snapshot)
	if got := payload["request_id"]; got != "snapshot-without-emitter" {
		t.Fatalf("expected request_id echo, got=%v", payload)
	}
	if got := payload["session_status"]; got != "idle" {
		t.Fatalf("expected idle snapshot without app emitter, got=%v", payload)
	}
}

func TestPublicChatSessionSnapshotRejectsSubjectOnlyBindingContext(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")

	_, err := svc.GetPublicChatSessionSnapshot(context.Background(), &runtimev1.GetPublicChatSessionSnapshotRequest{
		Context:              &runtimev1.AgentRequestContext{AppId: "desktop.app", SubjectUserId: "user-1"},
		AgentId:              "agent-alpha",
		ConversationAnchorId: anchorID,
		RequestId:            "subject-only-snapshot",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected subject-only snapshot to fail closed with InvalidArgument, got %v", err)
	}
}

func TestPublicChatSessionSnapshotAcceptsFirstPartyProtectedCapability(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")

	ctx := envelope.WithValidatedProtectedCapability(context.Background(), "desktop.app", runtimeAgentReadScope)
	agentCtx := testRuntimeAgentIdentityContext("agent-alpha")
	agentCtx.AppId = "desktop.app"
	resp, err := svc.GetPublicChatSessionSnapshot(ctx, &runtimev1.GetPublicChatSessionSnapshotRequest{
		Context:              agentCtx,
		AgentId:              testRuntimeAgentLocalRef("agent-alpha"),
		ConversationAnchorId: anchorID,
		RequestId:            "subject-protected-snapshot",
	})
	if err != nil {
		t.Fatalf("first-party protected snapshot should not require scoped binding: %v", err)
	}
	payload := publicChatSessionSnapshotDetail(t, resp.GetSnapshot())
	if got := payload["request_id"]; got != "subject-protected-snapshot" {
		t.Fatalf("expected request_id echo, got=%v", payload)
	}
}

func TestPublicChatSessionSnapshotAcceptsDefaultAvatarWithLiveInstanceBinding(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	desktopCtx := testRuntimeAgentIdentityContext("agent-alpha")
	desktopCtx.AppId = "desktop.app"
	if _, err := svc.RegisterAvatarLiveInstanceBinding(context.Background(), &runtimev1.RegisterAvatarLiveInstanceBindingRequest{
		Context:              desktopCtx,
		AvatarInstanceId:     "avatar-instance-1",
		ConversationAnchorId: anchorID,
	}); err != nil {
		t.Fatalf("RegisterAvatarLiveInstanceBinding: %v", err)
	}

	ctx := envelope.WithValidatedProtectedCapability(context.Background(), defaultAvatarRuntimeAppID, runtimeAgentReadScope)
	avatarCtx := testRuntimeAgentIdentityContext("agent-alpha")
	avatarCtx.AppId = defaultAvatarRuntimeAppID
	resp, err := svc.GetPublicChatSessionSnapshot(ctx, &runtimev1.GetPublicChatSessionSnapshotRequest{
		Context:              avatarCtx,
		AgentId:              testRuntimeAgentLocalRef("agent-alpha"),
		ConversationAnchorId: anchorID,
		RequestId:            "avatar-live-instance-snapshot",
	})
	if err != nil {
		t.Fatalf("avatar live instance snapshot should be admitted: %v", err)
	}
	payload := publicChatSessionSnapshotDetail(t, resp.GetSnapshot())
	if got := payload["request_id"]; got != "avatar-live-instance-snapshot" {
		t.Fatalf("expected request_id echo, got=%v", payload)
	}
}

func TestPublicChatSessionSnapshotUsesAnchorScopeAcrossAppsWithoutAppPartition(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")

	ctx := envelope.WithValidatedProtectedCapability(context.Background(), defaultAvatarRuntimeAppID, runtimeAgentReadScope)
	avatarCtx := testRuntimeAgentIdentityContext("agent-alpha")
	avatarCtx.AppId = defaultAvatarRuntimeAppID
	resp, err := svc.GetPublicChatSessionSnapshot(ctx, &runtimev1.GetPublicChatSessionSnapshotRequest{
		Context:              avatarCtx,
		AgentId:              testRuntimeAgentLocalRef("agent-alpha"),
		ConversationAnchorId: anchorID,
		RequestId:            "avatar-unbound-snapshot",
	})
	if err != nil || resp.GetSnapshot() == nil {
		t.Fatalf("expected authenticated cross-app anchor snapshot, got response=%v err=%v", resp, err)
	}
}

func TestPublicChatSessionSnapshotDoesNotUseAvatarBindingAsAppPartition(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	desktopCtx := testRuntimeAgentIdentityContext("agent-alpha")
	desktopCtx.AppId = "desktop.app"
	if _, err := svc.RegisterAvatarLiveInstanceBinding(context.Background(), &runtimev1.RegisterAvatarLiveInstanceBindingRequest{
		Context:              desktopCtx,
		AvatarInstanceId:     "avatar-instance-1",
		ConversationAnchorId: anchorID,
	}); err != nil {
		t.Fatalf("RegisterAvatarLiveInstanceBinding: %v", err)
	}

	ctx := envelope.WithValidatedProtectedCapability(context.Background(), "other.app", runtimeAgentReadScope)
	otherCtx := testRuntimeAgentIdentityContext("agent-alpha")
	otherCtx.AppId = "other.app"
	resp, err := svc.GetPublicChatSessionSnapshot(ctx, &runtimev1.GetPublicChatSessionSnapshotRequest{
		Context:              otherCtx,
		AgentId:              testRuntimeAgentLocalRef("agent-alpha"),
		ConversationAnchorId: anchorID,
		RequestId:            "other-app-snapshot",
	})
	if err != nil || resp.GetSnapshot() == nil {
		t.Fatalf("expected authenticated anchor-scoped snapshot independent of app id, got response=%v err=%v", resp, err)
	}
}

func waitForPublicChatAgentIdle(t *testing.T, svc *Service, agentID string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := svc.GetAgentState(context.Background(), &runtimev1.GetAgentStateRequest{
			Context: testRuntimeAgentIdentityContext(agentID), AgentId: agentID})
		if err == nil && resp.GetState().GetExecutionState() == runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for agent %s to return to idle", agentID)
}

type publicChatFollowUpGate struct {
	due chan struct{}
}

func installPublicChatFollowUpGate(t *testing.T, svc *Service) *publicChatFollowUpGate {
	t.Helper()
	gate := &publicChatFollowUpGate{due: make(chan struct{}, 1)}
	svc.chatSurfaceMu.Lock()
	if svc.chatFollowUpWait != nil {
		svc.chatSurfaceMu.Unlock()
		t.Fatal("public chat follow-up wait boundary already installed")
	}
	svc.chatFollowUpWait = func(ctx context.Context, _ time.Time) bool {
		select {
		case <-gate.due:
			return true
		case <-ctx.Done():
			return false
		}
	}
	svc.chatSurfaceMu.Unlock()
	return gate
}

func (g *publicChatFollowUpGate) release(t *testing.T) {
	t.Helper()
	select {
	case g.due <- struct{}{}:
	default:
		t.Fatal("public chat follow-up gate already released")
	}
}

func waitForPublicChatAsyncDrain(t *testing.T, svc *Service) {
	t.Helper()
	done := make(chan struct{})
	go func() {
		svc.chatAsyncWG.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for public chat async work to drain")
	}
}

func publicChatStructuredEnvelopeAPML(messageID string, text string) string {
	return fmt.Sprintf(`<message id="%s">%s</message>`,
		messageID,
		text,
	)
}
func publicChatStructuredEnvelopeWithFollowUpAPML(messageID string, text string, actionID string, prompt string, delayMs int) string {
	return fmt.Sprintf(`<message id="%s">%s</message><time-hook id="%s"><delay-ms>%d</delay-ms><effect kind="follow-up-turn"><prompt-text>%s</prompt-text></effect></time-hook>`,
		messageID,
		text,
		actionID,
		delayMs,
		prompt,
	)
}
