package authn

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
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
	if st.Message() != runtimev1.ReasonCode_AUTH_TOKEN_INVALID.String() {
		t.Fatalf("unexpected reason code: %s", st.Message())
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

// =============================================================================
// Posture-consumer test. Loads the canonical spec table index at
// nimi/.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture.yaml plus its
// method shards as READ-ONLY YAML fixtures, asserts table shape sanity, and
// confirms the runtime authn interceptor's K-AUTHN-001 pass-through behavior
// on sample method ids of every posture (anonymous_read AND
// authenticated_required).
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
	ID                      string                             `yaml:"id"`
	Kind                    string                             `yaml:"kind"`
	Version                 int                                `yaml:"version"`
	PostureDecisionDoctrine string                             `yaml:"posture_decision_doctrine"`
	Methods                 []runtimeRPCAuthPostureMethodEntry `yaml:"methods"`
}

type runtimeRPCAuthPostureIndex struct {
	ID                      string                             `yaml:"id"`
	Kind                    string                             `yaml:"kind"`
	Version                 int                                `yaml:"version"`
	PostureDecisionDoctrine string                             `yaml:"posture_decision_doctrine"`
	MethodShards            []runtimeRPCAuthPostureShard       `yaml:"method_shards"`
	InlineMethods           []runtimeRPCAuthPostureMethodEntry `yaml:"methods"`
}

type runtimeRPCAuthPostureShard struct {
	Path        string   `yaml:"path"`
	ID          string   `yaml:"id"`
	MethodCount int      `yaml:"method_count"`
	Services    []string `yaml:"services"`
}

type runtimeRPCAuthPostureShardFile struct {
	ID      string                             `yaml:"id"`
	Kind    string                             `yaml:"kind"`
	Parent  string                             `yaml:"parent"`
	Version int                                `yaml:"version"`
	Methods []runtimeRPCAuthPostureMethodEntry `yaml:"methods"`
}

// loadPostureTableFixture reads the runtime RPC auth posture index and method
// shards from disk by locating the repository root from this source file. The
// YAML files are treated as read-only fixtures; the test does not write to them.
func loadPostureTableFixture(t *testing.T) *runtimeRPCAuthPostureTable {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	tablePath := findPostureTableFixture(t, thisFile)
	raw, err := os.ReadFile(tablePath)
	if err != nil {
		t.Fatalf("read posture table fixture %s: %v", tablePath, err)
	}
	var rootShape map[string]any
	if err := yaml.Unmarshal(raw, &rootShape); err != nil {
		t.Fatalf("unmarshal posture table fixture root shape: %v", err)
	}
	if _, ok := rootShape["methods"]; ok {
		t.Fatalf("posture table index %s must not contain inline methods", tablePath)
	}
	var index runtimeRPCAuthPostureIndex
	if err := yaml.Unmarshal(raw, &index); err != nil {
		t.Fatalf("unmarshal posture table fixture index: %v", err)
	}
	if len(index.InlineMethods) != 0 {
		t.Fatalf("posture table index %s must not expose inline methods", tablePath)
	}
	if len(index.MethodShards) == 0 {
		t.Fatalf("posture table index %s must declare method_shards", tablePath)
	}
	table := runtimeRPCAuthPostureTable{
		ID:                      index.ID,
		Kind:                    index.Kind,
		Version:                 index.Version,
		PostureDecisionDoctrine: index.PostureDecisionDoctrine,
	}
	seenMethods := map[string]string{}
	for _, shardRef := range index.MethodShards {
		if strings.TrimSpace(shardRef.Path) == "" {
			t.Fatalf("posture table index %s contains empty shard path", tablePath)
		}
		cleanShardRef := filepath.Clean(shardRef.Path)
		if filepath.IsAbs(cleanShardRef) || cleanShardRef == ".." || strings.HasPrefix(cleanShardRef, ".."+string(os.PathSeparator)) {
			t.Fatalf("posture table index %s contains invalid shard path %q", tablePath, shardRef.Path)
		}
		shardPath := filepath.Join(filepath.Dir(tablePath), cleanShardRef)
		shardRaw, err := os.ReadFile(shardPath)
		if err != nil {
			t.Fatalf("read posture table shard %s: %v", shardPath, err)
		}
		var shard runtimeRPCAuthPostureShardFile
		if err := yaml.Unmarshal(shardRaw, &shard); err != nil {
			t.Fatalf("unmarshal posture table shard %s: %v", shardPath, err)
		}
		if shard.Kind != "runtime-rpc-auth-posture-shard" {
			t.Fatalf("posture table shard %s has kind %q", shardPath, shard.Kind)
		}
		if shard.Parent != index.ID {
			t.Fatalf("posture table shard %s parent %q does not match index %q", shardPath, shard.Parent, index.ID)
		}
		if shardRef.ID != "" && shard.ID != shardRef.ID {
			t.Fatalf("posture table shard %s id %q does not match index ref %q", shardPath, shard.ID, shardRef.ID)
		}
		if shardRef.MethodCount != 0 && len(shard.Methods) != shardRef.MethodCount {
			t.Fatalf("posture table shard %s method_count=%d, loaded=%d", shardPath, shardRef.MethodCount, len(shard.Methods))
		}
		for _, entry := range shard.Methods {
			if previousShard, exists := seenMethods[entry.MethodID]; exists {
				t.Fatalf("posture table method %s appears in both %s and %s", entry.MethodID, previousShard, shardPath)
			}
			seenMethods[entry.MethodID] = shardPath
		}
		table.Methods = append(table.Methods, shard.Methods...)
	}
	return &table
}

func findPostureTableFixture(t *testing.T, sourceFile string) string {
	t.Helper()
	const relativePath = ".nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture.yaml"
	current := filepath.Dir(sourceFile)
	for {
		candidate := filepath.Join(current, filepath.FromSlash(relativePath))
		info, err := os.Stat(candidate)
		if err == nil {
			if info.IsDir() {
				t.Fatalf("posture table fixture is a directory: %s", candidate)
			}
			return candidate
		}
		if !os.IsNotExist(err) {
			t.Fatalf("inspect posture table fixture %s: %v", candidate, err)
		}
		parent := filepath.Dir(current)
		if parent == current {
			t.Fatalf("locate %s upward from %s", relativePath, sourceFile)
		}
		current = parent
	}
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
	// Defensive lower bound; the admitted baseline contains 177 methods. This
	// test fails closed if the table contracts dramatically, signaling authority
	// drift rather than accepting it silently.
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
		"/nimi.runtime.v1.RuntimeAppService/GetAppStorage",
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
