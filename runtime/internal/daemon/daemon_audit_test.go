package daemon

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
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
	t.Setenv("NIMI_RUNTIME_LOCAL_AI_BASE_URL", "http://127.0.0.1:1234/v1")
	t.Setenv("NIMI_RUNTIME_LOCAL_NEXA_BASE_URL", "http://127.0.0.1:2234/v1")
	t.Setenv("NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL", "http://127.0.0.1:3234/v1")
	t.Setenv("NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_OPENSPEECH_BASE_URL", "http://127.0.0.1:4234")
	t.Setenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_BASE_URL", "http://127.0.0.1:5234")
	t.Setenv("NIMI_RUNTIME_CLOUD_ADAPTER_MINIMAX_BASE_URL", "http://127.0.0.1:6234")
	t.Setenv("NIMI_RUNTIME_CLOUD_ADAPTER_KIMI_BASE_URL", "http://127.0.0.1:7234")
	t.Setenv("NIMI_RUNTIME_CLOUD_ADAPTER_GLM_BASE_URL", "http://127.0.0.1:8234")

	targets := configuredAIProviderTargets()
	seen := make(map[string]bool, len(targets))
	for _, item := range targets {
		seen[item.Name] = true
	}
	required := []string{
		"local",
		"local-nexa",
		"cloud-nimillm",
		"cloud-bytedance-openspeech",
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
