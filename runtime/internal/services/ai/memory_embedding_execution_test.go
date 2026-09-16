package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	"google.golang.org/protobuf/types/known/structpb"
)

// This runs the actual Memory port -> AI Service -> captured canonical Job ->
// HTTP Driver chain. The external server is a protocol fixture, not acceptance.
func TestMemoryEmbeddingBridgeUsesCapturedJobsAfterConfigChange(t *testing.T) {
	for _, badBatch := range []bool{false, true} {
		t.Run(map[bool]string{false: "captured-route", true: "mixed-space"}[badBatch], func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !strings.HasSuffix(r.URL.Path, "/embeddings") {
					http.NotFound(w, r)
					return
				}
				n := calls.Add(1)
				var req struct {
					Model string   `json:"model"`
					Input []string `json:"input"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				if req.Model != "text-embedding-3-small" {
					t.Errorf("uncaptured model: %s", req.Model)
				}
				dimension := 1536
				if badBatch && n == 2 {
					dimension--
				}
				data := make([]map[string]any, len(req.Input))
				for i := range data {
					v := make([]float64, dimension)
					v[0] = 1
					data[i] = map[string]any{"embedding": v, "index": i}
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "openai", "text-embedding-3-small", server.URL, Config{CloudProviders: map[string]nimillm.ProviderCredentials{}, AllowLoopbackEndpoint: true})
			catalog, err := aicatalog.NewResolver(aicatalog.ResolverConfig{CustomDir: t.TempDir()})
			if err != nil {
				t.Fatal(err)
			}
			store, _ := newDurableScenarioJobStoreForFailureTest(t)
			f.service.scenarioJobs = store
			f.service.speechCatalog = catalog
			f.connectorService.SetModelCatalogResolver(catalog)
			target, _ := structpb.NewStruct(map[string]any{"provider": "openai", "providerModelId": f.descriptor.GetProviderModelId(), "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
			config := &runtimev1.AIConfig{Owner: aiconfig.LocalAgentSubsystemOwner(), Capabilities: []*runtimev1.AIConfigCapabilityIntent{{CapabilityContract: capabilitydriver.TextEmbedCapabilityContract, Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{ConnectorRef: f.connectorID, Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.text.embed.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai/embeddings/v1"}, ProviderModelTarget: target}}}}}
			if err := overwriteAIConfigStoreForTest(f.context, f.service.aiConfigStore, "user-001", config); err != nil {
				t.Fatal(err)
			}
			description, err := f.service.DescribeMemoryEmbedding(f.context)
			if err != nil {
				t.Fatal(err)
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
			var captured []byte
			port := cognitionmemory.NewRuntimeEmbeddingPort(backend, "user-001", "agent-a",
				func(ctx context.Context, _, _ string, req memoryv1.AIEmbeddingRequest) (cognitionmemory.ResolvedEmbeddingBinding, error) {
					d, raw, err := f.service.CaptureMemoryEmbedding(ctx, req.Inputs, req.EmbeddingSpaceRef, EmbeddingOwner{Kind: "memory", AgentRef: "agent-a", OperationID: req.OperationID, BankRef: "bank-a", LifecycleRef: "life-a"})
					if err != nil {
						return cognitionmemory.ResolvedEmbeddingBinding{}, err
					}
					captured = raw
					durable, readErr := os.ReadFile(store.durablePath)
					if readErr != nil || !bytes.Contains(durable, []byte("ai_config_revision")) || bytes.Contains(durable, []byte("test-key")) {
						t.Fatalf("incomplete or secret-bearing Memory Job capture: %v", readErr)
					}
					if calls.Load() != 0 {
						t.Fatal("provider called before custody")
					}
					if err := overwriteAIConfigStoreForTest(ctx, f.service.aiConfigStore, "user-001", &runtimev1.AIConfig{Owner: aiconfig.LocalAgentSubsystemOwner()}); err != nil {
						t.Fatal(err)
					}
					return cognitionmemory.ResolvedEmbeddingBinding{ConfigRevision: d.ConfigRevision, EmbeddingSpaceRef: d.SpaceID, Execution: raw, Discard: func() error { return f.service.DiscardMemoryEmbedding(context.WithoutCancel(ctx), raw) }}, nil
				}, func(ctx context.Context, raw []byte) (memoryv1.AIEmbeddingResult, error) {
					r, err := f.service.ExecuteMemoryEmbedding(ctx, raw)
					return memoryv1.AIEmbeddingResult{Vectors: r.Vectors, Dimension: r.Dimension, SpaceID: r.SpaceID}, err
				}, func(ctx context.Context, _, agent string, raw []byte) error {
					return f.service.DisposeMemoryEmbeddingForOwner(ctx, agent, raw)
				})
			req := memoryv1.AIEmbeddingRequest{OperationID: "memory-build", ConfigRevision: description.ConfigRevision, EmbeddingSpaceRef: description.SpaceID, Inputs: make([]string, 21)}
			for i := range req.Inputs {
				req.Inputs[i] = "committed memory text"
			}
			result, err := port.Embed(f.context, req)
			if badBatch {
				if err == nil {
					t.Fatal("mixed actual embedding spaces were accepted")
				}
				if calls.Load() != 2 {
					t.Fatalf("continued after incompatible batch: %d", calls.Load())
				}
				return
			}
			if err != nil || len(result.Vectors) != 21 || result.SpaceID != description.SpaceID {
				t.Fatalf("captured result: %+v %v", result, err)
			}
			if _, err := port.Embed(f.context, req); err != nil {
				t.Fatal(err)
			}
			if calls.Load() != 3 {
				t.Fatalf("result retry re-executed: %d", calls.Load())
			}
			if _, err := f.service.ExecuteMemoryEmbedding(f.context, captured); err == nil {
				t.Fatal("terminal Jobs were redispatched")
			}
		})
	}
}

func newCapturedLocalMemoryTest(t *testing.T, ctx context.Context) (*Service, *mutableLocalExecutionResolver, *localTextHostStub, MemoryEmbeddingDescription, []byte, string) {
	t.Helper()
	s := newTestService(nil)
	store, statePath := newDurableScenarioJobStoreForFailureTest(t)
	s.scenarioJobs = store
	catalog, err := aicatalog.NewResolver(aicatalog.ResolverConfig{})
	if err != nil {
		t.Fatal(err)
	}
	s.speechCatalog = catalog
	digest := "d4e388894e09cf3816e8b0896d81d265b55e7a9fff9ab03fe8bf4ef5e11295ac" // pragma: allowlist secret - fixture model content digest
	dir := t.TempDir()
	resolver := &mutableLocalExecutionResolver{projection: &localexecution.SelectedLocalExecution{LoadoutID: "old-loadout", CapabilityContract: capabilitydriver.TextEmbedCapabilityContract, RecipeID: capabilitydriver.LlamaEmbedGGUFRecipeID, RecipeRevision: "1", DriverIdentity: (&capabilitydriver.Identity{ImplementationID: capabilitydriver.LlamaEmbedImplementationID, DriverID: capabilitydriver.LlamaDriverID, DriverDialect: capabilitydriver.LlamaEmbedDriverDialect}).Proto(), ModelContextWindowTokens: 8192, EmbeddingDimension: 768, Requirements: []*runtimev1.LocalCapabilityRequirement{{RequirementId: capabilitydriver.EmbeddingGGUFRequirementID}}, ExactBindings: []localexecution.ExactBinding{{RequirementID: capabilitydriver.EmbeddingGGUFRequirementID, ModelAssetID: "old-asset", AbsolutePath: filepath.Join(dir, "embedding.gguf"), BundleDir: dir, DeclaredFiles: []string{"embedding.gguf"}, VerifiedContentID: "sha256:" + digest, EntrySHA256: digest}}, Configured: true}}
	s.SetLocalExecutionResolver(resolver)
	host := &localTextHostStub{embedResult: localexecution.EmbedResult{Vectors: []*runtimev1.EmbeddingVector{{Values: make([]float64, 768)}}}}
	s.SetLocalTextExecutionHost(host)
	if err := overwriteAIConfigStoreForTest(ctx, s.aiConfigStore, "user-001", &runtimev1.AIConfig{Owner: aiconfig.LocalAgentSubsystemOwner(), Capabilities: []*runtimev1.AIConfigCapabilityIntent{{CapabilityContract: capabilitydriver.TextEmbedCapabilityContract, Route: &runtimev1.AIConfigCapabilityIntent_Local{Local: &runtimev1.AIConfigLocalIntent{}}}}}); err != nil {
		t.Fatal(err)
	}
	d, err := s.DescribeMemoryEmbedding(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, raw, err := s.CaptureMemoryEmbedding(ctx, []string{"memory"}, d.SpaceID, EmbeddingOwner{Kind: "memory", AgentRef: "agent-a", OperationID: "operation-a", BankRef: "bank-a", LifecycleRef: "life-a"})
	if err != nil {
		t.Fatal(err)
	}
	return s, resolver, host, d, raw, statePath
}

func TestMemoryEmbeddingLocalCaptureIgnoresLaterSelection(t *testing.T) {
	ctx := scenarioJobUserContext("nimi.runtime.memory", "user-001")
	s, resolver, host, d, raw, _ := newCapturedLocalMemoryTest(t, ctx)
	resolver.projection = nil
	result, err := s.ExecuteMemoryEmbedding(ctx, raw)
	if err != nil || result.SpaceID != d.SpaceID {
		t.Fatalf("capture changed: %+v %v", result, err)
	}
	host.mu.Lock()
	defer host.mu.Unlock()
	if host.capturedEmbedPlan.ModelFiles()[0].ModelAssetID != "old-asset" {
		t.Fatal("used current selection")
	}
}

func TestMemoryEmbeddingCaptureReportsPartialBatchCleanupFailure(t *testing.T) {
	ctx := scenarioJobUserContext("nimi.runtime.memory", "user-001")
	s, _, _, description, initial, _ := newCapturedLocalMemoryTest(t, ctx)
	if err := s.DiscardMemoryEmbedding(ctx, initial); err != nil {
		t.Fatal(err)
	}
	captureErr, cleanupErr := errors.New("second batch capture failed"), errors.New("payload cleanup failed")
	created := 0
	s.scenarioJobs.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Operation == scenarioJobPersistCreate {
			created++
			if created == 2 {
				return captureErr
			}
		}
		if attempt.Operation == "payload-fence" {
			return cleanupErr
		}
		return nil
	}
	t.Cleanup(func() {
		s.scenarioJobs.mu.Lock()
		s.scenarioJobs.persistenceFailure = nil
		s.scenarioJobs.mu.Unlock()
		if err := s.DisposeAgentMemoryEmbeddingPayloads(ctx, "agent-a"); err != nil {
			t.Errorf("dispose partial capture: %v", err)
		}
	})
	inputs := make([]string, memoryEmbeddingBatchSize+1)
	for i := range inputs {
		inputs[i] = "memory"
	}
	_, raw, err := s.CaptureMemoryEmbedding(ctx, inputs, description.SpaceID, EmbeddingOwner{Kind: "memory", AgentRef: "agent-a", OperationID: "partial-capture", BankRef: "bank-a", LifecycleRef: "life-a"})
	if raw != nil || !errors.Is(err, captureErr) || !errors.Is(err, cleanupErr) {
		t.Fatalf("lost capture or cleanup failure: capture=%s err=%v", raw, err)
	}
}

func TestMemoryEmbeddingExecutionReportsCleanupFailure(t *testing.T) {
	for _, invalidOutput := range []bool{false, true} {
		t.Run(map[bool]string{false: "valid-output", true: "invalid-output"}[invalidOutput], func(t *testing.T) {
			ctx := scenarioJobUserContext("nimi.runtime.memory", "user-001")
			s, _, host, _, raw, _ := newCapturedLocalMemoryTest(t, ctx)
			if invalidOutput {
				host.embedResult.Vectors[0].Values = []float64{1, 2}
			}
			cleanupErr := errors.New("payload cleanup failed")
			s.scenarioJobs.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
				if attempt.Operation == "payload-dispose" {
					return cleanupErr
				}
				return nil
			}
			t.Cleanup(func() {
				s.scenarioJobs.mu.Lock()
				s.scenarioJobs.persistenceFailure = nil
				s.scenarioJobs.mu.Unlock()
				if err := s.DiscardMemoryEmbedding(ctx, raw); err != nil {
					t.Errorf("retry payload cleanup: %v", err)
				}
			})
			result, err := s.ExecuteMemoryEmbedding(ctx, raw)
			if !errors.Is(err, cleanupErr) || len(result.Vectors) != 0 || result.SpaceID != "" || result.Dimension != 0 {
				t.Fatalf("cleanup failure returned success or a result: %+v %v", result, err)
			}
			if invalidOutput {
				if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
					t.Fatalf("lost original execution reason: %v", err)
				}
			}
			var execution memoryEmbeddingExecution
			if err := json.Unmarshal(raw, &execution); err != nil {
				t.Fatal(err)
			}
			s.scenarioJobs.mu.RLock()
			state := s.scenarioJobs.jobs[execution.Jobs[0]].payload.State
			s.scenarioJobs.mu.RUnlock()
			if state != "pending" {
				t.Fatalf("cleanup obligation was lost: %s", state)
			}
		})
	}
}

func TestMemoryEmbeddingPendingCancellationAndMissingJobFailClosed(t *testing.T) {
	for _, state := range []string{"missing-job", "canceled-before-execution", "restart"} {
		t.Run(state, func(t *testing.T) {
			ctx, cancel := context.WithCancel(scenarioJobUserContext("nimi.runtime.memory", "user-001"))
			defer cancel()
			s, _, host, _, raw, statePath := newCapturedLocalMemoryTest(t, ctx)
			// Keep custody of the real capture even when the request below is corrupt.
			original := append([]byte(nil), raw...)
			defer func() {
				if err := s.DiscardMemoryEmbedding(context.WithoutCancel(ctx), original); err != nil {
					t.Errorf("discard original embedding capture: %v", err)
				}
			}()
			var execution memoryEmbeddingExecution
			if err := json.Unmarshal(raw, &execution); err != nil {
				t.Fatal(err)
			}
			if state == "canceled-before-execution" {
				s.scenarioJobs.mu.RLock()
				done := s.scenarioJobs.jobs[execution.Jobs[0]].done
				s.scenarioJobs.mu.RUnlock()
				cancel()
				select {
				case <-done:
				case <-time.After(2 * time.Second):
					t.Fatal("prepared Job retained custody after cancellation")
				}
				job, _ := s.scenarioJobs.get(execution.Jobs[0])
				if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
					t.Fatalf("unexpected terminal status: %s", job.GetStatus())
				}
			} else if state == "restart" {
				restored, err := newScenarioJobStoreForLocalStatePath(statePath)
				if err != nil {
					t.Fatal(err)
				}
				s.scenarioJobs = restored
			} else {
				// A missing canonical Job is not reconstructed from current configuration.
				execution.Jobs[0] = "missing-canonical-job"
				raw, _ = json.Marshal(execution)
			}
			if _, err := s.ExecuteMemoryEmbedding(context.WithoutCancel(ctx), raw); err == nil {
				t.Fatal("missing or canceled Job executed")
			}
			host.mu.Lock()
			defer host.mu.Unlock()
			if host.capturedEmbedPlan != nil {
				t.Fatal("provider executed without captured Job custody")
			}
		})
	}
}
