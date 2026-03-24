package grant

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/scopecatalog"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func newGrantServiceForTest() *Service {
	registry := appregistry.New()
	if err := registry.Upsert("nimi.desktop", &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_FULL,
		RuntimeRequired: true,
		RealmRequired:   true,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
	}, nil); err != nil {
		panic(err)
	}
	return NewWithDependencies(slog.New(slog.NewTextHandler(io.Discard, nil)), registry, scopecatalog.New())
}

func TestGrantAuthorizeValidateRevoke(t *testing.T) {
	// K-GRANT-008: validate returns issued_scope_catalog_version.
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
	if validateResp.GetIssuedScopeCatalogVersion() != "sdk-v1" {
		t.Fatalf("expected issued_scope_catalog_version sdk-v1, got %q", validateResp.GetIssuedScopeCatalogVersion())
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

func TestGrantServiceAuditUsesIncomingTraceID(t *testing.T) {
	registry := appregistry.New()
	if err := registry.Upsert("nimi.desktop", &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_FULL,
		RuntimeRequired: true,
		RealmRequired:   true,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
	}, nil); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	store := auditlog.New(16, 16)
	svc := NewWithDependencies(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		registry,
		scopecatalog.New(),
		WithAuditStore(store),
	)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-trace-id", "trace-grant-001"))

	_, err := svc.AuthorizeExternalPrincipal(ctx, &runtimev1.AuthorizeExternalPrincipalRequest{
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

	resp, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{})
	if err != nil {
		t.Fatalf("list grant audit events: %v", err)
	}
	if len(resp.GetEvents()) == 0 {
		t.Fatalf("expected grant audit event")
	}
	event := resp.GetEvents()[0]
	if event.GetTraceId() != "trace-grant-001" {
		t.Fatalf("unexpected trace id: %q", event.GetTraceId())
	}
	if event.GetAuditId() == "" {
		t.Fatalf("expected audit id to be set")
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
	if len(chainResp.Entries) != 2 {
		t.Fatalf("expected 2 chain entries, got %d", len(chainResp.Entries))
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

func TestListTokenChainPageSizeClampTo200(t *testing.T) {
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

	for i := 0; i < 140; i++ {
		if _, err := svc.IssueDelegatedAccessToken(ctx, &runtimev1.IssueDelegatedAccessTokenRequest{
			AppId:         "nimi.desktop",
			ParentTokenId: root.GetTokenId(),
			Scopes:        []string{"read:chat"},
			TtlSeconds:    120,
		}); err != nil {
			t.Fatalf("issue delegated token %d: %v", i, err)
		}
	}

	chainResp, err := svc.ListTokenChain(ctx, &runtimev1.ListTokenChainRequest{
		AppId:          "nimi.desktop",
		RootTokenId:    root.GetTokenId(),
		PageSize:       999,
		PageToken:      "",
		IncludeRevoked: true,
	})
	if err != nil {
		t.Fatalf("list token chain: %v", err)
	}
	if len(chainResp.GetEntries()) != 141 {
		t.Fatalf("expected 141 entries on clamped first page, got %d", len(chainResp.GetEntries()))
	}
	if chainResp.GetHasMore() {
		t.Fatalf("expected has_more=false when all entries fit in clamped page")
	}
	if chainResp.GetNextPageToken() != "" {
		t.Fatalf("expected no next_page_token when all entries fit in clamped page")
	}
}

func TestValidateProtectedCapabilityRequiresMatchingSecret(t *testing.T) {
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

	if reason, _, ok := svc.ValidateProtectedCapability("nimi.desktop", authorizeResp.GetTokenId(), "wrong-secret", "read:chat"); ok || reason != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED {
		t.Fatalf("expected wrong secret rejected, got reason=%v ok=%v", reason, ok)
	}
	if reason, _, ok := svc.ValidateProtectedCapability("nimi.desktop", authorizeResp.GetTokenId(), authorizeResp.GetSecret(), "read:chat"); !ok || reason != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("expected valid secret accepted, got reason=%v ok=%v", reason, ok)
	}
}

func TestValidateAppAccessTokenMissingTokenReturnsGrantInvalid(t *testing.T) {
	svc := newGrantServiceForTest()
	ctx := context.Background()

	start := time.Now()
	resp, err := svc.ValidateAppAccessToken(ctx, &runtimev1.ValidateAppAccessTokenRequest{
		AppId:   "nimi.desktop",
		TokenId: "missing-token",
	})
	if err != nil {
		t.Fatalf("ValidateAppAccessToken: %v", err)
	}
	if resp.GetValid() {
		t.Fatalf("missing token must be invalid")
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_APP_GRANT_INVALID {
		t.Fatalf("unexpected reason code: %v", resp.GetReasonCode())
	}
	if time.Since(start) < 0 {
		t.Fatalf("impossible timing guard")
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

func TestInvalidScopePrefixRejected(t *testing.T) {
	// K-GRANT-009: invalid scope prefixes must return APP_SCOPE_FORBIDDEN.
	svc := newGrantServiceForTest()
	ctx := context.Background()

	_, err := svc.AuthorizeExternalPrincipal(ctx, &runtimev1.AuthorizeExternalPrincipalRequest{
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
		Scopes:                []string{"unknown.scope"},
		ResourceSelectors:     &runtimev1.ResourceSelectors{ConversationIds: []string{"conv-1"}},
		ScopeCatalogVersion:   "sdk-v1",
	})
	if err == nil {
		t.Fatal("expected invalid scope prefix error")
	}
	st, ok := status.FromError(err)
	if !ok || st.Code() != codes.PermissionDenied || st.Message() != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN.String() {
		t.Fatalf("unexpected authorize error: %v", err)
	}

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
		ResourceSelectors:     &runtimev1.ResourceSelectors{ConversationIds: []string{"conv-1"}},
		CanDelegate:           true,
		MaxDelegationDepth:    2,
		ScopeCatalogVersion:   "sdk-v1",
	})
	if err != nil {
		t.Fatalf("authorize valid token: %v", err)
	}

	_, err = svc.IssueDelegatedAccessToken(ctx, &runtimev1.IssueDelegatedAccessTokenRequest{
		AppId:         "nimi.desktop",
		ParentTokenId: token.GetTokenId(),
		Scopes:        []string{"unknown.scope"},
	})
	if err == nil {
		t.Fatal("expected invalid delegated scope prefix error")
	}
	st, ok = status.FromError(err)
	if !ok || st.Code() != codes.PermissionDenied || st.Message() != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN.String() {
		t.Fatalf("unexpected delegated scope error: %v", err)
	}

	validateResp, err := svc.ValidateAppAccessToken(ctx, &runtimev1.ValidateAppAccessTokenRequest{
		AppId:           "nimi.desktop",
		TokenId:         token.GetTokenId(),
		SubjectUserId:   "user-001",
		RequestedScopes: []string{"unknown.scope"},
	})
	if err != nil {
		t.Fatalf("validate invalid scope prefix: %v", err)
	}
	if validateResp.GetValid() {
		t.Fatalf("expected invalid requested scope prefix to be denied")
	}
	if validateResp.GetReasonCode() != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN {
		t.Fatalf("expected APP_SCOPE_FORBIDDEN, got %v", validateResp.GetReasonCode())
	}
}

func TestRevokedScopeExcludedFromEffectiveScopes(t *testing.T) {
	// K-GRANT-010: revoked scopes narrow effective_scopes without invalidating the token wholesale.
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
		Scopes:                []string{"read:chat", "write:chat"},
		ResourceSelectors:     &runtimev1.ResourceSelectors{ConversationIds: []string{"conv-1"}},
		ScopeCatalogVersion:   "sdk-v1",
	})
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}

	svc.catalog.RevokeScope("sdk-v1", "write:chat")

	allowed, err := svc.ValidateAppAccessToken(ctx, &runtimev1.ValidateAppAccessTokenRequest{
		AppId:           "nimi.desktop",
		TokenId:         token.GetTokenId(),
		SubjectUserId:   "user-001",
		RequestedScopes: []string{"read:chat"},
	})
	if err != nil {
		t.Fatalf("validate active scopes: %v", err)
	}
	if !allowed.GetValid() {
		t.Fatalf("expected token to remain valid for active scopes")
	}
	if len(allowed.GetEffectiveScopes()) != 1 || allowed.GetEffectiveScopes()[0] != "read:chat" {
		t.Fatalf("expected effective scopes to be narrowed, got %#v", allowed.GetEffectiveScopes())
	}

	revoked, err := svc.ValidateAppAccessToken(ctx, &runtimev1.ValidateAppAccessTokenRequest{
		AppId:           "nimi.desktop",
		TokenId:         token.GetTokenId(),
		SubjectUserId:   "user-001",
		RequestedScopes: []string{"write:chat"},
	})
	if err != nil {
		t.Fatalf("validate revoked scope: %v", err)
	}
	if revoked.GetValid() {
		t.Fatalf("expected revoked scope request to be denied")
	}
	if revoked.GetReasonCode() != runtimev1.ReasonCode_APP_SCOPE_REVOKED {
		t.Fatalf("expected APP_SCOPE_REVOKED, got %v", revoked.GetReasonCode())
	}
}

func TestGrantAuthorizeRejectsPresetModeWithoutPreset(t *testing.T) {
	svc := newGrantServiceForTest()
	ctx := context.Background()

	_, err := svc.AuthorizeExternalPrincipal(ctx, &runtimev1.AuthorizeExternalPrincipalRequest{
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
		ScopeCatalogVersion:   "sdk-v1",
	})
	if err == nil {
		t.Fatalf("expected preset mode without preset to be rejected")
	}
	st, ok := status.FromError(err)
	if !ok || st.Code() != codes.InvalidArgument || st.Message() != runtimev1.ReasonCode_APP_GRANT_INVALID.String() {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestGrantAuthorizeRejectsCustomModeWithoutSelectors(t *testing.T) {
	svc := newGrantServiceForTest()
	ctx := context.Background()

	_, err := svc.AuthorizeExternalPrincipal(ctx, &runtimev1.AuthorizeExternalPrincipalRequest{
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
		ScopeCatalogVersion:   "sdk-v1",
	})
	if err == nil {
		t.Fatalf("expected custom mode without selectors to be rejected")
	}
	st, ok := status.FromError(err)
	if !ok || st.Code() != codes.InvalidArgument || st.Message() != runtimev1.ReasonCode_APP_GRANT_INVALID.String() {
		t.Fatalf("unexpected error: %v", err)
	}
}
