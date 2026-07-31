package runtimeagent

import (
	"context"
	"strings"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestConversationOpenConvergesAcrossDesktopAndLocalAppPrincipals(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentTestService(t)
	fixture := initializeLocalAppConversationAgentFixture(t, svc)
	metadata, err := structpb.NewStruct(map[string]any{"surface": "desktop-agent-chat"})
	if err != nil {
		t.Fatal(err)
	}
	desktop, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId: "nimi.desktop", SubjectUserId: fixture.ownerUserID, OwnerUserId: fixture.ownerUserID,
			RuntimeSourceRef: fixture.runtimeSourceRef, LocalAgentRef: fixture.localAgentRef,
		},
		SubjectUserId: fixture.ownerUserID,
		Metadata:      metadata,
	})
	if err != nil {
		t.Fatalf("desktop open: %v", err)
	}
	anchorID := desktop.GetSnapshot().GetAnchor().GetConversationAnchorId()

	openLocal := func(appID string, principalID string) *runtimev1.OpenConversationAnchorResponse {
		t.Helper()
		decision := localAppConversationDecision(fixture, appID, principalID, accountservice.LocalAppOperationOpenConversation)
		response, openErr := svc.OpenConversationAnchor(
			accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
			&runtimev1.OpenConversationAnchorRequest{AgentId: fixture.localAgentRef},
		)
		if openErr != nil {
			t.Fatalf("local-app open for %s: %v", principalID, openErr)
		}
		return response
	}
	principalA := openLocal("nimi.zhiyu", "principal-a")
	principalB := openLocal("nimi.tester", "principal-b")
	for carrier, response := range map[string]*runtimev1.OpenConversationAnchorResponse{
		"principal-a": principalA,
		"principal-b": principalB,
	} {
		if got := response.GetSnapshot().GetAnchor().GetConversationAnchorId(); got != anchorID {
			t.Fatalf("%s resolved anchor %q, want %q", carrier, got, anchorID)
		}
		if got := response.GetSnapshot().GetAnchor().GetMetadata().GetFields()["surface"].GetStringValue(); got != "desktop-agent-chat" {
			t.Fatalf("%s did not retain committed desktop metadata: %q", carrier, got)
		}
	}

	if err := svc.commitPublicChatTurnTranscript(anchorID, &runtimev1.ChatMessage{Role: "user", Content: "shared input"}, "shared reply"); err != nil {
		t.Fatalf("commit shared transcript: %v", err)
	}
	snapshotDecision := localAppConversationDecision(fixture, "nimi.tester", "principal-b", accountservice.LocalAppOperationConversationSnapshot)
	snapshot, err := svc.GetPublicChatSessionSnapshot(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
		&runtimev1.GetPublicChatSessionSnapshotRequest{AgentId: fixture.localAgentRef, ConversationAnchorId: anchorID},
	)
	if err != nil {
		t.Fatalf("principal-b shared snapshot: %v", err)
	}
	if got := snapshot.GetSnapshot().AsMap()["transcript_message_count"]; got != float64(2) {
		t.Fatalf("principal-b did not observe committed shared transcript: %v", snapshot.GetSnapshot().AsMap())
	}

	for _, principal := range []struct {
		appID string
		id    string
	}{{"nimi.zhiyu", "principal-a"}, {"nimi.tester", "principal-b"}} {
		decision := localAppConversationDecision(fixture, principal.appID, principal.id, accountservice.LocalAppOperationConversationSnapshot)
		ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
		if err := svc.ValidateLocalAppConversationScope(ctx, fixture.localAgentRef, anchorID); err != nil {
			t.Fatalf("shared scope rejected for %s: %v", principal.id, err)
		}
	}
	foreign := fixture
	foreign.ownerUserID = "foreign-account"
	foreignDecision := localAppConversationDecision(foreign, "nimi.zhiyu", "foreign-principal", accountservice.LocalAppOperationConversationSnapshot)
	foreignCtx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), foreignDecision)
	if err := svc.ValidateLocalAppConversationScope(foreignCtx, fixture.localAgentRef, anchorID); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("foreign account scope status=%s err=%v", status.Code(err), err)
	}
}

func TestConcurrentConversationFirstOpenCreatesOneAnchor(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentTestService(t)
	fixture := initializeLocalAppConversationAgentFixture(t, svc)
	const callers = 8
	start := make(chan struct{})
	ids := make(chan string, callers)
	errs := make(chan error, callers)
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			response, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
				Context: &runtimev1.AgentRequestContext{
					AppId: "nimi.desktop", SubjectUserId: fixture.ownerUserID, OwnerUserId: fixture.ownerUserID,
					RuntimeSourceRef: fixture.runtimeSourceRef, LocalAgentRef: fixture.localAgentRef,
				},
				SubjectUserId: fixture.ownerUserID,
			})
			if err != nil {
				errs <- err
				return
			}
			ids <- response.GetSnapshot().GetAnchor().GetConversationAnchorId()
		}()
	}
	close(start)
	wg.Wait()
	close(ids)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent first open: %v", err)
		}
	}
	canonical := ""
	for id := range ids {
		if canonical == "" {
			canonical = id
		}
		if id != canonical {
			t.Fatalf("concurrent opens returned %q and %q", canonical, id)
		}
	}
	svc.chatSurfaceMu.Lock()
	anchorCount := len(svc.chatAnchors)
	svc.chatSurfaceMu.Unlock()
	if canonical == "" || anchorCount != 1 {
		t.Fatalf("concurrent first open canonical=%q anchors=%d", canonical, anchorCount)
	}
}

func TestConversationOpenRejectsClosedSingletonWithoutReplacingIt(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentTestService(t)
	fixture := initializeLocalAppConversationAgentFixture(t, svc)
	decision := localAppConversationDecision(fixture, "nimi.zhiyu", "principal-a", accountservice.LocalAppOperationOpenConversation)
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	first, err := svc.OpenConversationAnchor(ctx, &runtimev1.OpenConversationAnchorRequest{AgentId: fixture.localAgentRef})
	if err != nil {
		t.Fatalf("first local-app open: %v", err)
	}
	anchorID := first.GetSnapshot().GetAnchor().GetConversationAnchorId()
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].Status = runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_CLOSED
	svc.chatSurfaceMu.Unlock()
	_, err = svc.OpenConversationAnchor(ctx, &runtimev1.OpenConversationAnchorRequest{AgentId: fixture.localAgentRef})
	if status.Code(err) != codes.FailedPrecondition || !strings.Contains(err.Error(), "runtime:repair-local-agent-chat") {
		t.Fatalf("closed singleton open status=%s err=%v", status.Code(err), err)
	}
	svc.chatSurfaceMu.Lock()
	anchorCount := len(svc.chatAnchors)
	closedAnchor := svc.chatAnchors[anchorID]
	svc.chatSurfaceMu.Unlock()
	if anchorCount != 1 || closedAnchor == nil ||
		closedAnchor.Status != runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_CLOSED {
		t.Fatalf("closed singleton was mutated or replaced: count=%d anchor=%+v", anchorCount, closedAnchor)
	}
}

func TestLocalAppConversationOpenAcceptsNoMetadataAndRejectsFields(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentTestService(t)
	fixture := initializeLocalAppConversationAgentFixture(t, svc)
	decision := localAppConversationDecision(fixture, "nimi.zhiyu", "principal-a", accountservice.LocalAppOperationOpenConversation)
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	opened, err := svc.OpenConversationAnchor(ctx, &runtimev1.OpenConversationAnchorRequest{AgentId: fixture.localAgentRef})
	if err != nil {
		t.Fatalf("local-app open without metadata: %v", err)
	}
	if opened.GetSnapshot().GetAnchor().GetConversationAnchorId() == "" {
		t.Fatal("local-app open without metadata returned no anchor")
	}
	if _, err := svc.OpenConversationAnchor(ctx, &runtimev1.OpenConversationAnchorRequest{
		AgentId: fixture.localAgentRef, Metadata: &structpb.Struct{},
	}); err != nil {
		t.Fatalf("local-app open with zero metadata fields: %v", err)
	}
	for _, fields := range []map[string]any{
		{"local_app_anchor_disposition": "create-or-resume"},
		{"surface": "local-app"},
	} {
		metadata, metadataErr := structpb.NewStruct(fields)
		if metadataErr != nil {
			t.Fatal(metadataErr)
		}
		_, openErr := svc.OpenConversationAnchor(ctx, &runtimev1.OpenConversationAnchorRequest{AgentId: fixture.localAgentRef, Metadata: metadata})
		if status.Code(openErr) != codes.PermissionDenied {
			t.Fatalf("local-app metadata fields status=%s err=%v", status.Code(openErr), openErr)
		}
	}
}

func localAppConversationDecision(fixture localAppConversationAgentFixture, appID string, principalID string, operation accountservice.LocalAppOperation) accountservice.LocalAppCallerDecision {
	return accountservice.LocalAppCallerDecision{
		AppID: appID, AccountID: fixture.ownerUserID, LocalAppPrincipalID: principalID,
		LocalAppRecordID: "record-" + principalID, LocalAgentID: fixture.localAgentRef, Operation: operation,
	}
}

type localAppConversationAgentFixture struct {
	ownerUserID      string
	localAgentRef    string
	runtimeSourceRef string
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
	fixture.runtimeSourceRef = response.GetAgent().GetRuntimeSourceRef()
	return fixture
}
