package remoteexecution

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aitelemetry"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"
)

func TestFiniteOwnedResultCompletesOneAttemptWithModelComponents(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	backend, err := runtimepersistence.Open(logger, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer func(cleanup func() error) { _ = cleanup() }(backend.Close)
	owner := aitelemetry.Open(backend, logger)
	defer func(cleanup func() error) { _ = cleanup() }(owner.Close)
	from := time.Now().Add(-time.Second)
	models := []*runtimev1.DesktopAIExecutionModel{{ProviderId: "openai", ModelId: "image", Role: "image-render"}, {ProviderId: "openai", ModelId: "author", Role: "svg-author"}}
	ctx := aitelemetry.WithInvocation(context.Background(), owner, aitelemetry.Facts{AccountID: "account", OperationID: "job", Source: aitelemetry.Source{Kind: "app", ID: "app", ParentID: "job", ParentKind: "scenario-job"}, Capability: "image.generate", Models: models, Route: runtimev1.DesktopAIExecutionRoute_DESKTOP_AI_EXECUTION_ROUTE_CLOUD})
	attempt := aitelemetry.Begin(ctx)
	primary := &runtimev1.UsageStats{InputTokens: 11, OutputTokens: 27}
	attempt.SetModelUsage([]*runtimev1.DesktopAIModelUsage{{Model: models[0], Usage: primary}, {Model: models[1], Usage: &runtimev1.UsageStats{InputTokens: 4, OutputTokens: 9}}})
	finishCloudAttempt(attempt, primary, nimillm.ErrFiniteMediaResultOwned)
	owner.FinishOperation("job", primary)
	if err = owner.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	history, err := owner.CloudHistory(context.Background(), "account", "", from, time.Now().Add(time.Second), 20, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Attempts) != 1 {
		t.Fatal("wrong attempt count")
	}
	record := history.Attempts[0]
	if record.Outcome != runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_SUCCEEDED || len(record.ModelUsage) != 2 || record.Usage.InputTokens != 15 || record.Usage.OutputTokens != 36 {
		t.Fatalf("lost finite result observation: %v", record)
	}
}
