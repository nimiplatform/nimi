package runtimeagent

import (
	"bytes"
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/bundledavatar"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestPresentationAssetContentRefRemainsStrictlyHandleAndAgentScoped(t *testing.T) {
	svc, accountID, firstAgentRef := newLocalAppConfigureTestService(t)
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-configure-second"),
	}); err != nil {
		t.Fatalf("materialize second Agent: %v", err)
	}
	secondAgentRef := testRuntimeAgentLocalRef("agent-configure-second")

	commitDecision := localAppConfigureDecision(accountservice.LocalAppOperationCommitPresentation, 0x71, accountID)
	commitDecision.AppID = bundledavatar.AppID
	commitCtx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), commitDecision)
	commit := func(agentRef string) *runtimev1.LocalAppAgentCommitPresentationResponse {
		t.Helper()
		response, err := svc.CommitLocalAppAgentPresentation(commitCtx, &runtimev1.CommitLocalAppAgentPresentationRequest{
			AgentHandle:                  mintLocalAppAgentHandle(commitDecision, agentRef),
			ExpectedPresentationRevision: 0,
			Intent: &runtimev1.LocalAppAgentPresentationIntent{Patch: &runtimev1.AgentPresentationProfilePatch{
				BackendKind: runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM.Enum(),
			}},
			ImportedAssets: []*runtimev1.AgentPresentationAssetMaterial{testPresentationVRMMaterial()},
		})
		if err != nil {
			t.Fatalf("commit %s: %v", agentRef, err)
		}
		return response
	}
	first := commit(firstAgentRef)
	second := commit(secondAgentRef)
	assetRef := first.GetProjection().GetProfile().GetAvatarAssetRef()
	if assetRef == "" || second.GetProjection().GetProfile().GetAvatarAssetRef() != assetRef {
		t.Fatalf("same-content refs differ: first=%q second=%q", assetRef, second.GetProjection().GetProfile().GetAvatarAssetRef())
	}

	for _, agentRef := range []string{firstAgentRef, secondAgentRef} {
		record, exists, err := svc.presentationAssetByRef(context.Background(), agentRef, assetRef)
		if err != nil || !exists || record == nil || record.LocalAgentRef != agentRef {
			t.Fatalf("scoped asset %s = (%+v, %v, %v)", agentRef, record, exists, err)
		}
	}
	if record, exists, err := svc.presentationAssetByRef(context.Background(), "local-agent:user-1:foreign", assetRef); err != nil || exists || record != nil {
		t.Fatalf("foreign scoped lookup leaked existence: record=%+v exists=%v err=%v", record, exists, err)
	}

	snapshotDecision := localAppConfigureDecision(accountservice.LocalAppOperationPresentationSnapshot, 0x71, accountID)
	snapshotDecision.AppID = bundledavatar.AppID
	readCtx := bundledAvatarTestPrincipalContext("agent.configure", accountID, make(chan struct{}))
	readCtx = accountservice.ContextWithAuthorizedLocalAppDecision(readCtx, snapshotDecision)
	read := func(agentRef string) *runtimev1.GetAgentPresentationAssetResponse {
		t.Helper()
		response, err := svc.GetAgentPresentationAsset(readCtx, &runtimev1.GetAgentPresentationAssetRequest{
			AgentHandle: mintLocalAppAgentHandle(snapshotDecision, agentRef),
			AssetRef:    assetRef,
		})
		if err != nil {
			t.Fatalf("read %s: %v", agentRef, err)
		}
		return response
	}
	firstRead := read(firstAgentRef)
	secondRead := read(secondAgentRef)
	if !bytes.Equal(firstRead.GetContent(), secondRead.GetContent()) || len(firstRead.GetContent()) == 0 {
		t.Fatalf("same-content scoped reads differ or are empty")
	}

	foreignDecision := localAppConfigureDecision(accountservice.LocalAppOperationPresentationSnapshot, 0x72, accountID)
	foreignDecision.AppID = bundledavatar.AppID
	foreignCtx := bundledAvatarTestPrincipalContext("agent.configure", accountID, make(chan struct{}))
	foreignCtx = accountservice.ContextWithAuthorizedLocalAppDecision(foreignCtx, foreignDecision)
	_, err := svc.GetAgentPresentationAsset(foreignCtx, &runtimev1.GetAgentPresentationAssetRequest{
		AgentHandle: mintLocalAppAgentHandle(snapshotDecision, firstAgentRef),
		AssetRef:    assetRef,
	})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("foreign-session handle read code = %s, err=%v", status.Code(err), err)
	}
}
