package daemon

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
)

func TestAppendProviderHealthAuditOnTransition(t *testing.T) {
	store := auditlog.New(32, 32)
	before := providerhealth.Snapshot{
		Name:  "cloud-nimillm",
		State: providerhealth.StateHealthy,
	}
	after := providerhealth.Snapshot{
		Name:       "cloud-nimillm",
		State:      providerhealth.StateUnhealthy,
		LastReason: "timeout",
	}

	appendProviderHealthAudit(store, "cloud-nimillm", before, after)
	resp := store.ListEvents(&runtimev1.ListAuditEventsRequest{
		Domain: "runtime.ai",
	})
	if len(resp.GetEvents()) != 1 {
		t.Fatalf("expected 1 audit event, got=%d", len(resp.GetEvents()))
	}
	event := resp.GetEvents()[0]
	if event.GetOperation() != "provider.health" {
		t.Fatalf("unexpected operation: %s", event.GetOperation())
	}
	if event.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("unexpected reason code: %v", event.GetReasonCode())
	}
	if event.GetPayload() == nil {
		t.Fatalf("payload must not be nil")
	}
	if got := event.GetPayload().GetFields()["providerName"].GetStringValue(); got != "cloud-nimillm" {
		t.Fatalf("providerName mismatch: %s", got)
	}
	if got := event.GetPayload().GetFields()["current"].GetStructValue().GetFields()["state"].GetStringValue(); got != string(providerhealth.StateUnhealthy) {
		t.Fatalf("current state mismatch: %s", got)
	}
}

func TestAppendProviderHealthAuditNoTransitionNoEvent(t *testing.T) {
	store := auditlog.New(32, 32)
	before := providerhealth.Snapshot{
		Name:  "cloud-nimillm",
		State: providerhealth.StateHealthy,
	}
	after := providerhealth.Snapshot{
		Name:  "cloud-nimillm",
		State: providerhealth.StateHealthy,
	}

	appendProviderHealthAudit(store, "cloud-nimillm", before, after)
	resp := store.ListEvents(&runtimev1.ListAuditEventsRequest{
		Domain: "runtime.ai",
	})
	if len(resp.GetEvents()) != 0 {
		t.Fatalf("expected no events, got=%d", len(resp.GetEvents()))
	}
}

func TestConfiguredAIProviderTargetsIncludesExtendedProviders(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", "http://127.0.0.1:1234/v1")
	t.Setenv("NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL", "http://127.0.0.1:2834/v1")
	t.Setenv("NIMI_RUNTIME_LOCAL_SIDECAR_BASE_URL", "http://127.0.0.1:3234")
	cfg := config.Config{
		Providers: map[string]config.RuntimeFileTarget{
			"nimillm":               {BaseURL: "http://127.0.0.1:3234/v1", APIKey: "nimillm-key"},
			"volcengine_openspeech": {BaseURL: "http://127.0.0.1:4234", APIKey: "speech-key"},
			"gemini":                {BaseURL: "http://127.0.0.1:5234", APIKey: "gemini-key"},
			"minimax":               {BaseURL: "http://127.0.0.1:6234", APIKey: "minimax-key"},
			"kimi":                  {BaseURL: "http://127.0.0.1:7234", APIKey: "kimi-key"},
			"glm":                   {BaseURL: "http://127.0.0.1:8234", APIKey: "glm-key"},
		},
	}

	targets := configuredAIProviderTargets(cfg)
	seen := make(map[string]bool, len(targets))
	for _, item := range targets {
		seen[item.Name] = true
	}
	required := []string{
		"local",
		"local-media",
		"local-sidecar",
		"cloud-nimillm",
		"cloud-volcengine-openspeech",
		"cloud-gemini",
		"cloud-minimax",
		"cloud-kimi",
		"cloud-glm",
	}
	for _, name := range required {
		if !seen[name] {
			t.Fatalf("expected provider target %q to be configured", name)
		}
	}
}

func TestResolveProbeEndpointAvoidsDuplicateV1(t *testing.T) {
	got := resolveProbeEndpoint("http://127.0.0.1:1234/v1", "/v1/models")
	if got != "http://127.0.0.1:1234/v1/models" {
		t.Fatalf("unexpected probe endpoint: %s", got)
	}
}

func TestResolveProbeEndpointWithHealthPath(t *testing.T) {
	got := resolveProbeEndpoint("http://127.0.0.1:1234/v1", "/healthz")
	if got != "http://127.0.0.1:1234/v1/healthz" {
		t.Fatalf("unexpected health probe endpoint: %s", got)
	}
}

func TestResolveProbeEndpointWithCatalogPath(t *testing.T) {
	got := resolveProbeEndpoint("http://127.0.0.1:8321/v1", "/v1/catalog")
	if got != "http://127.0.0.1:8321/v1/catalog" {
		t.Fatalf("unexpected catalog probe endpoint: %s", got)
	}
}

func TestProviderProbePathsUsesCanonicalMediaCatalog(t *testing.T) {
	got := providerProbePaths("local-media")
	if len(got) != 2 || got[0] != "/healthz" || got[1] != "/v1/catalog" {
		t.Fatalf("unexpected media probe paths: %v", got)
	}
}

func TestProviderTargetNameForEngineSeparatesMediaDiffusersBackend(t *testing.T) {
	llamaTarget, ok := providerTargetNameForEngine(engine.EngineLlama)
	if !ok {
		t.Fatal("expected llama provider target mapping")
	}
	if llamaTarget != "local" {
		t.Fatalf("unexpected llama provider target: %s", llamaTarget)
	}

	diffusersTarget, ok := providerTargetNameForEngine(engine.EngineKind("media-diffusers-backend"))
	if !ok {
		t.Fatal("expected media diffusers provider target mapping")
	}
	if diffusersTarget != "local-image" {
		t.Fatalf("unexpected media diffusers provider target: %s", diffusersTarget)
	}
	if diffusersTarget == llamaTarget {
		t.Fatalf("media diffusers backend must not share provider target name with llama")
	}
}
