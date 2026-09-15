package ai

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

// Real Core, SQLite, Runtime port and canonical Job store; only inference is a
// deterministic Host fixture. This is owner integration, not model acceptance.
func TestMemoryPayloadDispositionAcrossCoreJobsAndRecoveryCopies(t *testing.T) {
	ctx := scenarioJobUserContext("nimi.runtime.memory", "user-001")
	service, _, host, description, initial, statePath := newCapturedLocalMemoryTest(t, ctx)
	if err := service.DiscardMemoryEmbedding(ctx, initial); err != nil {
		t.Fatal(err)
	}
	host.embedResult.Vectors[0].Values[0] = 1
	core, err := memoryv1.Open(filepath.Join(t.TempDir(), "core"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := core.Close(); err != nil {
			t.Errorf("close Memory core: %v", err)
		}
	})
	bank, err := core.EnsureBank(ctx, memoryv1.EnsureBankRequest{ContractVersion: memoryv1.ContractVersion, BindingRef: "bank-binding", OperationID: "ensure-bank"})
	if err != nil {
		t.Fatal(err)
	}
	const content = "I prefer jasmine tea"
	commit := memoryv1.CommitRequest{ContractVersion: memoryv1.ContractVersion, BindingRef: bank.BindingRef, BankRef: bank.BankRef, LifecycleRef: bank.LifecycleRef, EventRef: "event-a", OperationID: "remember-a", DeliverySequence: 1,
		Subjects: []memoryv1.TypedRef{{Kind: "account_subject", Value: "subject-a"}}, Sources: []memoryv1.TypedRef{{Kind: "conversation", Value: "conversation-a"}, {Kind: "message", Value: "event-a"}}, CommittedAt: time.Now().UTC(),
		Fact: memoryv1.CommittedFact{Kind: memoryv1.EventKindMessage, Message: &memoryv1.MessageFact{Actor: memoryv1.ActorUser, Conversation: memoryv1.TypedRef{Kind: "conversation", Value: "conversation-a"}, Message: memoryv1.TypedRef{Kind: "message", Value: "event-a"}, Parts: []memoryv1.MessagePart{{PartRef: memoryv1.TypedRef{Kind: "message_part", Value: "part-a"}, Kind: "text", Text: content}}}},
	}
	if _, err := core.ReceiveCommittedEvent(ctx, commit); err != nil {
		t.Fatal(err)
	}
	if result, err := core.ExecuteRemember(ctx, commit.OperationID); err != nil || result.Outcome != memoryv1.OutcomeAdmitted {
		t.Fatalf("Remember: %+v %v", result, err)
	}
	backend, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := backend.Close(); err != nil {
			t.Errorf("close Memory backend: %v", err)
		}
	})
	failDisposal := true
	executions := 0
	var captured []byte
	port := cognitionmemory.NewRuntimeEmbeddingPort(backend, "user-001", "agent-a",
		func(ctx context.Context, _, agent string, req memoryv1.AIEmbeddingRequest) (cognitionmemory.ResolvedEmbeddingBinding, error) {
			d, raw, err := service.CaptureMemoryEmbedding(ctx, req.Inputs, req.EmbeddingSpaceRef, EmbeddingOwner{Kind: "memory", AgentRef: agent, OperationID: req.OperationID, BankRef: req.BankRef, LifecycleRef: req.LifecycleRef, MemoryRefs: req.MemoryRefs})
			captured = raw
			if err == nil {
				snapshot, readErr := os.ReadFile(service.scenarioJobs.durablePath)
				if readErr != nil {
					t.Fatal(readErr)
				}
				if _, err := service.scenarioJobs.preserveIsolatedRecords(snapshot); err != nil {
					t.Fatal(err)
				}
			}
			return cognitionmemory.ResolvedEmbeddingBinding{ConfigRevision: d.ConfigRevision, EmbeddingSpaceRef: d.SpaceID, Execution: raw}, err
		}, func(ctx context.Context, raw []byte) (memoryv1.AIEmbeddingResult, error) {
			executions++
			result, err := service.ExecuteMemoryEmbedding(ctx, raw)
			return memoryv1.AIEmbeddingResult{Vectors: result.Vectors, Dimension: result.Dimension, SpaceID: result.SpaceID}, err
		}, func(ctx context.Context, _, agent string, raw []byte) error {
			if failDisposal {
				failDisposal = false
				return errors.New("one-shot owner acknowledgement failure")
			}
			return service.DisposeMemoryEmbeddingForOwner(ctx, agent, raw)
		})
	wrapper := &backupAfterEmbeddingPort{RuntimeEmbeddingPort: port, backend: backend}
	caps := memoryv1.CapabilitySnapshot{ConfigRevision: description.ConfigRevision, EmbeddingSpaceRef: description.SpaceID, Available: []memoryv1.Capability{memoryv1.CapabilityTextEmbed, memoryv1.CapabilityVectorIndex}}
	if outcome, err := core.RebuildEmbedding(ctx, "build-a", bank.BankRef, caps, wrapper); err == nil || outcome != memoryv1.OutcomeUnavailable {
		t.Fatalf("expected pending disposal: %s %v", outcome, err)
	}
	if err := core.ResumeEmbeddingDispositions(ctx, bank.BankRef, port); err != nil {
		t.Fatal(err)
	}
	if executions != 1 {
		t.Fatalf("cleanup reran inference %d times", executions)
	}
	if needs, err := core.NeedsEmbeddingRebuild(ctx, bank.BankRef, caps); err != nil || needs {
		t.Fatalf("cleanup invalidated the live index: %v %v", needs, err)
	}
	for _, dbPath := range []string{backend.Path(), wrapper.backup} {
		db, err := sql.Open("sqlite", dbPath)
		if err != nil {
			t.Fatal(err)
		}
		var state, payload string
		var hasResult bool
		err = db.QueryRow(`SELECT payload_disposition, profile_json, result_json IS NOT NULL FROM runtime_cognition_memory_ai_job WHERE operation_id = 'build-a'`).Scan(&state, &payload, &hasResult)
		if closeErr := db.Close(); closeErr != nil {
			t.Errorf("close recovery copy: %v", closeErr)
		}
		if err != nil || state != "disposed" || payload != "{}" || hasResult {
			t.Fatalf("retained recovery copy: %s %s %v %v", state, payload, hasResult, err)
		}
	}
	err = filepath.WalkDir(filepath.Dir(service.scenarioJobs.durablePath), func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if bytes.Contains(raw, []byte(content)) {
			t.Errorf("disposed content remains in %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	restored, err := newScenarioJobStoreForLocalStatePath(statePath)
	if err != nil {
		t.Fatal(err)
	}
	service.scenarioJobs = restored
	if _, err := service.ExecuteMemoryEmbedding(ctx, captured); err == nil {
		t.Fatal("metadata-only Job replayed after restart")
	}
	if len(restored.IsolationDiagnostics()) != 0 {
		t.Fatal("valid metadata-only Job was quarantined")
	}
}

type backupAfterEmbeddingPort struct {
	*cognitionmemory.RuntimeEmbeddingPort
	backend *runtimepersistence.Backend
	backup  string
}

func (p *backupAfterEmbeddingPort) Embed(ctx context.Context, req memoryv1.AIEmbeddingRequest) (memoryv1.AIEmbeddingResult, error) {
	result, err := p.RuntimeEmbeddingPort.Embed(ctx, req)
	if err == nil {
		p.backup, err = p.backend.BackupNow(ctx)
	}
	return result, err
}

func TestMemoryPayloadDeletionUsesOwnerProvenanceNotContentOrAppID(t *testing.T) {
	ctx := scenarioJobUserContext("nimi.runtime.memory", "user-001")
	service, resolver, _, description, rawA, _ := newCapturedLocalMemoryTest(t, ctx)
	ownerB := EmbeddingOwner{Kind: "memory", AgentRef: "agent-b", OperationID: "op-b", BankRef: "bank-b", LifecycleRef: "life-b"}
	_, rawB, err := service.CaptureMemoryEmbedding(ctx, []string{"memory"}, description.SpaceID, ownerB)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := service.DiscardMemoryEmbedding(ctx, rawB); err != nil {
			t.Errorf("discard Agent B embedding capture: %v", err)
		}
	})
	_, rawSource, err := service.CaptureMemoryEmbedding(ctx, []string{"memory"}, description.SpaceID, EmbeddingOwner{Kind: "source", AgentRef: "agent-a", OperationID: "op-source"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := service.DiscardMemoryEmbedding(ctx, rawSource); err != nil {
			t.Errorf("discard Source embedding capture: %v", err)
		}
	})
	effective, err := service.captureSelectedLocalEmbedEffectiveInputs(&runtimev1.TextEmbedScenarioSpec{Inputs: []string{"memory"}}, resolver.projection, nil)
	if err != nil {
		t.Fatal(err)
	}
	ordinary, _, err := service.prepareLocalScenarioJob(ctx, &runtimev1.ScenarioRequestHead{AppId: "nimi.runtime.memory", SubjectUserId: "user-001"}, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, effective.modelResolved(), nil, effective.effectiveInputIdentity, effective.resolvedAssembly)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _, err := service.scenarioJobs.requestCancel(ordinary.GetJobId(), "fixture complete")
		if err != nil {
			t.Error(err)
		}
	}()
	if err := service.DisposeMemoryEmbeddingForOwner(ctx, "agent-b", rawA); err == nil {
		t.Fatal("wrong Agent disposed another Agent's input")
	}
	if err := service.DisposeAgentMemoryEmbeddingPayloads(ctx, "agent-a"); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		raw   []byte
		state string
	}{{rawA, "disposed"}, {rawB, "retained"}, {rawSource, "retained"}} {
		var execution memoryEmbeddingExecution
		if err := json.Unmarshal(tc.raw, &execution); err != nil {
			t.Fatal(err)
		}
		service.scenarioJobs.mu.RLock()
		state := service.scenarioJobs.jobs[execution.Jobs[0]].payload.State
		service.scenarioJobs.mu.RUnlock()
		if state != tc.state {
			t.Fatalf("wrong lifecycle scope: %+v %s", execution.Owner, state)
		}
	}
	if _, ok := service.scenarioJobs.resolvedAssembly(ordinary.GetJobId()); !ok {
		t.Fatal("ordinary same-App same-text Job was deleted")
	}
}

func TestFailedAndInterruptedEmbeddingPayloadsAreDisposedDurably(t *testing.T) {
	for _, interrupted := range []bool{false, true} {
		t.Run(map[bool]string{false: "invalid-output", true: "restart"}[interrupted], func(t *testing.T) {
			ctx := scenarioJobUserContext("nimi.runtime.memory", "user-001")
			service, _, host, _, raw, path := newCapturedLocalMemoryTest(t, ctx)
			var execution memoryEmbeddingExecution
			if err := json.Unmarshal(raw, &execution); err != nil {
				t.Fatal(err)
			}
			if interrupted {
				restored, err := newScenarioJobStoreForLocalStatePathBeforeStartupPrune(path)
				if err != nil {
					t.Fatal(err)
				}
				service.scenarioJobs = restored
				if err := service.resumeEmbeddingPayloadDisposals(ctx); err != nil {
					t.Fatal(err)
				}
			} else {
				host.embedResult.Vectors[0].Values = []float64{1, 2}
				if _, err := service.ExecuteMemoryEmbedding(ctx, raw); err == nil {
					t.Fatal("invalid output succeeded")
				}
			}
			if err := service.DiscardMemoryEmbedding(ctx, raw); err != nil {
				t.Fatal(err)
			}
			restored, err := newScenarioJobStoreForLocalStatePath(path)
			if err != nil {
				t.Fatal(err)
			}
			record := restored.jobs[execution.Jobs[0]]
			if record == nil || record.payload == nil || record.payload.State != "disposed" || record.resolvedAssembly != nil || record.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
				t.Fatalf("failed payload was retained or hidden: %+v", record)
			}
			if err := validateFailedScenarioJobProjection(record.job); err != nil {
				t.Fatal(err)
			}
		})
	}
}
