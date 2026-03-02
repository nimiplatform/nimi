package grant

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/scopecatalog"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func newGrantServiceForTest() *Service {
	registry := appregistry.New()
	registry.Upsert("nimi.desktop", &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_FULL,
		RuntimeRequired: true,
		RealmRequired:   true,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
	}, nil)
	return NewWithDependencies(slog.New(slog.NewTextHandler(io.Discard, nil)), registry, scopecatalog.New())
}

func TestGrantAuthorizeValidateRevoke(t *testing.T) {
	svc := newGrantServiceForTest()
	ctx := context.Background()

	authorizeResp, err := svc.AuthorizeExternalPrincipal(ctx, &runtimev1.AuthorizeExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		Domain:                "app-auth",
		ExternalPrincipalId:   "agent-openclaw",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		SubjectUserId:         "user-001",
		ConsentId:             "consent-001",
		ConsentVersion:        "v1",
		DecisionAt:            timestamppb.Now(),
		PolicyVersion:         "p1",
		PolicyMode:            runtimev1.PolicyMode_POLICY_MODE_PRESET,
		Preset:                runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_DELEGATE,
		TtlSeconds:            600,
		ScopeCatalogVersion:   "sdk-v1",
	})
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	if authorizeResp.TokenId == "" || authorizeResp.Secret == "" {
		t.Fatalf("invalid authorize response: %+v", authorizeResp)
	}

	validateResp, err := svc.ValidateAppAccessToken(ctx, &runtimev1.ValidateAppAccessTokenRequest{
		AppId:           "nimi.desktop",
		TokenId:         authorizeResp.TokenId,
		SubjectUserId:   "user-001",
		RequestedScopes: []string{"read:chat"},
	})
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if !validateResp.Valid {
		t.Fatalf("token must be valid")
	}

	revokeResp, err := svc.RevokeAppAccessToken(ctx, &runtimev1.RevokeAppAccessTokenRequest{AppId: "nimi.desktop", TokenId: authorizeResp.TokenId})
	if err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if !revokeResp.Ok {
		t.Fatalf("revoke must succeed")
	}

	validateAfterRevoke, err := svc.ValidateAppAccessToken(ctx, &runtimev1.ValidateAppAccessTokenRequest{
		AppId:           "nimi.desktop",
		TokenId:         authorizeResp.TokenId,
		RequestedScopes: []string{"read:chat"},
	})
	if err != nil {
		t.Fatalf("validate after revoke: %v", err)
	}
	if validateAfterRevoke.ReasonCode != runtimev1.ReasonCode_APP_TOKEN_REVOKED {
		t.Fatalf("expected APP_TOKEN_REVOKED, got %v", validateAfterRevoke.ReasonCode)
	}
}

func TestGrantDelegateChain(t *testing.T) {
	svc := newGrantServiceForTest()
	ctx := context.Background()

	root, err := svc.AuthorizeExternalPrincipal(ctx, &runtimev1.AuthorizeExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		Domain:                "app-auth",
		ExternalPrincipalId:   "agent-openclaw",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		SubjectUserId:         "user-001",
		ConsentId:             "consent-001",
		ConsentVersion:        "v1",
		DecisionAt:            timestamppb.Now(),
		PolicyVersion:         "p1",
		PolicyMode:            runtimev1.PolicyMode_POLICY_MODE_PRESET,
		Preset:                runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_DELEGATE,
		TtlSeconds:            600,
		ScopeCatalogVersion:   "sdk-v1",
	})
	if err != nil {
		t.Fatalf("authorize root: %v", err)
	}

	child, err := svc.IssueDelegatedAccessToken(ctx, &runtimev1.IssueDelegatedAccessTokenRequest{
		AppId:         "nimi.desktop",
		ParentTokenId: root.TokenId,
		Scopes:        []string{"read:chat"},
		TtlSeconds:    120,
	})
	if err != nil {
		t.Fatalf("issue delegated token: %v", err)
	}
	if child.TokenId == "" || child.ParentTokenId != root.TokenId {
		t.Fatalf("invalid child token: %+v", child)
	}

	chainResp, err := svc.ListTokenChain(ctx, &runtimev1.ListTokenChainRequest{AppId: "nimi.desktop", RootTokenId: root.TokenId})
	if err != nil {
		t.Fatalf("list token chain: %v", err)
	}
	if len(chainResp.Nodes) != 2 {
		t.Fatalf("expected 2 chain nodes, got %d", len(chainResp.Nodes))
	}

	_, err = svc.IssueDelegatedAccessToken(ctx, &runtimev1.IssueDelegatedAccessTokenRequest{
		AppId:         "nimi.desktop",
		ParentTokenId: child.TokenId,
		Scopes:        []string{"read:chat"},
		TtlSeconds:    120,
	})
	if err == nil {
		t.Fatalf("second delegation must be rejected")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied, got %v", st.Code())
	}

	revokeResp, err := svc.RevokeAppAccessToken(ctx, &runtimev1.RevokeAppAccessTokenRequest{
		AppId:   "nimi.desktop",
		TokenId: root.TokenId,
	})
	if err != nil {
		t.Fatalf("revoke root token: %v", err)
	}
	if !revokeResp.GetOk() {
		t.Fatalf("expected revoke root ok")
	}
	validateChild, err := svc.ValidateAppAccessToken(ctx, &runtimev1.ValidateAppAccessTokenRequest{
		AppId:           "nimi.desktop",
		TokenId:         child.TokenId,
		RequestedScopes: []string{"read:chat"},
	})
	if err != nil {
		t.Fatalf("validate child after root revoke: %v", err)
	}
	if validateChild.GetValid() {
		t.Fatalf("expected child token invalid after root revoke")
	}
	if validateChild.GetReasonCode() != runtimev1.ReasonCode_APP_TOKEN_REVOKED {
		t.Fatalf("unexpected child revoke reason: %v", validateChild.GetReasonCode())
	}
}

func TestListTokenChainRootRequiredReasonCode(t *testing.T) {
	svc := newGrantServiceForTest()
	ctx := context.Background()

	_, err := svc.ListTokenChain(ctx, &runtimev1.ListTokenChainRequest{})
	if err == nil {
		t.Fatal("expected error for missing root_token_id")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error")
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_GRANT_TOKEN_CHAIN_ROOT_REQUIRED.String() {
		t.Fatalf("expected GRANT_TOKEN_CHAIN_ROOT_REQUIRED, got %s", st.Message())
	}
}

func TestListTokenChainRootNotFoundReasonCode(t *testing.T) {
	svc := newGrantServiceForTest()
	ctx := context.Background()

	_, err := svc.ListTokenChain(ctx, &runtimev1.ListTokenChainRequest{RootTokenId: "nonexistent"})
	if err == nil {
		t.Fatal("expected error for nonexistent root_token_id")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error")
	}
	if st.Code() != codes.NotFound {
		t.Fatalf("expected NotFound, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_GRANT_TOKEN_CHAIN_ROOT_NOT_FOUND.String() {
		t.Fatalf("expected GRANT_TOKEN_CHAIN_ROOT_NOT_FOUND, got %s", st.Message())
	}
}

func TestGrantAuthorizeRejectsMissingOrInvalidConsent(t *testing.T) {
	svc := newGrantServiceForTest()
	ctx := context.Background()

	_, err := svc.AuthorizeExternalPrincipal(ctx, &runtimev1.AuthorizeExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		Domain:                "app-auth",
		ExternalPrincipalId:   "agent-openclaw",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		SubjectUserId:         "user-001",
		ConsentVersion:        "v1",
		DecisionAt:            timestamppb.Now(),
		PolicyVersion:         "p1",
		PolicyMode:            runtimev1.PolicyMode_POLICY_MODE_PRESET,
		Preset:                runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_READ_ONLY,
		ScopeCatalogVersion:   "sdk-v1",
	})
	if err == nil {
		t.Fatalf("expected consent missing error")
	}
	st, ok := status.FromError(err)
	if !ok || st.Code() != codes.PermissionDenied || st.Message() != runtimev1.ReasonCode_APP_CONSENT_MISSING.String() {
		t.Fatalf("unexpected consent missing error: %v", err)
	}

	_, err = svc.AuthorizeExternalPrincipal(ctx, &runtimev1.AuthorizeExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		Domain:                "app-auth",
		ExternalPrincipalId:   "agent-openclaw",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		SubjectUserId:         "user-001",
		ConsentId:             "consent-001",
		ConsentVersion:        "v1",
		PolicyVersion:         "p1",
		PolicyMode:            runtimev1.PolicyMode_POLICY_MODE_PRESET,
		Preset:                runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_READ_ONLY,
		ScopeCatalogVersion:   "sdk-v1",
	})
	if err == nil {
		t.Fatalf("expected consent invalid error")
	}
	st, ok = status.FromError(err)
	if !ok || st.Code() != codes.PermissionDenied || st.Message() != runtimev1.ReasonCode_APP_CONSENT_INVALID.String() {
		t.Fatalf("unexpected consent invalid error: %v", err)
	}
}

func TestGrantPolicyUpdateInvalidatesExistingToken(t *testing.T) {
	svc := newGrantServiceForTest()
	ctx := context.Background()

	rootV1, err := svc.AuthorizeExternalPrincipal(ctx, &runtimev1.AuthorizeExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		Domain:                "app-auth",
		ExternalPrincipalId:   "agent-openclaw",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		SubjectUserId:         "user-001",
		ConsentId:             "consent-001",
		ConsentVersion:        "v1",
		DecisionAt:            timestamppb.Now(),
		PolicyVersion:         "policy-v1",
		PolicyMode:            runtimev1.PolicyMode_POLICY_MODE_PRESET,
		Preset:                runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_READ_ONLY,
		ScopeCatalogVersion:   "sdk-v1",
	})
	if err != nil {
		t.Fatalf("authorize v1: %v", err)
	}

	_, err = svc.AuthorizeExternalPrincipal(ctx, &runtimev1.AuthorizeExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		Domain:                "app-auth",
		ExternalPrincipalId:   "agent-openclaw",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		SubjectUserId:         "user-001",
		ConsentId:             "consent-001",
		ConsentVersion:        "v2",
		DecisionAt:            timestamppb.Now(),
		PolicyVersion:         "policy-v2",
		PolicyMode:            runtimev1.PolicyMode_POLICY_MODE_PRESET,
		Preset:                runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_READ_ONLY,
		ScopeCatalogVersion:   "sdk-v1",
	})
	if err != nil {
		t.Fatalf("authorize v2: %v", err)
	}

	validate, err := svc.ValidateAppAccessToken(ctx, &runtimev1.ValidateAppAccessTokenRequest{
		AppId:           "nimi.desktop",
		TokenId:         rootV1.TokenId,
		SubjectUserId:   "user-001",
		RequestedScopes: []string{"read:*"},
	})
	if err != nil {
		t.Fatalf("validate old token: %v", err)
	}
	if validate.GetValid() {
		t.Fatalf("expected old token invalid after policy update")
	}
	if validate.GetReasonCode() != runtimev1.ReasonCode_APP_TOKEN_REVOKED && validate.GetReasonCode() != runtimev1.ReasonCode_APP_GRANT_INVALID {
		t.Fatalf("unexpected reason code after policy update: %v", validate.GetReasonCode())
	}
}

func TestGrantResourceSelectorsSubsetAndOutOfScopeDeny(t *testing.T) {
	svc := newGrantServiceForTest()
	ctx := context.Background()

	token, err := svc.AuthorizeExternalPrincipal(ctx, &runtimev1.AuthorizeExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		Domain:                "app-auth",
		ExternalPrincipalId:   "agent-openclaw",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		SubjectUserId:         "user-001",
		ConsentId:             "consent-001",
		ConsentVersion:        "v1",
		DecisionAt:            timestamppb.Now(),
		PolicyVersion:         "p1",
		PolicyMode:            runtimev1.PolicyMode_POLICY_MODE_CUSTOM,
		Scopes:                []string{"read:chat"},
		ResourceSelectors: &runtimev1.ResourceSelectors{
			ConversationIds: []string{"conv-1"},
		},
		ScopeCatalogVersion: "sdk-v1",
	})
	if err != nil {
		t.Fatalf("authorize with selectors: %v", err)
	}

	allowed, err := svc.ValidateAppAccessToken(ctx, &runtimev1.ValidateAppAccessTokenRequest{
		AppId:           "nimi.desktop",
		TokenId:         token.TokenId,
		SubjectUserId:   "user-001",
		RequestedScopes: []string{"read:chat"},
		ResourceSelectors: &runtimev1.ResourceSelectors{
			ConversationIds: []string{"conv-1"},
		},
	})
	if err != nil {
		t.Fatalf("validate in-scope selectors: %v", err)
	}
	if !allowed.GetValid() {
		t.Fatalf("expected in-scope selectors allowed")
	}

	denied, err := svc.ValidateAppAccessToken(ctx, &runtimev1.ValidateAppAccessTokenRequest{
		AppId:           "nimi.desktop",
		TokenId:         token.TokenId,
		SubjectUserId:   "user-001",
		RequestedScopes: []string{"read:chat"},
		ResourceSelectors: &runtimev1.ResourceSelectors{
			ConversationIds: []string{"conv-2"},
		},
	})
	if err != nil {
		t.Fatalf("validate out-of-scope selectors: %v", err)
	}
	if denied.GetValid() {
		t.Fatalf("expected out-of-scope selectors denied")
	}
	if denied.GetReasonCode() != runtimev1.ReasonCode_APP_RESOURCE_OUT_OF_SCOPE {
		t.Fatalf("unexpected reason code for out-of-scope: %v", denied.GetReasonCode())
	}
}
