package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestAvatarLiveInstanceBindingRegistersAndResolvesExistingAnchor(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	ctx := avatarLiveInstanceBindingContext("desktop.app")

	registered, err := svc.RegisterAvatarLiveInstanceBinding(context.Background(), &runtimev1.RegisterAvatarLiveInstanceBindingRequest{
		Context:              ctx,
		AvatarInstanceId:     "avatar-instance-1",
		ConversationAnchorId: anchorID,
	})
	if err != nil {
		t.Fatalf("RegisterAvatarLiveInstanceBinding: %v", err)
	}
	if registered.GetBinding().GetConversationAnchorId() != anchorID {
		t.Fatalf("registered binding anchor mismatch: %+v", registered.GetBinding())
	}
	if registered.GetSnapshot().GetAnchor().GetConversationAnchorId() != anchorID {
		t.Fatalf("registered snapshot anchor mismatch: %+v", registered.GetSnapshot().GetAnchor())
	}

	resolved, err := svc.ResolveAvatarLiveInstanceBinding(context.Background(), &runtimev1.ResolveAvatarLiveInstanceBindingRequest{
		Context:          ctx,
		AvatarInstanceId: "avatar-instance-1",
	})
	if err != nil {
		t.Fatalf("ResolveAvatarLiveInstanceBinding: %v", err)
	}
	if resolved.GetBinding().GetConversationAnchorId() != anchorID ||
		resolved.GetSnapshot().GetAnchor().GetConversationAnchorId() != anchorID ||
		resolved.GetBinding().GetLocalAgentRef() != testRuntimeAgentLocalRef("agent-alpha") {
		t.Fatalf("resolved binding mismatch: binding=%+v snapshot=%+v", resolved.GetBinding(), resolved.GetSnapshot().GetAnchor())
	}
}

func TestAvatarLiveInstanceBindingFailsClosedWithoutRegistration(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)

	_, err := svc.ResolveAvatarLiveInstanceBinding(context.Background(), &runtimev1.ResolveAvatarLiveInstanceBindingRequest{
		Context:          avatarLiveInstanceBindingContext("desktop.app"),
		AvatarInstanceId: "avatar-instance-missing",
	})
	if status.Code(err) != codes.NotFound {
		t.Fatalf("expected NotFound for missing binding, got %v", err)
	}
}

func TestAvatarLiveInstanceBindingRejectsCrossAgentAnchor(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	if _, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:     testRuntimeAgentIdentityContext("agent-beta"),
		DisplayName: "Beta",
	}); err != nil && status.Code(err) != codes.AlreadyExists {
		t.Fatalf("InitializeAgent(beta): %v", err)
	}
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	betaCtx := testRuntimeAgentIdentityContext("agent-beta")
	betaCtx.AppId = "desktop.app"

	_, err := svc.RegisterAvatarLiveInstanceBinding(context.Background(), &runtimev1.RegisterAvatarLiveInstanceBindingRequest{
		Context:              betaCtx,
		AvatarInstanceId:     "avatar-instance-1",
		ConversationAnchorId: anchorID,
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition for cross-agent anchor, got %v", err)
	}
}

func TestAvatarLiveInstanceBindingPersistsAcrossRestart(t *testing.T) {
	t.Parallel()
	localStatePath := t.TempDir() + "/local-state.json"
	first, closeFirst := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	anchorID := openPublicChatTestAnchor(t, first, "agent-alpha", "desktop.app", "user-1")
	if _, err := first.RegisterAvatarLiveInstanceBinding(context.Background(), &runtimev1.RegisterAvatarLiveInstanceBindingRequest{
		Context:              avatarLiveInstanceBindingContext("desktop.app"),
		AvatarInstanceId:     "avatar-instance-1",
		ConversationAnchorId: anchorID,
	}); err != nil {
		t.Fatalf("RegisterAvatarLiveInstanceBinding: %v", err)
	}
	closeFirst()

	recovered, closeRecovered := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, localStatePath)
	defer closeRecovered()
	resolved, err := recovered.ResolveAvatarLiveInstanceBinding(context.Background(), &runtimev1.ResolveAvatarLiveInstanceBindingRequest{
		Context:          avatarLiveInstanceBindingContext("desktop.app"),
		AvatarInstanceId: "avatar-instance-1",
	})
	if err != nil {
		t.Fatalf("ResolveAvatarLiveInstanceBinding(recovered): %v", err)
	}
	if resolved.GetSnapshot().GetAnchor().GetConversationAnchorId() != anchorID {
		t.Fatalf("recovered anchor mismatch: %+v", resolved.GetSnapshot().GetAnchor())
	}
}

func avatarLiveInstanceBindingContext(appID string) *runtimev1.AgentRequestContext {
	ctx := testRuntimeAgentIdentityContext("agent-alpha")
	ctx.AppId = appID
	return ctx
}
