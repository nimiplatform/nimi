package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestExecuteScenarioRejectsRetiredTextGenerateRouteDescribeExtension(t *testing.T) {
	payload, err := structpb.NewStruct(map[string]any{
		"version":            "v1",
		"resolvedBindingRef": "binding-cloud-001",
	})
	if err != nil {
		t.Fatalf("build retired route describe payload: %v", err)
	}
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	_, err = svc.ExecuteScenario(context.Background(), &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: "nimi.scenario.text_generate.route_describe",
			Payload:   payload,
		}},
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateScenarioSpec{
				Input: []*runtimev1.ChatMessage{{Role: "user", Content: "retired route describe request"}},
			},
		}},
	})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("reason = %v (present=%v), want %v; err=%v", reason, ok, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, err)
	}
}
