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
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
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
		Issuer:                "https://issuer.nimi.ai",
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
		Proof:               buildTestJWT(t, "https://issuer.nimi.ai", time.Now().Add(5*time.Minute), privateKey),
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
	svc := NewWithDependencies(slog.New(slog.NewTextHandler(io.Discard, nil)), store, 60, 86400)

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
		Issuer:                "https://issuer.nimi.ai",
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

func TestRegisterExternalPrincipalPreservesInvalidSignatureKeyCause(t *testing.T) {
	const invalidKey = "private-invalid-signature-key"
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))

	_, err := svc.RegisterExternalPrincipal(context.Background(), &runtimev1.RegisterExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		ExternalPrincipalId:   "agent-openclaw",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		Issuer:                "https://issuer.nimi.ai",
		SignatureKeyId:        invalidKey,
		ProofType:             runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_JWT,
	})
	if err == nil {
		t.Fatal("expected invalid signature key error")
	}
	if !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("expected ErrTokenInvalid cause, got %T: %v", errors.Unwrap(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AUTH_TOKEN_INVALID {
		t.Fatalf("unexpected reason = %s, ok = %v", reason, ok)
	}
	if strings.Contains(status.Convert(err).Message(), invalidKey) {
		t.Fatalf("public status leaked signature key: %q", status.Convert(err).Message())
	}
}

func TestNewWithDependenciesPreservesInt32TTLBounds(t *testing.T) {
	svc := NewWithDependencies(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, 123, 456)
	if svc.ttlMinSeconds != 123 || svc.ttlMaxSeconds != 456 {
		t.Fatalf("unexpected ttl bounds: min=%d max=%d", svc.ttlMinSeconds, svc.ttlMaxSeconds)
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
		Issuer:                "https://issuer.nimi.ai",
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
		wantCause  error
	}{
		{
			name: "expired proof",
			request: &runtimev1.OpenExternalPrincipalSessionRequest{
				AppId:               "nimi.desktop",
				ExternalPrincipalId: "agent-openclaw",
				Proof:               buildTestJWT(t, "https://issuer.nimi.ai", time.Now().Add(-2*time.Minute), privateKey),
			},
			wantCode:   codes.Unauthenticated,
			wantReason: runtimev1.ReasonCode_AUTH_TOKEN_EXPIRED,
			wantCause:  ErrTokenExpired,
		},
		{
			name: "issuer mismatch",
			request: &runtimev1.OpenExternalPrincipalSessionRequest{
				AppId:               "nimi.desktop",
				ExternalPrincipalId: "agent-openclaw",
				Proof:               buildTestJWT(t, "https://wrong-issuer.nimi.ai", time.Now().Add(5*time.Minute), privateKey),
			},
			wantCode:   codes.Unauthenticated,
			wantReason: runtimev1.ReasonCode_AUTH_TOKEN_INVALID,
			wantCause:  ErrTokenInvalid,
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
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != tt.wantReason {
				t.Fatalf("expected reason %v, got %v (ok=%v)", tt.wantReason, reason, ok)
			}
			if !errors.Is(err, tt.wantCause) {
				t.Fatalf("expected cause %v, got %T: %v", tt.wantCause, errors.Unwrap(err), err)
			}
			if strings.Contains(st.Message(), tt.request.GetProof()) {
				t.Fatalf("public status leaked proof: %q", st.Message())
			}
		})
	}

	_, err = svc.RegisterExternalPrincipal(ctx, &runtimev1.RegisterExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		ExternalPrincipalId:   "agent-unsupported",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		Issuer:                "https://issuer.nimi.ai",
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

func TestPruneExpiredSessionsRemovesExpiredExternalEntries(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	now := time.Now().UTC()
	svc.externalSessions["expired-external"] = externalSession{ExternalSessionID: "expired-external", ExpiresAt: now.Add(-time.Minute)}

	svc.pruneExpiredSessionsLocked(now)

	if _, exists := svc.externalSessions["expired-external"]; exists {
		t.Fatal("expired external session was not pruned")
	}
}
