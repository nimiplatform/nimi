package runtimeagent

import (
	"bytes"
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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

	read := func(decision accountservice.LocalAppCallerDecision, agentRef string) *runtimev1.GetAgentPresentationAssetResponse {
		t.Helper()
		response, err := svc.GetAgentPresentationAsset(
			accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
			&runtimev1.GetAgentPresentationAssetRequest{
				AgentHandle: mintLocalAppAgentHandle(decision, agentRef),
				AssetRef:    assetRef,
			})
		if err != nil {
			t.Fatalf("read %s for app %s: %v", agentRef, decision.AppID, err)
		}
		return response
	}
	appDecisions := []accountservice.LocalAppCallerDecision{
		localAppConfigureDecision(accountservice.LocalAppOperationPresentationSnapshot, 0x71, accountID),
		localAppConfigureDecision(accountservice.LocalAppOperationPresentationSnapshot, 0x72, accountID),
	}
	appDecisions[1].AppID = "nimi.ordinary.presentation"
	for _, decision := range appDecisions {
		firstRead := read(decision, firstAgentRef)
		secondRead := read(decision, secondAgentRef)
		if !bytes.Equal(firstRead.GetContent(), secondRead.GetContent()) || len(firstRead.GetContent()) == 0 {
			t.Fatalf("same-content scoped reads differ or are empty for app %s", decision.AppID)
		}
	}

	staleDecision := localAppConfigureDecision(accountservice.LocalAppOperationPresentationSnapshot, 0x73, accountID)
	_, err := svc.GetAgentPresentationAsset(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), staleDecision),
		&runtimev1.GetAgentPresentationAssetRequest{
			AgentHandle: mintLocalAppAgentHandle(appDecisions[0], firstAgentRef),
			AssetRef:    assetRef,
		})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("stale-session handle read code = %s, err=%v", status.Code(err), err)
	}

	foreignDecision := localAppConfigureDecision(accountservice.LocalAppOperationPresentationSnapshot, 0x74, "user-2")
	foreignDecision.AppID = "nimi.foreign.presentation"
	_, err = svc.GetAgentPresentationAsset(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), foreignDecision),
		&runtimev1.GetAgentPresentationAssetRequest{
			AgentHandle: mintLocalAppAgentHandle(foreignDecision, firstAgentRef),
			AssetRef:    assetRef,
		},
	)
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("foreign-account handle read code = %s, err=%v", status.Code(err), err)
	}
}
