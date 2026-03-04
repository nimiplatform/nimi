package authn

import (
	"context"
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

func TestAuthenticateRejectsMalformedHeader(t *testing.T) {
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
}

func TestAuthenticateMapsInvalidTokenToAuthTokenInvalid(t *testing.T) {
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
