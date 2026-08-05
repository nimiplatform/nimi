package ai

import (
	"context"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/spendvisibility"
)

func TestReportScenarioSpendDisclosureProjectsCloudUnknownCost(t *testing.T) {
	store := auditlog.New(8, 8)
	svc := &Service{
		logger: slog.Default(),
		audit:  store,
	}
	var gotInput spendvisibility.ExecutionInput
	var gotDisclosure spendvisibility.SpendDisclosure
	svc.SetSpendDisclosureReporter(func(_ context.Context, input spendvisibility.ExecutionInput, disclosure spendvisibility.SpendDisclosure) {
		gotInput = input
		gotDisclosure = disclosure
	})

	ctx := executionintent.WithIntent(context.Background(), executionintent.Intent{
		CapabilityContract: "text.generate",
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		CloudTarget: &runtimeidentity.CloudTarget{
			ConnectorID: "connector-1", RemoteModelCatalogID: "catalog-1", ProviderModelID: "gemini-pro", Provider: "gemini",
		},
	})
	err := svc.reportScenarioSpendDisclosure(ctx, &runtimev1.ScenarioRequestHead{
		AppId:         "nimi.example-app",
		SubjectUserId: "user-1",
	}, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE)
	if err != nil {
		t.Fatalf("report spend disclosure: %v", err)
	}
	if gotInput.CapabilityID != "text.generate" || !gotInput.IsCloudRoute {
		t.Fatalf("unexpected input: %+v", gotInput)
	}
	if gotDisclosure.Category != spendvisibility.SpendCategoryCloudText {
		t.Fatalf("unexpected category: %q", gotDisclosure.Category)
	}
	if gotDisclosure.EstimateAvailable {
		t.Fatal("cloud route without cost hint must disclose unknown spend, not fabricate estimate")
	}
	events, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{})
	if err != nil {
		t.Fatalf("list audit events: %v", err)
	}
	if len(events.GetEvents()) != 1 {
		t.Fatalf("expected one audit event, got %d", len(events.GetEvents()))
	}
	event := events.GetEvents()[0]
	if event.GetOperation() != "SpendDisclosure" || event.GetAppId() != "nimi.example-app" {
		t.Fatalf("unexpected audit event: %+v", event)
	}
}

func TestReportScenarioSpendDisclosureProjectsLocalZeroCost(t *testing.T) {
	svc := &Service{}
	var gotDisclosure spendvisibility.SpendDisclosure
	svc.SetSpendDisclosureReporter(func(_ context.Context, _ spendvisibility.ExecutionInput, disclosure spendvisibility.SpendDisclosure) {
		gotDisclosure = disclosure
	})

	ctx := executionintent.WithIntent(context.Background(), executionintent.Intent{
		CapabilityContract: "text.generate",
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	err := svc.reportScenarioSpendDisclosure(ctx, &runtimev1.ScenarioRequestHead{
		AppId: "nimi.desktop",
	}, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE)
	if err != nil {
		t.Fatalf("report spend disclosure: %v", err)
	}
	if !gotDisclosure.IsZeroCost() || !gotDisclosure.EstimateAvailable {
		t.Fatalf("local route should disclose available zero-cost path: %+v", gotDisclosure)
	}
}
