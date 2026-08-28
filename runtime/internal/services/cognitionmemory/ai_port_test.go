package cognitionmemory

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestRuntimeEmbeddingPortPinsExactBindingAndCleansConsumedResult(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	resolveCalls := 0
	executeCalls := 0
	profile := testEmbeddingProfile("provider-a", "model-a", 2)
	port := NewRuntimeEmbeddingPort(
		backend,
		"subject-a",
		"agent-a",
		func(context.Context, string, string) (ResolvedEmbeddingBinding, error) {
			resolveCalls++
			return ResolvedEmbeddingBinding{ConfigRevision: 7, Profile: proto.Clone(profile).(*runtimev1.MemoryEmbeddingProfile)}, nil
		},
		func(_ context.Context, captured *runtimev1.MemoryEmbeddingProfile, inputs []string) ([][]float64, error) {
			executeCalls++
			if captured.GetProvider() != "provider-a" || captured.GetModelId() != "model-a" {
				t.Fatalf("execution did not use captured target: %+v", captured)
			}
			vectors := make([][]float64, len(inputs))
			for index := range vectors {
				vectors[index] = []float64{1, 0}
			}
			return vectors, nil
		},
	)
	request := memoryv1.AIEmbeddingRequest{OperationID: "operation-a", ConfigRevision: 7, Inputs: []string{"bounded committed input"}}
	first, err := port.Embed(context.Background(), request)
	if err != nil || first.Dimension != 2 || len(first.Vectors) != 1 {
		t.Fatalf("execute first embedding Job: result=%+v err=%v", first, err)
	}
	profile = testEmbeddingProfile("provider-b", "model-b", 2)
	retry, err := port.Embed(context.Background(), request)
	if err != nil || retry.Dimension != first.Dimension || len(retry.Vectors) != 1 {
		t.Fatalf("recover stored embedding result: result=%+v err=%v", retry, err)
	}
	if resolveCalls != 1 || executeCalls != 1 {
		t.Fatalf("same operation re-resolved or re-executed: resolve=%d execute=%d", resolveCalls, executeCalls)
	}
	if _, err := port.Embed(context.Background(), memoryv1.AIEmbeddingRequest{OperationID: request.OperationID, ConfigRevision: 7, Inputs: []string{"changed input"}}); !errors.Is(err, ErrConflict) {
		t.Fatalf("same operation accepted changed input: %v", err)
	}
	if err := port.AcknowledgeConsumed(context.Background(), request.OperationID); err != nil {
		t.Fatalf("acknowledge consumed result: %v", err)
	}
	var status string
	var resultPresent bool
	if err := backend.DB().QueryRow(`SELECT status, result_json IS NOT NULL FROM runtime_cognition_memory_ai_job WHERE operation_id = ?`, request.OperationID).Scan(&status, &resultPresent); err != nil || status != "consumed" || resultPresent {
		t.Fatalf("consumed result was retained: status=%s present=%v err=%v", status, resultPresent, err)
	}
	if _, err := port.Embed(context.Background(), request); !errors.Is(err, ErrConflict) {
		t.Fatalf("consumed result was treated as reusable Job payload: %v", err)
	}
}

func TestRuntimeEmbeddingPortResumesPendingJobWithStoredProfile(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	request := memoryv1.AIEmbeddingRequest{OperationID: "operation-resume", ConfigRevision: 4, Inputs: []string{"resume input"}}
	requestKey, err := embeddingRequestKey("subject-a", "agent-a", request)
	if err != nil {
		t.Fatalf("build request key: %v", err)
	}
	storedProfile := testEmbeddingProfile("provider-old", "model-old", 2)
	profileRaw, err := proto.MarshalOptions{Deterministic: true}.Marshal(storedProfile)
	if err != nil {
		t.Fatalf("marshal stored profile: %v", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO runtime_cognition_memory_ai_job(operation_id, local_agent_ref, account_namespace, config_revision, request_key, profile_json, status, created_at, updated_at) VALUES(?, 'agent-a', 'subject-a', 4, ?, ?, 'pending', ?, ?)`, request.OperationID, requestKey, profileRaw, now, now)
		return err
	}); err != nil {
		t.Fatalf("seed pending Job: %v", err)
	}
	resolveCalls := 0
	port := NewRuntimeEmbeddingPort(
		backend,
		"subject-a",
		"agent-a",
		func(context.Context, string, string) (ResolvedEmbeddingBinding, error) {
			resolveCalls++
			return ResolvedEmbeddingBinding{ConfigRevision: 5, Profile: testEmbeddingProfile("provider-new", "model-new", 2)}, nil
		},
		func(_ context.Context, captured *runtimev1.MemoryEmbeddingProfile, _ []string) ([][]float64, error) {
			if captured.GetProvider() != "provider-old" || captured.GetModelId() != "model-old" {
				t.Fatalf("resume used current target instead of captured target: %+v", captured)
			}
			return [][]float64{{0, 1}}, nil
		},
	)
	result, err := port.Embed(context.Background(), request)
	if err != nil || result.Dimension != 2 || resolveCalls != 0 {
		t.Fatalf("resume pending Job: result=%+v resolve=%d err=%v", result, resolveCalls, err)
	}
}

func testEmbeddingProfile(provider, model string, dimension int32) *runtimev1.MemoryEmbeddingProfile {
	return &runtimev1.MemoryEmbeddingProfile{Provider: provider, ModelId: model, Dimension: dimension, Version: "v1", DistanceMetric: runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE}
}
