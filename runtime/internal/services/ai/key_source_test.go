package ai

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestValidateKeySourceManagedWithConnectorID(t *testing.T) {
	parsed := ParsedKeySource{
		KeySource:   "managed",
		ConnectorID: "conn-123",
	}
	if err := validateKeySource(parsed); err != nil {
		t.Fatalf("expected valid, got: %v", err)
	}
}

func TestValidateKeySourceManagedMissingConnectorID(t *testing.T) {
	parsed := ParsedKeySource{
		KeySource: "managed",
	}
	err := validateKeySource(parsed)
	if err == nil {
		t.Fatal("expected error for managed without connector_id")
	}
	st, _ := status.FromError(err)
	if !containsReason(st.Message(), runtimev1.ReasonCode_AI_CONNECTOR_ID_REQUIRED) {
		t.Errorf("expected AI_CONNECTOR_ID_REQUIRED, got %s", st.Message())
	}
}

func TestValidateKeySourceInlineComplete(t *testing.T) {
	parsed := ParsedKeySource{
		KeySource:    "inline",
		ProviderType: "openai",
		APIKey:       "sk-test",
	}
	if err := validateKeySource(parsed); err != nil {
		t.Fatalf("expected valid, got: %v", err)
	}
}

func TestValidateKeySourceInlineMissingProviderType(t *testing.T) {
	parsed := ParsedKeySource{
		KeySource: "inline",
		APIKey:    "sk-test",
	}
	err := validateKeySource(parsed)
	if err == nil {
		t.Fatal("expected error for inline without provider_type")
	}
	st, _ := status.FromError(err)
	if !containsReason(st.Message(), runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_MISSING) {
		t.Errorf("expected AI_REQUEST_CREDENTIAL_MISSING, got %s", st.Message())
	}
}

func TestValidateKeySourceInlineMissingAPIKey(t *testing.T) {
	parsed := ParsedKeySource{
		KeySource:    "inline",
		ProviderType: "openai",
	}
	err := validateKeySource(parsed)
	if err == nil {
		t.Fatal("expected error for inline without api_key")
	}
}

func TestValidateKeySourceInlineExplicitEndpointRequired(t *testing.T) {
	parsed := ParsedKeySource{
		KeySource:    "inline",
		ProviderType: "openai_compatible",
		APIKey:       "sk-test",
		// No endpoint — openai_compatible requires explicit endpoint
	}
	err := validateKeySource(parsed)
	if err == nil {
		t.Fatal("expected error for explicit endpoint required provider without endpoint")
	}
}

func TestValidateKeySourceConflict(t *testing.T) {
	parsed := ParsedKeySource{
		ConnectorID: "conn-123",
		APIKey:      "sk-test",
	}
	err := validateKeySource(parsed)
	if err == nil {
		t.Fatal("expected error for connector_id + inline fields conflict")
	}
	st, _ := status.FromError(err)
	if !containsReason(st.Message(), runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_CONFLICT) {
		t.Errorf("expected AI_REQUEST_CREDENTIAL_CONFLICT, got %s", st.Message())
	}
}

func TestValidateKeySourceNoSourceRuntimeConfig(t *testing.T) {
	parsed := ParsedKeySource{}
	if err := validateKeySource(parsed); err != nil {
		t.Fatalf("expected valid for empty (runtime config), got: %v", err)
	}
}

func TestResolveKeySourceManaged(t *testing.T) {
	store := connector.NewConnectorStore(t.TempDir())
	rec := connector.ConnectorRecord{
		ConnectorID: "conn-test",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-1",
		Provider:    "openai",
		Endpoint:    "https://api.openai.com/v1",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}
	if err := store.Create(rec, "sk-managed-key"); err != nil {
		t.Fatal(err)
	}

	parsed := ParsedKeySource{
		KeySource:   "managed",
		ConnectorID: "conn-test",
	}
	target, err := resolveKeySourceToTarget(parsed, store)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if target == nil {
		t.Fatal("expected non-nil target")
	}
	if target.ProviderType != "openai" {
		t.Errorf("expected openai provider, got %s", target.ProviderType)
	}
	if target.APIKey != "sk-managed-key" {
		t.Errorf("expected sk-managed-key, got %s", target.APIKey)
	}
}

func TestResolveKeySourceInline(t *testing.T) {
	parsed := ParsedKeySource{
		KeySource:    "inline",
		ProviderType: "gemini",
		APIKey:       "sk-inline",
	}
	target, err := resolveKeySourceToTarget(parsed, nil)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if target == nil {
		t.Fatal("expected non-nil target")
	}
	if target.ProviderType != "gemini" {
		t.Errorf("expected gemini provider, got %s", target.ProviderType)
	}
	if target.APIKey != "sk-inline" {
		t.Errorf("expected sk-inline, got %s", target.APIKey)
	}
	// Default endpoint should be resolved
	if target.Endpoint == "" {
		t.Error("expected default endpoint to be resolved")
	}
}

func TestResolveKeySourceRuntimeConfig(t *testing.T) {
	parsed := ParsedKeySource{}
	target, err := resolveKeySourceToTarget(parsed, nil)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if target != nil {
		t.Error("expected nil target for runtime config")
	}
}

func TestResolveKeySourceManagedDisabled(t *testing.T) {
	store := connector.NewConnectorStore(t.TempDir())
	rec := connector.ConnectorRecord{
		ConnectorID: "conn-disabled",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-1",
		Provider:    "openai",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED,
	}
	if err := store.Create(rec, "key"); err != nil {
		t.Fatal(err)
	}

	parsed := ParsedKeySource{
		KeySource:   "managed",
		ConnectorID: "conn-disabled",
	}
	_, err := resolveKeySourceToTarget(parsed, store)
	if err == nil {
		t.Fatal("expected error for disabled connector")
	}
	st, _ := status.FromError(err)
	if !containsReason(st.Message(), runtimev1.ReasonCode_AI_CONNECTOR_DISABLED) {
		t.Errorf("expected AI_CONNECTOR_DISABLED, got %s", st.Message())
	}
}

func TestResolveKeySourceManagedNotFound(t *testing.T) {
	store := connector.NewConnectorStore(t.TempDir())

	parsed := ParsedKeySource{
		KeySource:   "managed",
		ConnectorID: "nonexistent",
	}
	_, err := resolveKeySourceToTarget(parsed, store)
	if err == nil {
		t.Fatal("expected error for not found connector")
	}
}

func TestParseKeySourceFromMetadata(t *testing.T) {
	md := metadata.New(map[string]string{
		"x-nimi-key-source":        "inline",
		"x-nimi-provider-type":     "openai",
		"x-nimi-provider-endpoint": "https://custom.endpoint.com",
		"x-nimi-provider-api-key":  "sk-from-metadata",
	})
	ctx := metadata.NewIncomingContext(context.Background(), md)

	parsed := parseKeySource(ctx, "")
	if parsed.KeySource != "inline" {
		t.Errorf("expected key_source=inline, got %s", parsed.KeySource)
	}
	if parsed.ProviderType != "openai" {
		t.Errorf("expected provider_type=openai, got %s", parsed.ProviderType)
	}
	if parsed.APIKey != "sk-from-metadata" {
		t.Errorf("expected api_key=sk-from-metadata, got %s", parsed.APIKey)
	}
}

func TestParseKeySourceFromBody(t *testing.T) {
	ctx := context.Background()
	parsed := parseKeySource(ctx, "conn-from-body")
	if parsed.ConnectorID != "conn-from-body" {
		t.Errorf("expected connector_id=conn-from-body, got %s", parsed.ConnectorID)
	}
}

func containsReason(message string, code runtimev1.ReasonCode) bool {
	return message == code.String()
}
