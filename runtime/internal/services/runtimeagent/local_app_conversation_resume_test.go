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
	fixture := initializeLocalAppConversationAgentFixture(t, svc)
	open := func(principalID string, disposition string) string {
		t.Helper()
		metadata, err := structpb.NewStruct(map[string]any{"local_app_anchor_disposition": disposition})
		if err != nil {
			t.Fatal(err)
		}
		ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
			AppID:                "nimi.zhiyu",
			AccountID:            fixture.ownerUserID,
			LocalAppPrincipalID:  principalID,
			LocalAppRecordID:     "record-" + principalID,
			OwnerSelectedAgentID: fixture.localAgentRef,
			Operation:            accountservice.LocalAppOperationOpenConversation,
		})
		response, err := svc.OpenConversationAnchor(ctx, &runtimev1.OpenConversationAnchorRequest{
			AgentId:  fixture.localAgentRef,
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
		AppID: "nimi.zhiyu", AccountID: fixture.ownerUserID, LocalAppPrincipalID: "principal-a",
		LocalAppRecordID: "record-principal-a", Operation: accountservice.LocalAppOperationConversationSnapshot,
	})
	if err := svc.ValidateLocalAppConversationScope(validScope, fixture.localAgentRef, first); err != nil {
		t.Fatalf("same principal conversation scope rejected: %v", err)
	}
	wrongScope := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AppID: "nimi.zhiyu", AccountID: fixture.ownerUserID, LocalAppPrincipalID: "principal-b",
		LocalAppRecordID: "record-principal-b", Operation: accountservice.LocalAppOperationConversationSnapshot,
	})
	if err := svc.ValidateLocalAppConversationScope(wrongScope, fixture.localAgentRef, first); err == nil {
		t.Fatal("different local-app principal accessed a conversation anchor")
	}
}

func TestLocalAppConversationRejectsMissingTrustedDisposition(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentTestService(t)
	fixture := initializeLocalAppConversationAgentFixture(t, svc)
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AppID: "nimi.zhiyu", AccountID: fixture.ownerUserID, LocalAppPrincipalID: "principal-a",
		LocalAppRecordID: "record-a", OwnerSelectedAgentID: fixture.localAgentRef, Operation: accountservice.LocalAppOperationOpenConversation,
	})
	if _, err := svc.OpenConversationAnchor(ctx, &runtimev1.OpenConversationAnchorRequest{AgentId: fixture.localAgentRef}); err == nil {
		t.Fatal("local-app open accepted a missing trusted anchor disposition")
	}
}

type localAppConversationAgentFixture struct {
	ownerUserID   string
	localAgentRef string
}

func initializeLocalAppConversationAgentFixture(t *testing.T, svc *Service) localAppConversationAgentFixture {
	t.Helper()
	fixture := localAppConversationAgentFixture{
		ownerUserID:   "local-app-conversation-owner",
		localAgentRef: "local-agent:runtime-1f2e3d4c5b6a79800123456789abcdef",
	}
	response, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{
		Context: &runtimev1.AgentRequestContext{
			AppId:            "runtime",
			SubjectUserId:    fixture.ownerUserID,
			OwnerUserId:      fixture.ownerUserID,
			RuntimeSourceRef: "local-app-conversation-source",
			LocalAgentRef:    fixture.localAgentRef,
		},
		LocalAgentRef:    fixture.localAgentRef,
		OwnerUserId:      fixture.ownerUserID,
		RuntimeSourceRef: "local-app-conversation-source",
	})
	if err != nil {
		t.Fatalf("initialize local-app conversation agent: %v", err)
	}
	if response.GetAgent() == nil {
		t.Fatal("initialize local-app conversation agent returned no agent")
	}
	return fixture
}
