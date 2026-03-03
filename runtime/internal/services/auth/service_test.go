package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func buildTestJWT(t *testing.T, issuer string, expiresAt time.Time) string {
	t.Helper()
	header, err := json.Marshal(map[string]any{"alg": "RS256", "typ": "JWT"})
	if err != nil {
		t.Fatalf("marshal header: %v", err)
	}
	claims, err := json.Marshal(map[string]any{"iss": issuer, "exp": expiresAt.Unix()})
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	return base64.RawURLEncoding.EncodeToString(header) + "." +
		base64.RawURLEncoding.EncodeToString(claims) + "." +
		base64.RawURLEncoding.EncodeToString([]byte("test-signature"))
}

func TestAppSessionLifecycle(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	registerResp, err := svc.RegisterApp(ctx, &runtimev1.RegisterAppRequest{
		AppId:    "nimi.desktop",
		DeviceId: "local-device",
		ModeManifest: &runtimev1.AppModeManifest{
			AppMode:         runtimev1.AppMode_APP_MODE_FULL,
			RuntimeRequired: true,
			RealmRequired:   true,
			WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
		},
	})
	if err != nil {
		t.Fatalf("register app: %v", err)
	}
	if !registerResp.Accepted || registerResp.AppInstanceId == "" {
		t.Fatalf("register app failed: %+v", registerResp)
	}

	openResp, err := svc.OpenSession(ctx, &runtimev1.OpenSessionRequest{
		AppId:         "nimi.desktop",
		AppInstanceId: registerResp.AppInstanceId,
		DeviceId:      "local-device",
		SubjectUserId: "user-001",
		TtlSeconds:    600,
	})
	if err != nil {
		t.Fatalf("open session: %v", err)
	}
	if openResp.SessionId == "" || openResp.SessionToken == "" {
		t.Fatalf("open session invalid response: %+v", openResp)
	}

	refreshResp, err := svc.RefreshSession(ctx, &runtimev1.RefreshSessionRequest{SessionId: openResp.SessionId, TtlSeconds: 600})
	if err != nil {
		t.Fatalf("refresh session: %v", err)
	}
	if refreshResp.SessionToken == "" {
		t.Fatalf("refresh session did not issue token")
	}

	revokeResp, err := svc.RevokeSession(ctx, &runtimev1.RevokeSessionRequest{SessionId: openResp.SessionId})
	if err != nil {
		t.Fatalf("revoke session: %v", err)
	}
	if !revokeResp.Ok {
		t.Fatalf("revoke session must be ok")
	}

	refreshAfterRevoke, err := svc.RefreshSession(ctx, &runtimev1.RefreshSessionRequest{SessionId: openResp.SessionId, TtlSeconds: 600})
	if err != nil {
		t.Fatalf("refresh after revoke: %v", err)
	}
	if refreshAfterRevoke.ReasonCode != runtimev1.ReasonCode_APP_TOKEN_REVOKED {
		t.Fatalf("expected APP_TOKEN_REVOKED, got %v", refreshAfterRevoke.ReasonCode)
	}
}

func TestExternalPrincipalSessionLifecycle(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	registerPrincipalResp, err := svc.RegisterExternalPrincipal(ctx, &runtimev1.RegisterExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		ExternalPrincipalId:   "agent-openclaw",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		Issuer:                "https://issuer.nimi.local",
		ProofType:             runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_JWT,
	})
	if err != nil {
		t.Fatalf("register external principal: %v", err)
	}
	if !registerPrincipalResp.Accepted {
		t.Fatalf("register external principal must be accepted")
	}

	missingProofResp, err := svc.OpenExternalPrincipalSession(ctx, &runtimev1.OpenExternalPrincipalSessionRequest{
		AppId:               "nimi.desktop",
		ExternalPrincipalId: "agent-openclaw",
		Proof:               "",
	})
	if err != nil {
		t.Fatalf("open external principal session with missing proof: %v", err)
	}
	if missingProofResp.ReasonCode != runtimev1.ReasonCode_EXTERNAL_PRINCIPAL_PROOF_MISSING {
		t.Fatalf("expected proof missing, got %v", missingProofResp.ReasonCode)
	}

	openResp, err := svc.OpenExternalPrincipalSession(ctx, &runtimev1.OpenExternalPrincipalSessionRequest{
		AppId:               "nimi.desktop",
		ExternalPrincipalId: "agent-openclaw",
		Proof:               buildTestJWT(t, "https://issuer.nimi.local", time.Now().Add(5*time.Minute)),
	})
	if err != nil {
		t.Fatalf("open external principal session: %v", err)
	}
	if openResp.ExternalSessionId == "" || openResp.SessionToken == "" {
		t.Fatalf("invalid external session response: %+v", openResp)
	}

	revokeResp, err := svc.RevokeExternalPrincipalSession(ctx, &runtimev1.RevokeExternalPrincipalSessionRequest{ExternalSessionId: openResp.ExternalSessionId})
	if err != nil {
		t.Fatalf("revoke external principal session: %v", err)
	}
	if !revokeResp.Ok {
		t.Fatalf("revoke external principal session must be ok")
	}
}
