package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestLocalAppConversationResumeIsPrincipalScopedAndCreateNewStaysExplicit(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentTestService(t)
	seed := DevKernelCheckpointSeed{
		OwnerUserID:      "dev-kernel-account-primary",
		LocalAgentRef:    "local-agent:runtime-1f2e3d4c5b6a79800123456789abcdef",
		RuntimeSourceRef: "dev-kernel-source-primary",
		DisplayName:      "知语开发内核验收伙伴",
	}
	if _, err := svc.EnsureDevKernelCheckpointSeed(context.Background(), seed); err != nil {
		t.Fatal(err)
	}
	open := func(principalID string, disposition string) string {
		t.Helper()
		metadata, err := structpb.NewStruct(map[string]any{"local_app_anchor_disposition": disposition})
		if err != nil {
			t.Fatal(err)
		}
		ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
			AppID:               "nimi.zhiyu",
			AccountID:           seed.OwnerUserID,
			LocalAppPrincipalID: principalID,
			LocalAppRecordID:    "record-" + principalID,
			Operation:           accountservice.LocalAppOperationOpenConversation,
		})
		response, err := svc.OpenConversationAnchor(ctx, &runtimev1.OpenConversationAnchorRequest{
			AgentId:  seed.LocalAgentRef,
			Metadata: metadata,
		})
		if err != nil {
			t.Fatalf("open %s for %s: %v", disposition, principalID, err)
		}
		return response.GetSnapshot().GetAnchor().GetConversationAnchorId()
	}

	first := open("principal-a", "create-or-resume")
	if resumed := open("principal-a", "create-or-resume"); resumed != first {
		t.Fatalf("same principal did not resume anchor: first=%q resumed=%q", first, resumed)
	}
	if isolated := open("principal-b", "create-or-resume"); isolated == first {
		t.Fatal("different local-app principal inherited a conversation anchor")
	}
	if created := open("principal-a", "create-new"); created == first {
		t.Fatal("create-new returned the resumable anchor")
	}

	validScope := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AppID: "nimi.zhiyu", AccountID: seed.OwnerUserID, LocalAppPrincipalID: "principal-a",
		LocalAppRecordID: "record-principal-a", Operation: accountservice.LocalAppOperationConversationSnapshot,
	})
	if err := svc.ValidateLocalAppConversationScope(validScope, seed.LocalAgentRef, first); err != nil {
		t.Fatalf("same principal conversation scope rejected: %v", err)
	}
	wrongScope := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AppID: "nimi.zhiyu", AccountID: seed.OwnerUserID, LocalAppPrincipalID: "principal-b",
		LocalAppRecordID: "record-principal-b", Operation: accountservice.LocalAppOperationConversationSnapshot,
	})
	if err := svc.ValidateLocalAppConversationScope(wrongScope, seed.LocalAgentRef, first); err == nil {
		t.Fatal("different local-app principal accessed a conversation anchor")
	}
}

func TestLocalAppConversationRejectsMissingTrustedDisposition(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentTestService(t)
	seed := DevKernelCheckpointSeed{
		OwnerUserID: "dev-kernel-account-primary", LocalAgentRef: "local-agent:runtime-1f2e3d4c5b6a79800123456789abcdef",
		RuntimeSourceRef: "dev-kernel-source-primary", DisplayName: "知语开发内核验收伙伴",
	}
	if _, err := svc.EnsureDevKernelCheckpointSeed(context.Background(), seed); err != nil {
		t.Fatal(err)
	}
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AppID: "nimi.zhiyu", AccountID: seed.OwnerUserID, LocalAppPrincipalID: "principal-a",
		LocalAppRecordID: "record-a", Operation: accountservice.LocalAppOperationOpenConversation,
	})
	if _, err := svc.OpenConversationAnchor(ctx, &runtimev1.OpenConversationAnchorRequest{AgentId: seed.LocalAgentRef}); err == nil {
		t.Fatal("local-app open accepted a missing trusted anchor disposition")
	}
}
