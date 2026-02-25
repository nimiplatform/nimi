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
		Name:  "cloud-litellm",
		State: providerhealth.StateHealthy,
	}
	after := providerhealth.Snapshot{
		Name:       "cloud-litellm",
		State:      providerhealth.StateUnhealthy,
		LastReason: "timeout",
	}

	appendProviderHealthAudit(store, "cloud-litellm", before, after)
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
	if got := event.GetPayload().GetFields()["providerName"].GetStringValue(); got != "cloud-litellm" {
		t.Fatalf("providerName mismatch: %s", got)
	}
	if got := event.GetPayload().GetFields()["current"].GetStructValue().GetFields()["state"].GetStringValue(); got != string(providerhealth.StateUnhealthy) {
		t.Fatalf("current state mismatch: %s", got)
	}
}

func TestAppendProviderHealthAuditNoTransitionNoEvent(t *testing.T) {
	store := auditlog.New(32, 32)
	before := providerhealth.Snapshot{
		Name:  "cloud-litellm",
		State: providerhealth.StateHealthy,
	}
	after := providerhealth.Snapshot{
		Name:  "cloud-litellm",
		State: providerhealth.StateHealthy,
	}

	appendProviderHealthAudit(store, "cloud-litellm", before, after)
	resp := store.ListEvents(&runtimev1.ListAuditEventsRequest{
		Domain: "runtime.ai",
	})
	if len(resp.GetEvents()) != 0 {
		t.Fatalf("expected no events, got=%d", len(resp.GetEvents()))
	}
}
