package authn

import (
	"bytes"
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"gopkg.in/yaml.v3"
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
	defer server.Close()
	v, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
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
	if st.Message() != runtimev1.ReasonCode_AUTH_TOKEN_INVALID.String() {
		t.Fatalf("unexpected reason code: %s", st.Message())
	}
}

// =============================================================================
// Wave 4 (topic 2026-05-10-runtime-bearer-revocation-contract-closure):
// posture-consumer test. Loads the Wave 0 spec table at
// nimi/.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture.yaml as a
// READ-ONLY YAML fixture, asserts table shape sanity, and confirms the
// runtime authn interceptor's K-AUTHN-001 pass-through behavior on sample
// method ids of every posture (anonymous_read AND authenticated_required).
//
// Important semantic clarification (per K-AUTHN-001 + K-AUTH separation):
// the AuthN interceptor permits anonymous requests for ALL methods — header
// absent → pass-through with nil identity. The POSTURE table classifies which
// methods downstream layers (SDK, app) should treat as anonymous-allowed. This
// test confirms the table can be CONSUMED as a fixture, NOT that the runtime
// ENFORCES the posture (it doesn't — AuthZ enforces).
// =============================================================================

type runtimeRPCAuthPostureMethodEntry struct {
	MethodID  string   `yaml:"method_id"`
	Posture   string   `yaml:"posture"`
	Rationale string   `yaml:"rationale"`
	KernelRef []string `yaml:"kernel_refs"`
}

type runtimeRPCAuthPostureTable struct {
	ID                       string                            `yaml:"id"`
	Kind                     string                            `yaml:"kind"`
	Version                  int                               `yaml:"version"`
	PostureDecisionDoctrine  string                            `yaml:"posture_decision_doctrine"`
	Methods                  []runtimeRPCAuthPostureMethodEntry `yaml:"methods"`
}

// loadPostureTableFixture reads the Wave 0 spec table from disk via a
// repo-root-relative path. The yaml is treated as a read-only fixture; the
// test does not write to it.
func loadPostureTableFixture(t *testing.T) *runtimeRPCAuthPostureTable {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	// thisFile = .../nimi/runtime/internal/authn/interceptor_test.go
	// nimiRoot = .../nimi
	// table   = .../nimi/.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture.yaml
	nimiRoot := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", ".."))
	tablePath := filepath.Join(nimiRoot, "nimi", ".nimi", "spec", "runtime", "kernel", "tables", "runtime-rpc-auth-posture.yaml")
	raw, err := os.ReadFile(tablePath)
	if err != nil {
		t.Fatalf("read posture table fixture %s: %v", tablePath, err)
	}
	var table runtimeRPCAuthPostureTable
	if err := yaml.Unmarshal(raw, &table); err != nil {
		t.Fatalf("unmarshal posture table fixture: %v", err)
	}
	return &table
}

// TestPostureTableConsumerLoadsWave0FixtureShape asserts the basic shape of
// the Wave 0 spec table from the runtime test consumer's perspective. The
// shape gate already enforces this server-side; this consumer-side test
// confirms runtime can load and parse the same structure without drift.
func TestPostureTableConsumerLoadsWave0FixtureShape(t *testing.T) {
	table := loadPostureTableFixture(t)
	if strings.TrimSpace(table.PostureDecisionDoctrine) == "" {
		t.Fatal("expected non-empty posture_decision_doctrine field")
	}
	// Defensive lower bound; current count at topic implementation moment is
	// 177. This test fails closed if Wave 0 contracts the table dramatically
	// (signals Wave 0 reopen rather than silent runtime drift).
	if len(table.Methods) < 100 {
		t.Fatalf("expected at least 100 method entries, got %d", len(table.Methods))
	}
}

// TestInterceptorPermitsAnonymousOnAnonymousReadMethods asserts that for at
// least 3 sample method ids classified `anonymous_read` in the Wave 0 table,
// an inbound gRPC call WITHOUT an Authorization header reaches the handler
// with nil Identity. This is the K-AUTHN-001 contract: the interceptor permits
// anonymous; SDK Wave 2 ensures Bearer is never injected for these methods.
func TestInterceptorPermitsAnonymousOnAnonymousReadMethods(t *testing.T) {
	table := loadPostureTableFixture(t)

	// Pick 3 well-known anonymous_read methods drawn from the live-failure
	// anchors of the originating 2026-05-10 incident plus a connector catalog
	// example. These ids must exist in the table with posture=anonymous_read.
	wantSamples := []string{
		"/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth",
		"/nimi.runtime.v1.RuntimeAuditService/ListAIProviderHealth",
		"/nimi.runtime.v1.RuntimeAiService/PeekScheduling",
	}
	for _, methodID := range wantSamples {
		assertPostureClassification(t, table, methodID, "anonymous_read")
	}

	v, err := NewValidator("", "", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	for _, methodID := range wantSamples {
		// No Authorization header → anonymous → pass-through with nil identity.
		ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs())
		nextCtx, authErr := authenticate(ctx, v, methodID)
		if authErr != nil {
			t.Fatalf("authenticate(%s) returned error for anonymous request: %v", methodID, authErr)
		}
		if id := IdentityFromContext(nextCtx); id != nil {
			t.Fatalf("expected nil identity for anonymous request on %s, got %+v", methodID, id)
		}
	}
}

// TestInterceptorPermitsAnonymousOnAuthenticatedRequiredMethods asserts that
// for a sample method id classified `authenticated_required` in the Wave 0
// table, the AuthN interceptor STILL permits anonymous requests (K-AUTHN-001
// + K-AUTH separation). The interceptor does not enforce posture; AuthZ at
// the handler enforces. The Wave 0 table classifies the method as
// authenticated_required so SDK consumers know to attach Bearer; the
// interceptor itself is posture-agnostic.
func TestInterceptorPermitsAnonymousOnAuthenticatedRequiredMethods(t *testing.T) {
	table := loadPostureTableFixture(t)

	wantSamples := []string{
		"/nimi.runtime.v1.RuntimeAccountService/Logout",
	}
	for _, methodID := range wantSamples {
		assertPostureClassification(t, table, methodID, "authenticated_required")
	}

	v, err := NewValidator("", "", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	for _, methodID := range wantSamples {
		ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs())
		nextCtx, authErr := authenticate(ctx, v, methodID)
		if authErr != nil {
			t.Fatalf("authenticate(%s) returned error for anonymous request: %v", methodID, authErr)
		}
		if id := IdentityFromContext(nextCtx); id != nil {
			t.Fatalf("expected nil identity for anonymous request on %s, got %+v", methodID, id)
		}
	}
}

// assertPostureClassification fails the test if methodID is missing from the
// table or has a different posture than expected.
func assertPostureClassification(t *testing.T, table *runtimeRPCAuthPostureTable, methodID, expected string) {
	t.Helper()
	for _, entry := range table.Methods {
		if entry.MethodID == methodID {
			if entry.Posture != expected {
				t.Fatalf("method %s expected posture=%q, table has %q", methodID, expected, entry.Posture)
			}
			return
		}
	}
	t.Fatalf("method %s not found in posture table fixture", methodID)
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
