package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func TestLocalAppAvatarHostTargetWireIsExactAndSeparateFromReferenceProjection(t *testing.T) {
	request := (&runtimev1.ResolveLocalAppAvatarHostTargetRequest{}).ProtoReflect().Descriptor()
	if request.Fields().Len() != 2 || request.Fields().ByName(protoreflect.Name("agent_handle")) == nil ||
		request.Fields().ByName(protoreflect.Name("conversation_anchor_id")) == nil {
		t.Fatalf("target request fields = %v", request.Fields().Len())
	}
	response := (&runtimev1.ResolveLocalAppAvatarHostTargetResponse{}).ProtoReflect().Descriptor()
	if response.Fields().Len() != 1 || response.Fields().ByName(protoreflect.Name("avatar_host_target_ref")) == nil {
		t.Fatalf("target response fields = %v", response.Fields().Len())
	}
	revalidateRequest := (&runtimev1.RevalidateLocalAppAvatarHostTargetRequest{}).ProtoReflect().Descriptor()
	revalidateResponse := (&runtimev1.RevalidateLocalAppAvatarHostTargetResponse{}).ProtoReflect().Descriptor()
	if revalidateRequest.Fields().Len() != 1 ||
		revalidateRequest.Fields().ByName(protoreflect.Name("avatar_host_target_ref")) == nil ||
		revalidateResponse.Fields().Len() != 1 ||
		revalidateResponse.Fields().ByName(protoreflect.Name("avatar_host_target_ref")) == nil {
		t.Fatal("current target revalidation wire is not exact")
	}
	reference := (&runtimev1.LocalAppAgentReference{}).ProtoReflect().Descriptor()
	if reference.Fields().Len() != 3 || reference.Fields().ByName(protoreflect.Name("avatar_host_target_ref")) != nil {
		t.Fatalf("reference projection leaked Host target: fields=%d", reference.Fields().Len())
	}
}

func TestRevalidateLocalAppAvatarHostTargetRequiresCurrentDesktopBuiltInTarget(t *testing.T) {
	const localAgentID = "local-agent:current-avatar-target"
	svc := &Service{agents: map[string]*agentEntry{localAgentID: {Agent: &runtimev1.LocalAgentRecord{
		LocalAgentRef: localAgentID, RuntimeSourceRef: "runtime-source:current-avatar-target",
		DisplayName: "Current Agent", OwnerUserId: "account-1",
		LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
	}}}}
	desktop := avatarHostTargetDecision(0x51, 0xb1, "account-1", 9)
	desktop.AppID = "nimi.desktop"
	desktop.TrustClass = accountservice.LocalAppTrustClassBuiltIn
	targetRef := mintAvatarHostTargetRef(desktop, localAgentID)
	invoke := func(decision accountservice.LocalAppCallerDecision, ref string) (*runtimev1.RevalidateLocalAppAvatarHostTargetResponse, error) {
		return svc.RevalidateLocalAppAvatarHostTarget(
			accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
			&runtimev1.RevalidateLocalAppAvatarHostTargetRequest{AvatarHostTargetRef: ref},
		)
	}
	response, err := invoke(desktop, targetRef)
	if err != nil || response.GetAvatarHostTargetRef() != targetRef {
		t.Fatalf("Desktop current target revalidation = (%v, %v)", response, err)
	}
	ordinary := desktop
	ordinary.AppID = "nimi.zhiyu"
	ordinary.TrustClass = accountservice.LocalAppTrustClassDevelopment
	if _, err := invoke(ordinary, targetRef); err == nil {
		t.Fatal("ordinary formal App revalidated a Desktop Host target")
	}
	changedGeneration := desktop
	changedGeneration.AccountGeneration++
	if _, err := invoke(changedGeneration, targetRef); err == nil {
		t.Fatal("old-generation Avatar Host target was revalidated")
	}
	svc.agents[localAgentID].Agent.LifecycleStatus = runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_TERMINATED
	if _, err := invoke(desktop, targetRef); err == nil {
		t.Fatal("inactive Avatar Host target was revalidated")
	}
}

func TestLocalAppAvatarHostTargetConvergesAcrossCurrentSessionsAndFencesConversation(t *testing.T) {
	const localAgentID = "local-agent:avatar-target-agent"
	svc := &Service{
		agents: map[string]*agentEntry{localAgentID: {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: localAgentID, RuntimeSourceRef: "runtime-source:avatar-target-agent",
			DisplayName: "Target Agent", OwnerUserId: "account-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}}},
		chatAnchors: map[string]*publicChatAnchorState{"anchor-current": {
			ConversationAnchorID: "anchor-current", AgentID: localAgentID, LocalAgentRef: localAgentID,
			OwnerUserID: "account-1", SubjectUserID: "account-1", RuntimeSourceRef: "runtime-source:avatar-target-agent",
			Status: runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE,
		}},
	}
	first := avatarHostTargetDecision(0x11, 0xa1, "account-1", 7)
	second := avatarHostTargetDecision(0x31, 0xa1, "account-1", 7)
	resolve := func(decision accountservice.LocalAppCallerDecision, anchor *string) (*runtimev1.ResolveLocalAppAvatarHostTargetResponse, error) {
		return svc.ResolveLocalAppAvatarHostTarget(
			accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
			&runtimev1.ResolveLocalAppAvatarHostTargetRequest{
				AgentHandle: mintLocalAppAgentHandle(decision, localAgentID), ConversationAnchorId: anchor,
			},
		)
	}
	anchor := "anchor-current"
	firstResponse, err := resolve(first, &anchor)
	if err != nil {
		t.Fatal(err)
	}
	secondResponse, err := resolve(second, nil)
	if err != nil {
		t.Fatal(err)
	}
	if firstResponse.GetAvatarHostTargetRef() != secondResponse.GetAvatarHostTargetRef() {
		t.Fatal("same Agent did not converge across current formal App sessions")
	}
	wrongAnchor := "anchor-other"
	if _, err := resolve(first, &wrongAnchor); err == nil {
		t.Fatal("mismatched Conversation fence was admitted")
	}
	changedGeneration := avatarHostTargetDecision(0x41, 0xa1, "account-1", 8)
	changed, err := resolve(changedGeneration, nil)
	if err != nil {
		t.Fatal(err)
	}
	if changed.GetAvatarHostTargetRef() == firstResponse.GetAvatarHostTargetRef() {
		t.Fatal("Avatar Host target survived an account generation change")
	}
}

func avatarHostTargetDecision(sessionSeed byte, bootSeed byte, accountID string, generation uint64) accountservice.LocalAppCallerDecision {
	decision := localAppReferenceDecision(sessionSeed, accountID)
	decision.AccountGeneration = generation
	for index := range decision.RuntimeBootEpoch {
		decision.RuntimeBootEpoch[index] = bootSeed + byte(index)
	}
	return decision
}
