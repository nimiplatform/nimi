package authn

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestExtractBearerTokenMissingHeader(t *testing.T) {
	token, hasAuthHeader, malformed := extractBearerToken(context.Background())
	if token != "" {
		t.Fatalf("expected empty token, got=%q", token)
	}
	if hasAuthHeader {
		t.Fatalf("expected hasAuthHeader=false")
	}
	if malformed {
		t.Fatalf("expected malformed=false")
	}
}

func TestExtractBearerTokenMalformedHeader(t *testing.T) {
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"authorization", "Basic abc",
	))
	token, hasAuthHeader, malformed := extractBearerToken(ctx)
	if token != "" {
		t.Fatalf("expected empty token, got=%q", token)
	}
	if !hasAuthHeader {
		t.Fatalf("expected hasAuthHeader=true")
	}
	if !malformed {
		t.Fatalf("expected malformed=true")
	}
}

func TestExtractBearerTokenRejectsLowercaseBearerPrefix(t *testing.T) {
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"authorization", "bearer abc",
	))
	token, hasAuthHeader, malformed := extractBearerToken(ctx)
	if token != "" {
		t.Fatalf("expected empty token, got=%q", token)
	}
	if !hasAuthHeader {
		t.Fatalf("expected hasAuthHeader=true")
	}
	if !malformed {
		t.Fatalf("expected malformed=true")
	}
}

func TestAuthenticateRejectsMalformedHeader(t *testing.T) {
	// K-AUTHN-001/K-AUTHN-007: malformed Authorization never downgrades to anonymous.
	v, err := NewValidator("", "", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"authorization", "Basic abc",
	))
	_, authErr := authenticate(ctx, v, "/runtime.v1.RuntimeAuditService/GetRuntimeHealth")
	if authErr == nil {
		t.Fatalf("expected auth error")
	}
	st, ok := status.FromError(authErr)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.Unauthenticated {
		t.Fatalf("unexpected code: %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AUTH_TOKEN_INVALID.String() {
		t.Fatalf("unexpected reason code: %s", st.Message())
	}
}

func TestAuthenticateProjectsIdentityForValidBearerToken(t *testing.T) {
	// K-AUTHN-008: successful auth projects the identity into context.
	key := generateRSAKey(t)
	claims := validClaims()
	server := newJWKSTestServer(t, jwksDocument{
		Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")},
	})
	defer func() { server.Close() }()
	v, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	v.SetRevocationURL(newActiveRevocationServer(t).URL)
	token := signRS256(t, key, "kid-1", claims)

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"authorization", "Bearer "+token,
	))
	nextCtx, authErr := authenticate(ctx, v, "/runtime.v1.RuntimeAuditService/GetRuntimeHealth")
	if authErr != nil {
		t.Fatalf("authenticate failed: %v", authErr)
	}
	identity := IdentityFromContext(nextCtx)
	if identity == nil {
		t.Fatalf("expected identity in context")
	}
	if identity.SubjectUserID != "user-123" {
		t.Fatalf("subject mismatch: %s", identity.SubjectUserID)
	}
	if identity.Issuer != "test-issuer" {
		t.Fatalf("issuer mismatch: %s", identity.Issuer)
	}
	if identity.Audience != "test-audience" {
		t.Fatalf("audience mismatch: %s", identity.Audience)
	}
}

func TestAuthenticateMapsInvalidTokenToAuthTokenInvalid(t *testing.T) {
	// K-AUTHN-007: invalid tokens map to UNAUTHENTICATED + AUTH_TOKEN_INVALID.
	validator, err := NewValidator("", "", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodNone, validClaims())
	tokenString, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("sign none token: %v", err)
	}

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"authorization", "Bearer "+tokenString,
	))
	_, authErr := authenticate(ctx, validator, "/runtime.v1.RuntimeAuditService/GetRuntimeHealth")
	if authErr == nil {
		t.Fatalf("expected auth error")
	}
	st, ok := status.FromError(authErr)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.Unauthenticated {
		t.Fatalf("unexpected code: %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(authErr)
	if !ok || reason != runtimev1.ReasonCode_AUTH_TOKEN_INVALID {
		t.Fatalf("unexpected reason code: %v (present=%v)", reason, ok)
	}
	if strings.Contains(st.Message(), tokenString) || !strings.Contains(st.Message(), "runtime account token is invalid") {
		t.Fatalf("unsafe or unexpected public message: %q", st.Message())
	}
}

func TestAuthenticateMapsRevokedSessionToSessionExpired(t *testing.T) {
	key := generateRSAKey(t)
	jwksServer := newJWKSTestServer(t, jwksDocument{
		Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")},
	})
	defer func() { jwksServer.Close() }()

	revocationServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(testRevocationResponse(false, false))
	}))
	defer func() { revocationServer.Close() }()

	v, err := NewValidator(jwksServer.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	v.SetRevocationURL(revocationServer.URL)
	token := signRS256(t, key, "kid-1", validClaims())

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"authorization", "Bearer "+token,
	))
	_, authErr := authenticate(ctx, v, "/runtime.v1.RuntimeConnectorService/ListCatalogProviderModels")
	if authErr == nil {
		t.Fatalf("expected auth error")
	}
	st, ok := status.FromError(authErr)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.Unauthenticated {
		t.Fatalf("unexpected code: %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(authErr)
	if !ok || reason != runtimev1.ReasonCode_SESSION_EXPIRED {
		t.Fatalf("unexpected reason code: %v", reason)
	}
}

func TestAuthenticateMapsRevocationRateLimitToRetryableUnavailable(t *testing.T) {
	key := generateRSAKey(t)
	jwksServer := newJWKSTestServer(t, jwksDocument{
		Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")},
	})
	defer func() { jwksServer.Close() }()

	revocationServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "too many revocation checks", http.StatusTooManyRequests)
	}))
	defer func() { revocationServer.Close() }()

	v, err := NewValidator(jwksServer.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	v.SetRevocationURL(revocationServer.URL)
	token := signRS256(t, key, "kid-1", validClaims())

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"authorization", "Bearer "+token,
	))
	_, authErr := authenticate(ctx, v, "/runtime.v1.RuntimeConnectorService/ListCatalogProviderModels")
	if authErr == nil {
		t.Fatalf("expected auth error")
	}
	st, ok := status.FromError(authErr)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.Unavailable {
		t.Fatalf("unexpected code: %v", st.Code())
	}
	reason, ok := grpcerr.ExtractReasonCode(authErr)
	if !ok || reason != runtimev1.ReasonCode_AUTH_REVOCATION_UNAVAILABLE {
		t.Fatalf("unexpected reason code: %v", reason)
	}
	metadata, ok := grpcerr.ExtractReasonMetadata(authErr)
	if !ok {
		t.Fatalf("expected ErrorInfo metadata")
	}
	if metadata["retryable"] != "true" || metadata["action_hint"] != "retry_revocation_introspection" {
		t.Fatalf("unexpected metadata: %#v", metadata)
	}
}

func TestAuthenticatePermitsMissingAuthorization(t *testing.T) {
	validator, err := NewValidator("", "", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	nextCtx, authErr := authenticate(
		context.Background(),
		validator,
		"/runtime.v1.RuntimeAuditService/GetRuntimeHealth",
	)
	if authErr != nil {
		t.Fatalf("authenticate returned error for missing Authorization: %v", authErr)
	}
	if identity := IdentityFromContext(nextCtx); identity != nil {
		t.Fatalf("expected nil identity for missing Authorization, got %+v", identity)
	}
}

func TestAuthenticateLogsValidationFailure(t *testing.T) {
	validator, err := NewValidator("", "", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"authorization", "Bearer test-token",
		"x-nimi-caller-id", "app:nimi.desktop",
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-participant-id", "nimi.desktop",
	))
	_, authErr := authenticate(ctx, validator, "/runtime.v1.RuntimeAuditService/GetRuntimeHealth")
	if authErr == nil {
		t.Fatal("expected auth error")
	}
	if !strings.Contains(logs.String(), "jwt validation failed") {
		t.Fatalf("expected validation failure log, got=%q", logs.String())
	}
	if !strings.Contains(logs.String(), "method=/runtime.v1.RuntimeAuditService/GetRuntimeHealth") {
		t.Fatalf("expected method in validation failure log, got=%q", logs.String())
	}
	if !strings.Contains(logs.String(), "caller_id=app:nimi.desktop") {
		t.Fatalf("expected caller_id in validation failure log, got=%q", logs.String())
	}
}
