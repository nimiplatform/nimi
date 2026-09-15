package cognitionmemory

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

func TestRuntimeEmbeddingPortPinsExactBindingAndCleansConsumedResult(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	resolves, executes := 0, 0
	payload := []byte(`{"job":"captured-a"}`)
	port := newFixtureEmbeddingPort(backend, "account-a", "agent-a",
		func(context.Context, string, string, memoryv1.AIEmbeddingRequest) (ResolvedEmbeddingBinding, error) {
			resolves++
			return ResolvedEmbeddingBinding{ConfigRevision: 7, EmbeddingSpaceRef: "space-a", Execution: payload}, nil
		}, func(_ context.Context, raw []byte) (memoryv1.AIEmbeddingResult, error) {
			executes++
			if string(raw) != `{"job":"captured-a"}` {
				t.Fatal("lost captured canonical Job")
			}
			return memoryv1.AIEmbeddingResult{Vectors: [][]float64{{1, 0}}, Dimension: 2, SpaceID: "space-a"}, nil
		})
	request := memoryv1.AIEmbeddingRequest{OperationID: "operation-a", ConfigRevision: 7, EmbeddingSpaceRef: "space-a", Inputs: []string{"committed input"}}
	if _, err := port.Embed(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	payload = []byte(`{"job":"new-b"}`)
	if _, err := port.Embed(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if resolves != 1 || executes != 1 {
		t.Fatalf("replayed canonical Job: resolve=%d execute=%d", resolves, executes)
	}
	changed := request
	changed.Inputs = []string{"changed input"}
	if _, err := port.Embed(context.Background(), changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed request accepted: %v", err)
	}
	if err := port.AcknowledgeConsumed(context.Background(), request.OperationID); err != nil {
		t.Fatal(err)
	}
	var retained bool
	if err := backend.DB().QueryRow(`SELECT result_json IS NOT NULL FROM runtime_cognition_memory_ai_job WHERE operation_id = ?`, request.OperationID).Scan(&retained); err != nil || retained {
		t.Fatalf("retained result: %v %v", retained, err)
	}
	if _, err := port.Embed(context.Background(), request); !errors.Is(err, ErrConflict) {
		t.Fatalf("consumed result reused: %v", err)
	}
}

func TestRuntimeEmbeddingPortResumesPendingJobWithStoredExecution(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	request := memoryv1.AIEmbeddingRequest{OperationID: "operation-resume", ConfigRevision: 4, EmbeddingSpaceRef: "space-old", Inputs: []string{"resume input"}}
	key, err := embeddingRequestKey("account-a", "agent-a", request)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO runtime_cognition_memory_ai_job(operation_id, local_agent_ref, account_namespace, config_revision, request_key, profile_json, status, created_at, updated_at) VALUES(?, 'agent-a', 'account-a', 4, ?, ?, 'pending', ?, ?)`, request.OperationID, key, []byte(`{"job":"old"}`), now, now)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	port := newFixtureEmbeddingPort(backend, "account-a", "agent-a",
		func(context.Context, string, string, memoryv1.AIEmbeddingRequest) (ResolvedEmbeddingBinding, error) {
			t.Fatal("resumed Job read current binding")
			return ResolvedEmbeddingBinding{}, nil
		},
		func(_ context.Context, raw []byte) (memoryv1.AIEmbeddingResult, error) {
			if string(raw) != `{"job":"old"}` {
				t.Fatalf("wrong capture: %s", raw)
			}
			return memoryv1.AIEmbeddingResult{Vectors: [][]float64{{0, 1}}, Dimension: 2, SpaceID: "space-old"}, nil
		})
	if _, err := port.Embed(context.Background(), request); err != nil {
		t.Fatal(err)
	}
}

func TestRuntimeEmbeddingPortRejectsActualSpaceMismatch(t *testing.T) {
	for _, space := range []string{"", "other-space"} {
		t.Run("space="+space, func(t *testing.T) {
			backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
			port := newFixtureEmbeddingPort(backend, "account-a", "agent-a",
				func(context.Context, string, string, memoryv1.AIEmbeddingRequest) (ResolvedEmbeddingBinding, error) {
					return ResolvedEmbeddingBinding{ConfigRevision: 12, EmbeddingSpaceRef: "space-a", Execution: json.RawMessage(`{"job":"a"}`)}, nil
				},
				func(context.Context, []byte) (memoryv1.AIEmbeddingResult, error) {
					return memoryv1.AIEmbeddingResult{Vectors: [][]float64{{0, 1}}, Dimension: 2, SpaceID: space}, nil
				})
			_, err := port.Embed(context.Background(), memoryv1.AIEmbeddingRequest{OperationID: "operation-a", ConfigRevision: 11, EmbeddingSpaceRef: "space-a", Inputs: []string{"input"}})
			if err == nil {
				t.Fatal("actual space mismatch accepted")
			}
			var status string
			var retained bool
			if err := backend.DB().QueryRow(`SELECT status, result_json IS NOT NULL FROM runtime_cognition_memory_ai_job WHERE operation_id = 'operation-a'`).Scan(&status, &retained); err != nil || status != "failed" || retained {
				t.Fatalf("invalid output retained: %s %v %v", status, retained, err)
			}
		})
	}
}

func TestRuntimeEmbeddingPortConcurrentRetryPreservesExecutingOwner(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "state.json"))
	started, release := make(chan struct{}), make(chan struct{})
	port := newFixtureEmbeddingPort(backend, "account-a", "agent-a",
		func(context.Context, string, string, memoryv1.AIEmbeddingRequest) (ResolvedEmbeddingBinding, error) {
			return ResolvedEmbeddingBinding{ConfigRevision: 1, EmbeddingSpaceRef: "space-a", Execution: []byte(`{"job":"owned"}`)}, nil
		},
		func(context.Context, []byte) (memoryv1.AIEmbeddingResult, error) {
			close(started)
			<-release
			return memoryv1.AIEmbeddingResult{SpaceID: "space-a", Dimension: 2, Vectors: [][]float64{{1, 0}}}, nil
		})
	req := memoryv1.AIEmbeddingRequest{OperationID: "operation", ConfigRevision: 1, EmbeddingSpaceRef: "space-a", Inputs: []string{"input"}}
	done := make(chan error, 1)
	go func() { _, err := port.Embed(context.Background(), req); done <- err }()
	<-started
	_, err := port.Embed(context.Background(), req)
	close(release)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("concurrent execution was not rejected: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("retry damaged executing owner: %v", err)
	}
}

func TestRuntimeEmbeddingPortAllowsUnrelatedOwnerRevisionWhenSpaceIsUnchanged(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "state.json"))
	port := newFixtureEmbeddingPort(backend, "account-a", "agent-a",
		func(context.Context, string, string, memoryv1.AIEmbeddingRequest) (ResolvedEmbeddingBinding, error) {
			return ResolvedEmbeddingBinding{ConfigRevision: 12, EmbeddingSpaceRef: "space-stable", Execution: []byte(`{"job":"current"}`)}, nil
		},
		func(context.Context, []byte) (memoryv1.AIEmbeddingResult, error) {
			return memoryv1.AIEmbeddingResult{SpaceID: "space-stable", Dimension: 2, Vectors: [][]float64{{1, 0}}}, nil
		})
	result, err := port.Embed(context.Background(), memoryv1.AIEmbeddingRequest{OperationID: "operation-stable", ConfigRevision: 11, EmbeddingSpaceRef: "space-stable", Inputs: []string{"input"}})
	if err != nil || result.SpaceID != "space-stable" {
		t.Fatalf("unrelated owner revision invalidated compatible embedding: %+v %v", result, err)
	}
}

func TestRuntimeEmbeddingPortReportsUnpublishedCaptureCleanupFailure(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "state.json"))
	cleanupErr := errors.New("capture cleanup failed")
	port := newFixtureEmbeddingPort(backend, "account-a", "agent-a",
		func(context.Context, string, string, memoryv1.AIEmbeddingRequest) (ResolvedEmbeddingBinding, error) {
			return ResolvedEmbeddingBinding{
				ConfigRevision: 1, EmbeddingSpaceRef: "space-a", Execution: []byte(`{"job":"captured"}`),
				Validate: func(*sql.Tx) error { return ErrConflict },
				Discard:  func() error { return cleanupErr },
			}, nil
		}, func(context.Context, []byte) (memoryv1.AIEmbeddingResult, error) {
			t.Fatal("unpublished capture executed")
			return memoryv1.AIEmbeddingResult{}, nil
		})
	_, err := port.Embed(context.Background(), memoryv1.AIEmbeddingRequest{OperationID: "unpublished", ConfigRevision: 1, EmbeddingSpaceRef: "space-a", Inputs: []string{"input"}})
	if !errors.Is(err, ErrConflict) || !errors.Is(err, cleanupErr) {
		t.Fatalf("lost publication or cleanup error: %v", err)
	}
	var count int
	if err := backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_cognition_memory_ai_job WHERE operation_id = 'unpublished'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("failed capture was published: count=%d err=%v", count, err)
	}
}

// The component fixture executor retains no canonical ScenarioJob content.
// Cross-owner disposal is exercised separately with the actual AI Service.
func newFixtureEmbeddingPort(backend *runtimepersistence.Backend, account, agent string, resolve EmbeddingBindingResolver, execute EmbeddingExecutor) *RuntimeEmbeddingPort {
	return NewRuntimeEmbeddingPort(backend, account, agent, resolve, execute, func(context.Context, string, string, []byte) error { return nil })
}
