package auth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func buildTestJWT(t *testing.T, issuer string, expiresAt time.Time, privateKey *rsa.PrivateKey) string {
	t.Helper()
	issuedAt := expiresAt.Add(-5 * time.Minute)
	return buildTestJWTWithClaims(t, map[string]any{"iss": issuer, "iat": issuedAt.Unix(), "exp": expiresAt.Unix()}, privateKey)
}

func buildTestJWTWithClaims(t *testing.T, claimsPayload map[string]any, privateKey *rsa.PrivateKey) string {
	t.Helper()
	header, err := json.Marshal(map[string]any{"alg": "RS256", "typ": "JWT"})
	if err != nil {
		t.Fatalf("marshal header: %v", err)
	}
	claims, err := json.Marshal(claimsPayload)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	signingInput := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signingInput))
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func buildExpOmittedJWT(t *testing.T, issuer string, privateKey *rsa.PrivateKey) string {
	t.Helper()
	header, err := json.Marshal(map[string]any{"alg": "RS256", "typ": "JWT"})
	if err != nil {
		t.Fatalf("marshal header: %v", err)
	}
	claims, err := json.Marshal(map[string]any{"iss": issuer})
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	signingInput := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signingInput))
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func encodePublicKeyDERBase64(t *testing.T, pub *rsa.PublicKey) string {
	t.Helper()
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		t.Fatalf("marshal public key: %v", err)
	}
	return base64.StdEncoding.EncodeToString(der)
}

func sessionContext(sessionID string, sessionToken string) context.Context {
	return metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-session-id", sessionID,
		"x-nimi-session-token", sessionToken,
	))
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

	refreshResp, err := svc.RefreshSession(sessionContext(openResp.GetSessionId(), openResp.GetSessionToken()), &runtimev1.RefreshSessionRequest{
		SessionId:  openResp.SessionId,
		TtlSeconds: 600,
	})
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

	refreshAfterRevoke, err := svc.RefreshSession(sessionContext(openResp.GetSessionId(), openResp.GetSessionToken()), &runtimev1.RefreshSessionRequest{
		SessionId:  openResp.SessionId,
		TtlSeconds: 600,
	})
	if err != nil {
		t.Fatalf("refresh after revoke: %v", err)
	}
	if refreshAfterRevoke.ReasonCode != runtimev1.ReasonCode_APP_TOKEN_REVOKED {
		t.Fatalf("expected APP_TOKEN_REVOKED, got %v", refreshAfterRevoke.ReasonCode)
	}
}

func TestRegisterAppMaintainsPerAppIndexOncePerInstance(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	req := &runtimev1.RegisterAppRequest{
		AppId:         "nimi.desktop",
		AppInstanceId: "instance-1",
		ModeManifest: &runtimev1.AppModeManifest{
			AppMode:         runtimev1.AppMode_APP_MODE_FULL,
			RuntimeRequired: true,
			RealmRequired:   true,
			WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
		},
	}

	if _, err := svc.RegisterApp(ctx, req); err != nil {
		t.Fatalf("first register app: %v", err)
	}
	if _, err := svc.RegisterApp(ctx, req); err != nil {
		t.Fatalf("second register app: %v", err)
	}

	svc.mu.RLock()
	defer svc.mu.RUnlock()
	if got := svc.registeredApps["nimi.desktop"]; got != 1 {
		t.Fatalf("registeredApps[nimi.desktop] = %d, want 1", got)
	}
	if !svc.appRegisteredLocked("nimi.desktop") {
		t.Fatalf("appRegisteredLocked should use maintained index")
	}
}

func TestExternalPrincipalSessionLifecycle(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	publicKey := encodePublicKeyDERBase64(t, &privateKey.PublicKey)

	registerPrincipalResp, err := svc.RegisterExternalPrincipal(ctx, &runtimev1.RegisterExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		ExternalPrincipalId:   "agent-openclaw",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		Issuer:                "https://issuer.nimi.xyz",
		SignatureKeyId:        publicKey,
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
		Proof:               buildTestJWT(t, "https://issuer.nimi.xyz", time.Now().Add(5*time.Minute), privateKey),
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
	svc.mu.RLock()
	_, exists := svc.externalSessions[openResp.ExternalSessionId]
	svc.mu.RUnlock()
	if exists {
		t.Fatalf("revoked external session must be removed from in-memory store")
	}
}

func TestRevokeExternalPrincipalSessionMissingRecordKeepsAuditPayloadScoped(t *testing.T) {
	store := auditlog.New(16, 16)
	svc := NewWithDependencies(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, store, 60, 86400)

	resp, err := svc.RevokeExternalPrincipalSession(context.Background(), &runtimev1.RevokeExternalPrincipalSessionRequest{
		ExternalSessionId: "ext_missing",
	})
	if err != nil {
		t.Fatalf("revoke external principal session: %v", err)
	}
	if !resp.GetOk() {
		t.Fatalf("expected ok response, got %+v", resp)
	}

	events, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{})
	if err != nil {
		t.Fatalf("list audit events: %v", err)
	}
	if len(events.GetEvents()) == 0 {
		t.Fatal("expected audit event")
	}
	payload := events.GetEvents()[0].GetPayload().AsMap()
	if _, ok := payload["external_principal_id"]; ok {
		t.Fatalf("unexpected external_principal_id in payload: %+v", payload)
	}
	if _, ok := payload["external_session_id"]; !ok {
		t.Fatalf("expected external_session_id in payload: %+v", payload)
	}
}

func TestRegisterExternalPrincipalRequiresSignatureKey(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	_, err := svc.RegisterExternalPrincipal(context.Background(), &runtimev1.RegisterExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		ExternalPrincipalId:   "agent-openclaw",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		Issuer:                "https://issuer.nimi.xyz",
		ProofType:             runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_JWT,
	})
	if err == nil {
		t.Fatalf("expected error for missing signature key")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status, got %v", err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String() {
		t.Fatalf("expected protocol invalid reason, got %s", st.Message())
	}
}

func TestOpenSessionRejectsTTLBounds(t *testing.T) {
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

	for _, ttl := range []int32{59, 86401} {
		_, err := svc.OpenSession(ctx, &runtimev1.OpenSessionRequest{
			AppId:         "nimi.desktop",
			AppInstanceId: registerResp.GetAppInstanceId(),
			DeviceId:      "local-device",
			SubjectUserId: "user-001",
			TtlSeconds:    ttl,
		})
		if err == nil {
			t.Fatalf("expected ttl %d rejected", ttl)
		}
		st, ok := status.FromError(err)
		if !ok || st.Code() != codes.InvalidArgument {
			t.Fatalf("ttl %d: expected InvalidArgument, got %v", ttl, err)
		}
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
			t.Fatalf("ttl %d: expected structured protocol invalid, got %v", ttl, reason)
		}
	}
}

func TestNewWithDependenciesPreservesInt32TTLBounds(t *testing.T) {
	svc := NewWithDependencies(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, 123, 456)
	if svc.ttlMinSeconds != 123 || svc.ttlMaxSeconds != 456 {
		t.Fatalf("unexpected ttl bounds: min=%d max=%d", svc.ttlMinSeconds, svc.ttlMaxSeconds)
	}
}

func TestOpenSessionDefaultTTL3600(t *testing.T) {
	// K-AUTHSVC-011: omitted ttl_seconds uses the default 3600s TTL.
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

	openResp, err := svc.OpenSession(ctx, &runtimev1.OpenSessionRequest{
		AppId:         "nimi.desktop",
		AppInstanceId: registerResp.GetAppInstanceId(),
		DeviceId:      "local-device",
		SubjectUserId: "user-001",
	})
	if err != nil {
		t.Fatalf("open session: %v", err)
	}
	if got := openResp.GetExpiresAt().AsTime().Sub(openResp.GetIssuedAt().AsTime()); got != time.Hour {
		t.Fatalf("expected default TTL 1h, got %s", got)
	}
}

func TestSessionLostAfterServiceReset(t *testing.T) {
	// K-AUTHSVC-012: sessions are memory-only and disappear after service reset.
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
	openResp, err := svc.OpenSession(ctx, &runtimev1.OpenSessionRequest{
		AppId:         "nimi.desktop",
		AppInstanceId: registerResp.GetAppInstanceId(),
		DeviceId:      "local-device",
		SubjectUserId: "user-001",
		TtlSeconds:    600,
	})
	if err != nil {
		t.Fatalf("open session: %v", err)
	}

	resetSvc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	refreshResp, err := resetSvc.RefreshSession(sessionContext(openResp.GetSessionId(), openResp.GetSessionToken()), &runtimev1.RefreshSessionRequest{
		SessionId:  openResp.GetSessionId(),
		TtlSeconds: 600,
	})
	if err != nil {
		t.Fatalf("refresh after reset: %v", err)
	}
	if refreshResp.GetReasonCode() != runtimev1.ReasonCode_APP_TOKEN_REVOKED {
		t.Fatalf("expected APP_TOKEN_REVOKED after reset, got %v", refreshResp.GetReasonCode())
	}
}

func TestExternalPrincipalProofValidation(t *testing.T) {
	// K-AUTHSVC-013: proof validation distinguishes expired, issuer mismatch, and unsupported proof types.
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	publicKey := encodePublicKeyDERBase64(t, &privateKey.PublicKey)

	_, err = svc.RegisterExternalPrincipal(ctx, &runtimev1.RegisterExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		ExternalPrincipalId:   "agent-openclaw",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		Issuer:                "https://issuer.nimi.xyz",
		SignatureKeyId:        publicKey,
		ProofType:             runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_JWT,
	})
	if err != nil {
		t.Fatalf("register external principal: %v", err)
	}

	tests := []struct {
		name       string
		request    *runtimev1.OpenExternalPrincipalSessionRequest
		wantCode   codes.Code
		wantReason runtimev1.ReasonCode
	}{
		{
			name: "expired proof",
			request: &runtimev1.OpenExternalPrincipalSessionRequest{
				AppId:               "nimi.desktop",
				ExternalPrincipalId: "agent-openclaw",
				Proof:               buildTestJWT(t, "https://issuer.nimi.xyz", time.Now().Add(-2*time.Minute), privateKey),
			},
			wantCode:   codes.Unauthenticated,
			wantReason: runtimev1.ReasonCode_AUTH_TOKEN_EXPIRED,
		},
		{
			name: "issuer mismatch",
			request: &runtimev1.OpenExternalPrincipalSessionRequest{
				AppId:               "nimi.desktop",
				ExternalPrincipalId: "agent-openclaw",
				Proof:               buildTestJWT(t, "https://wrong-issuer.nimi.xyz", time.Now().Add(5*time.Minute), privateKey),
			},
			wantCode:   codes.Unauthenticated,
			wantReason: runtimev1.ReasonCode_AUTH_TOKEN_INVALID,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.OpenExternalPrincipalSession(ctx, tt.request)
			if err == nil {
				t.Fatal("expected proof validation error")
			}
			st, ok := status.FromError(err)
			if !ok {
				t.Fatalf("expected grpc status error, got %v", err)
			}
			if st.Code() != tt.wantCode {
				t.Fatalf("expected code %v, got %v", tt.wantCode, st.Code())
			}
			if st.Message() != tt.wantReason.String() {
				t.Fatalf("expected reason %v, got %s", tt.wantReason, st.Message())
			}
		})
	}

	_, err = svc.RegisterExternalPrincipal(ctx, &runtimev1.RegisterExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		ExternalPrincipalId:   "agent-unsupported",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		Issuer:                "https://issuer.nimi.xyz",
		SignatureKeyId:        publicKey,
		ProofType:             runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_UNSPECIFIED,
	})
	if err == nil {
		t.Fatal("expected unsupported proof type error")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error, got %v", err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AUTH_UNSUPPORTED_PROOF_TYPE.String() {
		t.Fatalf("expected AUTH_UNSUPPORTED_PROOF_TYPE, got %s", st.Message())
	}
}

func TestRegisterAppRejectsLiteExtensionManifestAtServiceBoundary(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))

	resp, err := svc.RegisterApp(context.Background(), &runtimev1.RegisterAppRequest{
		AppId: "nimi.lite",
		ModeManifest: &runtimev1.AppModeManifest{
			AppMode:         runtimev1.AppMode_APP_MODE_LITE,
			RuntimeRequired: false,
			RealmRequired:   true,
			WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_EXTENSION,
		},
	})
	if err != nil {
		t.Fatalf("register app: %v", err)
	}
	if resp.GetAccepted() {
		t.Fatalf("expected lite+extension manifest rejected")
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_APP_MODE_WORLD_RELATION_FORBIDDEN {
		t.Fatalf("unexpected reason code: %v", resp.GetReasonCode())
	}
}

func TestAuthServiceAuditUsesIncomingTraceID(t *testing.T) {
	store := auditlog.New(16, 16)
	svc := NewWithDependencies(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, store, 60, 86400)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-trace-id", "trace-auth-001"))

	_, err := svc.RegisterApp(ctx, &runtimev1.RegisterAppRequest{
		AppId: "nimi.desktop",
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

	resp, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{})
	if err != nil {
		t.Fatalf("list auth audit events: %v", err)
	}
	if len(resp.GetEvents()) == 0 {
		t.Fatalf("expected auth audit event")
	}
	event := resp.GetEvents()[0]
	if event.GetTraceId() != "trace-auth-001" {
		t.Fatalf("unexpected trace id: %q", event.GetTraceId())
	}
	if event.GetAuditId() == "" {
		t.Fatalf("expected audit id to be set")
	}
}

func TestRevokeSessionIdempotent(t *testing.T) {
	// K-AUTHSVC-005: revoking a session twice returns OK both times.
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

	openResp, err := svc.OpenSession(ctx, &runtimev1.OpenSessionRequest{
		AppId:         "nimi.desktop",
		AppInstanceId: registerResp.GetAppInstanceId(),
		DeviceId:      "local-device",
		SubjectUserId: "user-001",
		TtlSeconds:    600,
	})
	if err != nil {
		t.Fatalf("open session: %v", err)
	}

	// First revoke must succeed.
	revokeResp, err := svc.RevokeSession(ctx, &runtimev1.RevokeSessionRequest{SessionId: openResp.GetSessionId()})
	if err != nil {
		t.Fatalf("first revoke: %v", err)
	}
	if !revokeResp.GetOk() {
		t.Fatalf("first revoke must be ok")
	}
	svc.mu.RLock()
	_, exists := svc.appSessions[openResp.GetSessionId()]
	svc.mu.RUnlock()
	if exists {
		t.Fatalf("revoked session must be removed from in-memory store")
	}

	// Second revoke of the same session must also succeed (idempotent).
	revokeResp2, err := svc.RevokeSession(ctx, &runtimev1.RevokeSessionRequest{SessionId: openResp.GetSessionId()})
	if err != nil {
		t.Fatalf("second revoke must not error: %v", err)
	}
	if !revokeResp2.GetOk() {
		t.Fatalf("second revoke must be ok")
	}

	// Refreshing the revoked session must indicate revocation.
	refreshResp, err := svc.RefreshSession(sessionContext(openResp.GetSessionId(), openResp.GetSessionToken()), &runtimev1.RefreshSessionRequest{
		SessionId:  openResp.GetSessionId(),
		TtlSeconds: 600,
	})
	if err != nil {
		t.Fatalf("refresh after double revoke: %v", err)
	}
	if refreshResp.GetReasonCode() != runtimev1.ReasonCode_APP_TOKEN_REVOKED {
		t.Fatalf("expected APP_TOKEN_REVOKED, got %v", refreshResp.GetReasonCode())
	}
}

func TestAuthWritePathsPruneExpiredSessions(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	now := time.Now().UTC()

	svc.mu.Lock()
	svc.appSessions["expired-app"] = appSession{
		SessionID:     "expired-app",
		AppID:         "nimi.desktop",
		SubjectUserID: "user-001",
		ExpiresAt:     now.Add(-time.Minute),
	}
	svc.externalSessions["expired-external"] = externalSession{
		ExternalSessionID:   "expired-external",
		AppID:               "nimi.desktop",
		ExternalPrincipalID: "agent-openclaw",
		ExpiresAt:           now.Add(-time.Minute),
	}
	svc.mu.Unlock()

	_, err := svc.RegisterApp(context.Background(), &runtimev1.RegisterAppRequest{
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

	svc.mu.RLock()
	_, appExists := svc.appSessions["expired-app"]
	_, externalExists := svc.externalSessions["expired-external"]
	svc.mu.RUnlock()
	if appExists || externalExists {
		t.Fatalf("expired sessions must be pruned on auth write paths: app=%v external=%v", appExists, externalExists)
	}
}

func TestRefreshSessionRejectsMissingSessionMetadata(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))

	registerResp, err := svc.RegisterApp(context.Background(), &runtimev1.RegisterAppRequest{
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
	openResp, err := svc.OpenSession(context.Background(), &runtimev1.OpenSessionRequest{
		AppId:         "nimi.desktop",
		AppInstanceId: registerResp.GetAppInstanceId(),
		DeviceId:      "local-device",
		SubjectUserId: "user-001",
		TtlSeconds:    600,
	})
	if err != nil {
		t.Fatalf("open session: %v", err)
	}

	_, err = svc.RefreshSession(context.Background(), &runtimev1.RefreshSessionRequest{
		SessionId:  openResp.GetSessionId(),
		TtlSeconds: 600,
	})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expected unauthenticated, got %v", err)
	}
	if status.Convert(err).Message() != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED.String() {
		t.Fatalf("unexpected reason: %s", status.Convert(err).Message())
	}
}
