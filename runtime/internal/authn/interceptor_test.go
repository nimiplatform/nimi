package authn

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
	_, authErr := authenticate(ctx, v)
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
	defer server.Close()
	v, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	token := signRS256(t, key, "kid-1", claims)

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"authorization", "Bearer "+token,
	))
	nextCtx, authErr := authenticate(ctx, v)
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
	_, authErr := authenticate(ctx, validator)
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
	))
	_, authErr := authenticate(ctx, validator)
	if authErr == nil {
		t.Fatal("expected auth error")
	}
	if !strings.Contains(logs.String(), "jwt validation failed") {
		t.Fatalf("expected validation failure log, got=%q", logs.String())
	}
}
