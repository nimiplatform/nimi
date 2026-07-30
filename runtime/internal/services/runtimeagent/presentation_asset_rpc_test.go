package runtimeagent

import (
	"bytes"
	"context"
	"database/sql"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/bundledavatar"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestGetAgentPresentationAssetReadsOnlyCurrentCommittedAvatar(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	firstMaterial := testPresentationVRMMaterialVariant("protected-read-first")
	firstRef := commitPresentationAssetForProtectedRead(t, svc, localAgentRef, accountID, 0, firstMaterial)
	callContext := bundledAvatarTestPrincipalContext("runtime.agent.read", accountID, make(chan struct{}))

	request := &runtimev1.GetAgentPresentationAssetRequest{
		Context:  &runtimev1.AgentRequestContext{AppId: bundledavatar.AppID},
		AgentId:  localAgentRef,
		AssetRef: firstRef,
	}
	response, err := svc.GetAgentPresentationAsset(callContext, request)
	if err != nil {
		t.Fatalf("get current presentation asset: %v", err)
	}
	if response.GetAssetRef() != firstRef ||
		response.GetRole() != runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR ||
		response.GetBackendKind() != runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM ||
		response.GetFileName() != firstMaterial.GetFileName() ||
		response.GetMediaType() != firstMaterial.GetMediaType() ||
		response.GetSha256() != firstMaterial.GetSha256() ||
		!bytes.Equal(response.GetContent(), firstMaterial.GetContent()) {
		t.Fatalf("presentation asset response = %#v", response)
	}
	if request.GetContext().GetOwnerUserId() != accountID ||
		request.GetContext().GetLocalAgentRef() != localAgentRef {
		t.Fatalf("protected selector was not hydrated from the Runtime Agent: %#v", request.GetContext())
	}

	secondMaterial := testPresentationVRMMaterialVariant("protected-read-second")
	secondRef := commitPresentationAssetForProtectedRead(t, svc, localAgentRef, accountID, 1, secondMaterial)
	_, err = svc.GetAgentPresentationAsset(callContext, &runtimev1.GetAgentPresentationAssetRequest{
		Context:  &runtimev1.AgentRequestContext{AppId: bundledavatar.AppID},
		AgentId:  localAgentRef,
		AssetRef: firstRef,
	})
	if status.Code(err) != codes.NotFound {
		t.Fatalf("previous presentation asset must not be readable, got %v", err)
	}
	if _, err := svc.GetAgentPresentationAsset(callContext, &runtimev1.GetAgentPresentationAssetRequest{
		Context:  &runtimev1.AgentRequestContext{AppId: bundledavatar.AppID},
		AgentId:  localAgentRef,
		AssetRef: secondRef,
	}); err != nil {
		t.Fatalf("get replacement current presentation asset: %v", err)
	}

	otherAccountContext := bundledAvatarTestPrincipalContext("runtime.agent.read", "account-other", make(chan struct{}))
	_, err = svc.GetAgentPresentationAsset(otherAccountContext, &runtimev1.GetAgentPresentationAssetRequest{
		Context:  &runtimev1.AgentRequestContext{AppId: bundledavatar.AppID},
		AgentId:  localAgentRef,
		AssetRef: secondRef,
	})
	if status.Code(err) != codes.NotFound {
		t.Fatalf("cross-account presentation asset read must fail closed, got %v", err)
	}
}

func TestGetAgentPresentationAssetRevalidatesStoredRecord(t *testing.T) {
	cases := []struct {
		name       string
		updateSQL  string
		updateArgs []any
	}{
		{
			name:       "role",
			updateSQL:  `UPDATE runtime_agent_presentation_asset SET asset_role = ? WHERE asset_ref = ?`,
			updateArgs: []any{int32(runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_BACKGROUND)},
		},
		{
			name:       "backend",
			updateSQL:  `UPDATE runtime_agent_presentation_asset SET backend_kind = ? WHERE asset_ref = ?`,
			updateArgs: []any{int32(runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_LIVE2D)},
		},
		{
			name:       "sha256",
			updateSQL:  `UPDATE runtime_agent_presentation_asset SET sha256 = ? WHERE asset_ref = ?`,
			updateArgs: []any{strings.Repeat("0", 64)},
		},
		{
			name:      "byte-length",
			updateSQL: `UPDATE runtime_agent_presentation_asset SET byte_length = byte_length + 1 WHERE asset_ref = ?`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
			ref := commitPresentationAssetForProtectedRead(
				t,
				svc,
				localAgentRef,
				accountID,
				0,
				testPresentationVRMMaterialVariant("corrupt-"+tc.name),
			)
			if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
				args := append(append([]any(nil), tc.updateArgs...), ref)
				_, err := tx.Exec(tc.updateSQL, args...)
				return err
			}); err != nil {
				t.Fatalf("corrupt presentation asset fixture: %v", err)
			}

			_, err := svc.GetAgentPresentationAsset(
				bundledAvatarTestPrincipalContext("runtime.agent.read", accountID, make(chan struct{})),
				&runtimev1.GetAgentPresentationAssetRequest{
					Context:  &runtimev1.AgentRequestContext{AppId: bundledavatar.AppID},
					AgentId:  localAgentRef,
					AssetRef: ref,
				},
			)
			if status.Code(err) != codes.DataLoss {
				t.Fatalf("corrupt %s must fail as data loss, got %v", tc.name, err)
			}
		})
	}
}

func TestGetAgentPresentationAssetRequiresBundledAvatarPrincipal(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	ref := commitPresentationAssetForProtectedRead(
		t,
		svc,
		localAgentRef,
		accountID,
		0,
		testPresentationVRMMaterialVariant("principal"),
	)
	_, err := svc.GetAgentPresentationAsset(context.Background(), &runtimev1.GetAgentPresentationAssetRequest{
		Context:  &runtimev1.AgentRequestContext{AppId: bundledavatar.AppID},
		AgentId:  localAgentRef,
		AssetRef: ref,
	})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("unprotected presentation asset read must fail closed, got %v", err)
	}
}

func commitPresentationAssetForProtectedRead(
	t *testing.T,
	svc *Service,
	localAgentRef string,
	accountID string,
	expectedRevision uint64,
	material *runtimev1.AgentPresentationAssetMaterial,
) string {
	t.Helper()
	response, err := svc.CommitLocalAppAgentPresentation(
		localAppConfigureContext(accountservice.LocalAppOperationCommitPresentation, localAgentRef, accountID),
		&runtimev1.CommitLocalAppAgentPresentationRequest{
			AgentHandle:                  "lah_v1_opaque",
			ExpectedPresentationRevision: expectedRevision,
			Intent: &runtimev1.LocalAppAgentPresentationIntent{
				BackendKind: runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
			},
			ImportedAssets: []*runtimev1.AgentPresentationAssetMaterial{material},
		},
	)
	if err != nil {
		t.Fatalf("commit presentation asset: %v", err)
	}
	ref := response.GetProjection().GetProfile().GetAvatarAssetRef()
	if ref == "" {
		t.Fatal("commit did not return an official avatar asset ref")
	}
	return ref
}
