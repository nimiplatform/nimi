package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

func TestExecuteScenarioTextGenerateRejectsIncompletePrivateCloudIntent(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	target := cloudScenarioTargetRef("connector-openai-managed", "", "gpt-4o-mini", "openai")
	ctx := withCloudScenarioTestIntent(context.Background(), "text.generate", target)
	_, err := svc.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateScenarioSpec{
				Input: []*runtimev1.ChatMessage{{Role: "user", Content: "normal execution"}},
			},
		}},
	})
	if err == nil {
		t.Fatal("expected incomplete private cloud intent error")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONFIG_INVALID {
		t.Fatalf("reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
}

func TestExecuteScenarioTextGenerateCloudTargetRefStaleAfterEndpointChange(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	connectorSvc := connector.New(logger, store, nil)
	ctx := scenarioJobUserContext("nimi.desktop", "user-001")
	created, err := connectorSvc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		Endpoint: "https://first.example.test/v1",
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connectorID := created.GetConnector().GetConnectorId()
	descriptor := connectorModelDescriptorForAITest(t, connectorSvc, ctx, connectorID, "gpt-4o-mini")
	secondEndpoint := "https://second.example.test/v1"
	if _, err := connectorSvc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: connectorID,
		Endpoint:    &secondEndpoint,
	}); err != nil {
		t.Fatalf("UpdateConnector endpoint: %v", err)
	}

	svc, err := newFromProviderConfig(logger, nil, nil, nil, store, Config{}, 8, 2)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	target := cloudScenarioTargetRefForDescriptor(connectorID, descriptor)
	execCtx := withCloudScenarioTestIntent(ctx, "text.generate", target)
	_, err = svc.ExecuteScenario(execCtx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateScenarioSpec{
				Input: []*runtimev1.ChatMessage{{Role: "user", Content: "normal execution"}},
			},
		}},
	})
	if err == nil {
		t.Fatal("expected stale remote model catalog id error")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND {
		t.Fatalf("reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
}
