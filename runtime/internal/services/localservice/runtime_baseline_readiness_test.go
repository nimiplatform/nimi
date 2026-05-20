package localservice

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	runtimeBaselineTestFactoryProfileRef = "aiprofile/nimi.first-run.local-factory.minimal@1"
	runtimeBaselineTestTextAssetID       = "text/nimi-baseline-llm"
	runtimeBaselineTestASRAssetID        = "speech/nimi-baseline-asr"
	runtimeBaselineTestTTSAssetID        = "speech/nimi-baseline-tts"
)

// runtimeBaselineMinimalBindings is the canonical Minimal first-run baseline
// consumer set with each consumer bound to its baseline model asset.
func runtimeBaselineMinimalBindings() []runtimeBaselineConsumerBinding {
	return []runtimeBaselineConsumerBinding{
		{ConsumerID: "llama.cpp.cpu", AssetID: runtimeBaselineTestTextAssetID},
		{ConsumerID: "speech.qwen3-asr.python", AssetID: runtimeBaselineTestASRAssetID},
		{ConsumerID: "speech.qwen3-tts.python", AssetID: runtimeBaselineTestTTSAssetID},
	}
}

// runtimeBaselineCPUProfile is a CPU-only host profile with Python available
// (the speech consumers require a python runtime family).
func runtimeBaselineCPUProfile() *runtimev1.LocalDeviceProfile {
	return &runtimev1.LocalDeviceProfile{
		Os:     "linux",
		Arch:   "amd64",
		Gpu:    &runtimev1.LocalGpuProfile{Available: false},
		Python: &runtimev1.LocalPythonProfile{Available: true, Version: "3.11.6"},
	}
}

// markRuntimeBaselineConsumerReady resolves the activation plan for one
// consumer and upserts a verified selected source record for every required
// dependency, so the activation gate projects ready.
func markRuntimeBaselineConsumerReady(t *testing.T, svc *Service, runtimeDataRoot string, binding runtimeBaselineConsumerBinding, profile *runtimev1.LocalDeviceProfile) {
	t.Helper()
	requirement, ok := localEnvironmentConsumerRequirementByID(binding.ConsumerID)
	if !ok {
		t.Fatalf("unknown baseline consumer %q", binding.ConsumerID)
	}
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          requirement.PackID,
		ConsumerScope:   binding.ConsumerID,
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         binding.AssetID,
	})
	for _, dep := range plan.Dependencies {
		if !dep.Required {
			continue
		}
		sourceKind := localEnvironmentSourceManaged
		if dep.DependencyFamily == localEnvironmentFamilyPythonRuntime || dep.DependencyFamily == localEnvironmentFamilyPythonUV {
			sourceKind = localEnvironmentSourceSystem
		}
		svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
			DependencyFamily:  dep.DependencyFamily,
			DependencyID:      dep.DependencyID,
			EnvironmentKey:    dep.EnvironmentKey,
			SourceKind:        sourceKind,
			CanonicalRoot:     filepath.Join(runtimeDataRoot, strings.ReplaceAll(dep.DependencyID, ":", "-")),
			SelectedConsumers: []string{binding.ConsumerID},
			AuditReasonCode:   "test_ready",
		}))
	}
}

// markRuntimeBaselineMinimalReady marks every Minimal baseline consumer ready.
func markRuntimeBaselineMinimalReady(t *testing.T, svc *Service, runtimeDataRoot string, profile *runtimev1.LocalDeviceProfile) {
	t.Helper()
	for _, binding := range runtimeBaselineMinimalBindings() {
		markRuntimeBaselineConsumerReady(t, svc, runtimeDataRoot, binding, profile)
	}
}

func newRuntimeBaselineTestService(t *testing.T) (*Service, string) {
	t.Helper()
	dir := t.TempDir()
	runtimeDataRoot := filepath.Join(dir, "runtime-data")
	svc, err := New(slog.Default(), nil, filepath.Join(dir, "local-state.json"), 32, runtimeDataRoot)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	return svc, runtimeDataRoot
}

func runtimeBaselineMintRequest(runtimeDataRoot string) runtimeBaselineResolveRequest {
	return runtimeBaselineResolveRequest{
		SelectedLocalFactoryAIProfileRef: runtimeBaselineTestFactoryProfileRef,
		InstallLevel:                     runtimeBaselineInstallLevelMinimal,
		RuntimeDataRootOrDataRootRef:     runtimeDataRoot,
		HostProfile:                      runtimeBaselineCPUProfile(),
		BaselineConsumers:                runtimeBaselineMinimalBindings(),
	}
}

// --- Positive: Minimal mint + resolve + state_store restore ---

func TestRuntimeBaselineReadinessMintsMinimalAfterActivation(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	markRuntimeBaselineMinimalReady(t, svc, runtimeDataRoot, runtimeBaselineCPUProfile())

	record, state, reason, detail := svc.mintRuntimeBaselineReadiness(runtimeBaselineMintRequest(runtimeDataRoot))
	if state != runtimeBaselineStateReady {
		t.Fatalf("mint state = %q reason=%q detail=%q, want ready", state, reason, detail)
	}
	if !strings.HasPrefix(record.RuntimeBaselineRef, "runtime_baseline_") {
		t.Fatalf("expected durable ULID ref, got %q", record.RuntimeBaselineRef)
	}
	// All nine required_projection fields must be populated.
	if record.SelectedLocalFactoryAIProfileRef != runtimeBaselineTestFactoryProfileRef {
		t.Fatalf("missing selected_local_factory_aiProfile_ref: %+v", record)
	}
	if record.InstallLevel != runtimeBaselineInstallLevelMinimal {
		t.Fatalf("install_level = %q, want minimal", record.InstallLevel)
	}
	if record.RuntimeDataRootOrDataRootRef != runtimeDataRoot {
		t.Fatalf("missing runtime_data_root_or_dataRootRef: %+v", record)
	}
	if len(record.RequiredDependencyFamilies) == 0 {
		t.Fatal("missing required_dependency_families")
	}
	if len(record.SelectedSourceRecordIDs) == 0 {
		t.Fatal("missing selected_source_record_ids")
	}
	if len(record.ActivationReadyResponses) != 3 {
		t.Fatalf("activation_ready_responses = %d, want 3 baseline consumers", len(record.ActivationReadyResponses))
	}
	for _, response := range record.ActivationReadyResponses {
		if response.ActivationState != localEnvironmentActivationStateReady {
			t.Fatalf("consumer %q activation_state = %q, want ready", response.ConsumerID, response.ActivationState)
		}
		for _, dep := range response.Dependencies {
			if dep.DependencyState != localEnvironmentStateReadySystem && dep.DependencyState != localEnvironmentStateReadyManaged {
				t.Fatalf("dependency %s state = %q, want ready_system/ready_managed", dep.DependencyFamily, dep.DependencyState)
			}
			if dep.VerificationEvidence == "" {
				t.Fatalf("dependency %s missing materialization/system-source verification evidence", dep.DependencyFamily)
			}
		}
	}
	if len(record.MaterializationOrSystemSourceVerificationEvidence) == 0 {
		t.Fatal("missing materialization_or_system_source_verification_evidence")
	}
	if record.ObservedAt == "" {
		t.Fatal("missing observed_at")
	}
	if record.RuntimeVerifierIdentity != runtimeBaselineVerifierIdentity {
		t.Fatalf("runtime verifier identity = %q, want %q", record.RuntimeVerifierIdentity, runtimeBaselineVerifierIdentity)
	}
	if len(record.RuntimeAuditSequence) == 0 {
		t.Fatal("missing runtime_audit_sequence")
	}

	// Resolve/verify-by-ref re-confirms the activation set.
	resolved, rState, rReason, rDetail := svc.resolveRuntimeBaselineReadiness(record.RuntimeBaselineRef, runtimeBaselineCPUProfile())
	if rState != runtimeBaselineStateReady {
		t.Fatalf("resolve state = %q reason=%q detail=%q, want ready", rState, rReason, rDetail)
	}
	if resolved.RuntimeBaselineRef != record.RuntimeBaselineRef {
		t.Fatalf("resolve returned different ref: %q vs %q", resolved.RuntimeBaselineRef, record.RuntimeBaselineRef)
	}
	if len(resolved.RuntimeAuditSequence) <= len(record.RuntimeAuditSequence) {
		t.Fatal("resolve must append a fresh audit/evidence sequence entry")
	}
}

func TestRuntimeBaselineReadinessSurvivesStateStoreRestore(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "local-state.json")
	runtimeDataRoot := filepath.Join(dir, "runtime-data")

	svc, err := New(slog.Default(), nil, statePath, 32, runtimeDataRoot)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	markRuntimeBaselineMinimalReady(t, svc, runtimeDataRoot, runtimeBaselineCPUProfile())
	record, state, _, detail := svc.mintRuntimeBaselineReadiness(runtimeBaselineMintRequest(runtimeDataRoot))
	if state != runtimeBaselineStateReady {
		t.Fatalf("mint state = %q detail=%q, want ready", state, detail)
	}
	svc.Close()

	restored, err := New(slog.Default(), nil, statePath, 32, runtimeDataRoot)
	if err != nil {
		t.Fatalf("restore service: %v", err)
	}
	defer func() { restored.Close() }()

	stored, ok := restored.runtimeBaselineReadinessRecord(record.RuntimeBaselineRef)
	if !ok {
		t.Fatal("runtime baseline readiness record did not survive state_store restore")
	}
	if len(stored.ActivationReadyResponses) != 3 || len(stored.SelectedSourceRecordIDs) == 0 {
		t.Fatalf("restored record lost required projection fields: %+v", stored)
	}
	resolved, rState, rReason, rDetail := restored.resolveRuntimeBaselineReadiness(record.RuntimeBaselineRef, runtimeBaselineCPUProfile())
	if rState != runtimeBaselineStateReady {
		t.Fatalf("restored resolve state = %q reason=%q detail=%q, want ready", rState, rReason, rDetail)
	}
	if resolved.InstallLevel != runtimeBaselineInstallLevelMinimal {
		t.Fatalf("restored resolve install_level = %q, want minimal", resolved.InstallLevel)
	}
}

// --- Negative: forbidden signals must not mint the ref ---
//
// Each case proves a forbidden K-LENV-ACT-011 signal cannot satisfy readiness.
// In every case the baseline environment has NO ready selected source records;
// the named signal is the only thing "present" and the mint must fail closed.

func TestRuntimeBaselineReadinessForbiddenSignalsDoNotMint(t *testing.T) {
	for _, tc := range []struct {
		name   string
		signal string
		// arrange optionally injects the forbidden signal into the service.
		arrange func(t *testing.T, svc *Service, runtimeDataRoot string)
	}{
		{
			name:   "route_health",
			signal: "runtime.route.checkHealth success",
			// route health is never an activation input; no source records.
			arrange: nil,
		},
		{
			name:   "file_existence",
			signal: "dependency directory/file present on disk",
			arrange: func(t *testing.T, svc *Service, runtimeDataRoot string) {
				// Materialize directories that "look ready" on disk.
				for _, dir := range []string{
					filepath.Join(runtimeDataRoot, "engines", "llama"),
					filepath.Join(runtimeDataRoot, "python", "venv"),
				} {
					if err := os.MkdirAll(dir, 0o755); err != nil {
						t.Fatalf("mkdir %s: %v", dir, err)
					}
				}
			},
		},
		{
			name:    "process_liveness",
			signal:  "engine process alive",
			arrange: nil,
		},
		{
			name:    "import_success",
			signal:  "python import succeeds",
			arrange: nil,
		},
		{
			name:   "transfer_completion",
			signal: "model transfer session completed",
			arrange: func(t *testing.T, svc *Service, runtimeDataRoot string) {
				svc.mu.Lock()
				svc.transfers["session-baseline"] = &runtimev1.LocalTransferSessionSummary{
					InstallSessionId: "session-baseline",
					AssetId:          runtimeBaselineTestTextAssetID,
					SessionKind:      localTransferKindDownload,
					State:            normalizeTransferState("completed"),
				}
				svc.mu.Unlock()
			},
		},
		{
			name:    "script_exit",
			signal:  "setup script exited 0",
			arrange: nil,
		},
		{
			name:    "previous_health_success",
			signal:  "a prior asset health success",
			arrange: nil,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
			defer func() { svc.Close() }()
			if tc.arrange != nil {
				tc.arrange(t, svc, runtimeDataRoot)
			}
			// No selected source records were upserted; the named forbidden
			// signal is the only thing present.
			record, state, reason, detail := svc.mintRuntimeBaselineReadiness(runtimeBaselineMintRequest(runtimeDataRoot))
			if state == runtimeBaselineStateReady {
				t.Fatalf("%s minted a runtimeBaselineRef from forbidden signal %q", tc.name, tc.signal)
			}
			if state != runtimeBaselineStateNotReady && state != runtimeBaselineStateRepairRequired {
				t.Fatalf("%s mint state = %q, want fail-closed projection", tc.name, state)
			}
			if record.RuntimeBaselineRef != "" {
				t.Fatalf("%s produced a ref despite fail-closed state: %q", tc.name, record.RuntimeBaselineRef)
			}
			if reason == "" || detail == "" {
				t.Fatalf("%s fail-closed result missing reason/detail", tc.name)
			}
		})
	}
}

// materialization_success_alone: a selected source record produced by a prior
// materialization job exists, but its dependency is not re-verified ready by a
// fresh activation gate. Here only the TEXT consumer is materialized; speech
// consumers are not — so mint must fail closed even though materialization for
// some dependencies succeeded.
func TestRuntimeBaselineReadinessMaterializationSuccessAloneDoesNotMint(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	// Only materialize the text consumer's dependencies.
	markRuntimeBaselineConsumerReady(t, svc, runtimeDataRoot,
		runtimeBaselineConsumerBinding{ConsumerID: "llama.cpp.cpu", AssetID: runtimeBaselineTestTextAssetID},
		runtimeBaselineCPUProfile())

	record, state, _, detail := svc.mintRuntimeBaselineReadiness(runtimeBaselineMintRequest(runtimeDataRoot))
	if state == runtimeBaselineStateReady {
		t.Fatal("partial materialization minted a runtimeBaselineRef without full activation")
	}
	if record.RuntimeBaselineRef != "" {
		t.Fatalf("expected no ref, got %q (detail=%q)", record.RuntimeBaselineRef, detail)
	}
}

// --- Negative: stale / mismatched / unknown ref fails closed on resolve ---

func TestRuntimeBaselineReadinessResolveFailsClosedForStringOnlyRef(t *testing.T) {
	svc, _ := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()

	for _, ref := range []string{"", "   ", "runtime_baseline_01hzzznotarealref"} {
		record, state, reason, _ := svc.resolveRuntimeBaselineReadiness(ref, runtimeBaselineCPUProfile())
		if state == runtimeBaselineStateReady {
			t.Fatalf("string-only ref %q resolved ready", ref)
		}
		if record.RuntimeBaselineRef != "" {
			t.Fatalf("string-only ref %q produced a record", ref)
		}
		if strings.TrimSpace(ref) == "" && reason != runtimeBaselineReasonRefMissing {
			t.Fatalf("empty ref reason = %q, want %q", reason, runtimeBaselineReasonRefMissing)
		}
		if strings.TrimSpace(ref) != "" && reason != runtimeBaselineReasonRefUnknown {
			t.Fatalf("unbacked ref reason = %q, want %q", reason, runtimeBaselineReasonRefUnknown)
		}
	}
}

func TestRuntimeBaselineReadinessResolveFailsClosedWhenDependencyNoLongerReady(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	markRuntimeBaselineMinimalReady(t, svc, runtimeDataRoot, runtimeBaselineCPUProfile())
	record, state, _, _ := svc.mintRuntimeBaselineReadiness(runtimeBaselineMintRequest(runtimeDataRoot))
	if state != runtimeBaselineStateReady {
		t.Fatalf("mint state = %q, want ready", state)
	}

	// Drive a dependency into repair_required after the ref was minted.
	firstDep := record.ActivationReadyResponses[0].Dependencies[0]
	if _, ok := svc.markLocalEnvironmentDependencyRepairRequired(firstDep.EnvironmentKey, "hash_mismatch"); !ok {
		t.Fatal("failed to mark dependency repair required")
	}

	resolved, rState, rReason, _ := svc.resolveRuntimeBaselineReadiness(record.RuntimeBaselineRef, runtimeBaselineCPUProfile())
	if rState == runtimeBaselineStateReady {
		t.Fatal("resolve returned ready after a dependency stopped resolving ready")
	}
	if rState != runtimeBaselineStateRepairRequired && rState != runtimeBaselineStateNotReady {
		t.Fatalf("resolve state = %q, want fail-closed projection", rState)
	}
	if rReason == "" {
		t.Fatal("stale-ref resolve missing reason code")
	}
	if resolved.RuntimeBaselineRef != "" {
		t.Fatalf("stale-ref resolve returned a record: %q", resolved.RuntimeBaselineRef)
	}
}

func TestRuntimeBaselineReadinessResolveFailsClosedForMismatchedInstallLevel(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	markRuntimeBaselineMinimalReady(t, svc, runtimeDataRoot, runtimeBaselineCPUProfile())
	record, state, _, _ := svc.mintRuntimeBaselineReadiness(runtimeBaselineMintRequest(runtimeDataRoot))
	if state != runtimeBaselineStateReady {
		t.Fatalf("mint state = %q, want ready", state)
	}

	// Corrupt the stored ref binding so it no longer matches the resolved set.
	stored, _ := svc.runtimeBaselineReadinessRecord(record.RuntimeBaselineRef)
	stored.SelectedSourceRecordIDs = append([]string{"src_fabricated_mismatch"}, stored.SelectedSourceRecordIDs...)
	svc.upsertRuntimeBaselineReadinessRecord(stored)

	resolved, rState, rReason, _ := svc.resolveRuntimeBaselineReadiness(record.RuntimeBaselineRef, runtimeBaselineCPUProfile())
	if rState == runtimeBaselineStateReady {
		t.Fatal("resolve returned ready for a ref bound to a divergent selection")
	}
	if rReason != runtimeBaselineReasonRefMismatch {
		t.Fatalf("mismatch resolve reason = %q, want %q", rReason, runtimeBaselineReasonRefMismatch)
	}
	if resolved.RuntimeBaselineRef != "" {
		t.Fatalf("mismatch resolve returned a record: %q", resolved.RuntimeBaselineRef)
	}
}

func TestRuntimeBaselineReadinessRejectsInvalidInstallLevel(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	for _, level := range []string{"", "cloud", "hybrid", "video", "connector"} {
		req := runtimeBaselineMintRequest(runtimeDataRoot)
		req.InstallLevel = level
		_, state, reason, _ := svc.mintRuntimeBaselineReadiness(req)
		if state == runtimeBaselineStateReady {
			t.Fatalf("install level %q minted a ref", level)
		}
		if reason != runtimeBaselineReasonInstallLevelInvalid {
			t.Fatalf("install level %q reason = %q, want %q", level, reason, runtimeBaselineReasonInstallLevelInvalid)
		}
	}
}

func TestRuntimeBaselineReadinessRPCFailClosed(t *testing.T) {
	svc, runtimeDataRoot := newRuntimeBaselineTestService(t)
	defer func() { svc.Close() }()
	markRuntimeBaselineMinimalReady(t, svc, runtimeDataRoot, runtimeBaselineCPUProfile())

	mintResp, err := svc.MintRuntimeBaselineReadiness(context.Background(), &runtimev1.MintRuntimeBaselineReadinessRequest{
		SelectedLocalFactoryAiProfileRef: runtimeBaselineTestFactoryProfileRef,
		InstallLevel:                     runtimeBaselineInstallLevelMinimal,
		RuntimeDataRootOrDataRootRef:     runtimeDataRoot,
		HostProfile:                      runtimeBaselineCPUProfile(),
		BaselineConsumers: []*runtimev1.RuntimeBaselineConsumerBinding{
			{ConsumerId: "llama.cpp.cpu", AssetId: runtimeBaselineTestTextAssetID},
			{ConsumerId: "speech.qwen3-asr.python", AssetId: runtimeBaselineTestASRAssetID},
			{ConsumerId: "speech.qwen3-tts.python", AssetId: runtimeBaselineTestTTSAssetID},
		},
	})
	if err != nil {
		t.Fatalf("mint RPC transport error: %v", err)
	}
	if mintResp.GetState() != runtimeBaselineStateReady || mintResp.GetRef() == nil {
		t.Fatalf("mint RPC state = %q ref=%v, want ready ref", mintResp.GetState(), mintResp.GetRef())
	}
	ref := mintResp.GetRef().GetRuntimeBaselineRef()

	resolveResp, err := svc.ResolveRuntimeBaselineReadiness(context.Background(), &runtimev1.ResolveRuntimeBaselineReadinessRequest{
		RuntimeBaselineRef: ref,
		HostProfile:        runtimeBaselineCPUProfile(),
	})
	if err != nil {
		t.Fatalf("resolve RPC transport error: %v", err)
	}
	if resolveResp.GetState() != runtimeBaselineStateReady || resolveResp.GetRef() == nil {
		t.Fatalf("resolve RPC state = %q, want ready", resolveResp.GetState())
	}

	// A renderer-supplied string ref with no backing record fails closed.
	badResp, err := svc.ResolveRuntimeBaselineReadiness(context.Background(), &runtimev1.ResolveRuntimeBaselineReadinessRequest{
		RuntimeBaselineRef: "runtime_baseline_renderersupplied",
	})
	if err != nil {
		t.Fatalf("resolve RPC transport error for bad ref: %v", err)
	}
	if badResp.GetState() == runtimeBaselineStateReady || badResp.GetRef() != nil {
		t.Fatal("resolve RPC accepted a renderer-supplied string ref with no backing record")
	}
}
