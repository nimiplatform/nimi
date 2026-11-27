//go:build windows

package engine

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

func TestLlamaLoadVerificationWindowsNTFSHotHitSkipsRehashWhileDependencyCheckRuns(t *testing.T) {
	server := newTestLlamaChatAndEmbedServer(t)
	// Nil warmSkipPathEligible exercises the REAL Win32 NTFS + direct-chain checker!
	host, mgr, _, modelChecks := newTrackedExecutionHostForTest(t, server, nil)

	plan := llamaTextPlanWithDependenciesForTest(t, "win-ntfs-hot", false)
	if !windowsLocalNTFSModelFilesEligible(plan.ModelFiles()) {
		t.Skipf("test temp dir %q is not on a fixed local NTFS volume", plan.ModelFiles()[0].AbsolutePath)
	}

	var progress []localexecution.TextExecutionProgress
	recordProgress := func(stage localexecution.TextExecutionProgress) {
		progress = append(progress, stage)
	}

	// Cold load: hashes complete model file set once and runs dependency check.
	if res, err := host.ExecuteText(context.Background(), plan, recordProgress); err != nil || res.Text != "ok" {
		t.Fatalf("cold load = (%+v, %v)", res, err)
	}
	if got := modelChecks.Load(); got != 1 {
		t.Fatalf("cold load modelChecks = %d, want 1", got)
	}
	if starts, _, deps := mgr.snapshotCounts(); starts != 1 || deps != 1 {
		t.Fatalf("cold load starts=%d deps=%d, want 1, 1", starts, deps)
	}

	// Warm hit 1 (non-stream): 0 re-hash reads, dependency check STILL runs!
	if res, err := host.ExecuteText(context.Background(), plan, recordProgress); err != nil || res.Text != "ok" {
		t.Fatalf("warm hit 1 = (%+v, %v)", res, err)
	}
	if got := modelChecks.Load(); got != 1 {
		t.Fatalf("warm hit 1 modelChecks = %d, want 1 (0 re-hash reads)", got)
	}
	if starts, _, deps := mgr.snapshotCounts(); starts != 1 || deps != 2 {
		t.Fatalf("warm hit 1 starts=%d deps=%d, want 1, 2", starts, deps)
	}

	// Warm hit 2 (streaming, exact same captured model files & processKey): 0 re-hash reads, dependency check STILL runs!
	streamPlan, err := (capabilitydriver.LlamaTextDriver{}).PlanTextInvocation(capabilitydriver.TextInvocationInput{
		ModelContextWindowTokens: 32768,
		ExactBindings:            plan.ModelFiles(),
		ExactDependencySources:   llamaDependencySourcesForTest(),
		BehaviorMatch: capabilitydriver.TextBehaviorAdapterMatchFacts{
			RecipeID:          capabilitydriver.LlamaGenericGGUFRecipeID,
			RecipeRevision:    "test-revision",
			DriverDialect:     capabilitydriver.LlamaDriverDialect,
			ModelAssetID:      plan.ModelFiles()[0].ModelAssetID,
			VerifiedContentID: plan.ModelFiles()[0].VerifiedContentID,
			EntrySHA256:       plan.ModelFiles()[0].EntrySHA256,
		},
		Request: &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "second turn"}}},
		Stream:  true,
	})
	if err != nil {
		t.Fatalf("PlanTextInvocation stream: %v", err)
	}
	var streamed string
	if res, err := host.StreamText(context.Background(), streamPlan, func(delta localexecution.TextDelta) error {
		streamed += delta.Text
		return nil
	}, recordProgress); err != nil || res.Text != "ok" || streamed != "ok" {
		t.Fatalf("warm stream hit = (%+v, streamed=%q, err=%v)", res, streamed, err)
	}
	if got := modelChecks.Load(); got != 1 {
		t.Fatalf("warm stream hit modelChecks = %d, want 1 (0 re-hash reads)", got)
	}
	if starts, _, deps := mgr.snapshotCounts(); starts != 1 || deps != 3 {
		t.Fatalf("warm stream hit starts=%d deps=%d, want 1, 3", starts, deps)
	}
	wantProgress := []localexecution.TextExecutionProgress{
		localexecution.TextExecutionProgressLoading,
		localexecution.TextExecutionProgressReady,
		localexecution.TextExecutionProgressReused,
		localexecution.TextExecutionProgressReused,
	}
	if fmt.Sprint(progress) != fmt.Sprint(wantProgress) {
		t.Fatalf("progress = %v, want %v", progress, wantProgress)
	}
}

func TestLlamaLoadVerificationWindowsNTFSBundleHotHitAndReparsePointFallback(t *testing.T) {
	// Multi-file bundle on local NTFS is eligible for warm skip.
	bundleBinding := speechBindingFixture(t, "model.gguf", map[string][]byte{
		"model.gguf":     []byte("bundle-main-bytes"),
		"tokenizer.json": []byte("bundle-tokenizer-bytes"),
	})
	if !windowsLocalNTFSModelFilesEligible([]capabilitydriver.InvocationExactBinding{bundleBinding}) {
		t.Skipf("test temp dir %q is not on a fixed local NTFS volume", bundleBinding.BundleDir)
	}

	// UNC / network paths must NEVER be eligible.
	uncBinding := bundleBinding
	uncBinding.BundleDir = ""
	uncBinding.DeclaredFiles = nil
	uncBinding.AbsolutePath = `\\localhost\share\model.gguf`
	if windowsLocalNTFSModelFilesEligible([]capabilitydriver.InvocationExactBinding{uncBinding}) {
		t.Fatal("UNC network path was erroneously marked eligible for warm skip")
	}

	// A real Windows NTFS directory junction (reparse point) along the ancestor
	// chain must NEVER be eligible and must retain full re-verification!
	root := t.TempDir()
	realDir := filepath.Join(root, "real-models")
	if err := os.MkdirAll(realDir, 0o700); err != nil {
		t.Fatal(err)
	}
	modelBytes := []byte("junction-model-bytes")
	digest := sha256.Sum256(modelBytes)
	digestHex := fmt.Sprintf("%x", digest[:])
	realFile := filepath.Join(realDir, "model.gguf")
	if err := os.WriteFile(realFile, modelBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	junctionDir := filepath.Join(root, "junction-models")
	cmd := exec.Command("cmd", "/c", "mklink", "/J", junctionDir, realDir)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("mklink /J unavailable: %v (%s)", err, string(out))
	}
	t.Cleanup(func() {
		_ = os.Remove(junctionDir)
	})

	junctionModelPath := filepath.Join(junctionDir, "model.gguf")
	junctionPlan, err := (capabilitydriver.LlamaTextDriver{}).PlanTextInvocation(capabilitydriver.TextInvocationInput{
		ModelContextWindowTokens: 32768,
		ExactBindings: []capabilitydriver.InvocationExactBinding{{
			EmbeddingInputProtocol: capabilitydriver.EmbeddingInputNativeV1,
			RequirementID:          capabilitydriver.MainGGUFRequirementID,
			ModelAssetID:           "asset-junction",
			AbsolutePath:           junctionModelPath,
			VerifiedContentID:      "sha256:" + digestHex,
			EntrySHA256:            digestHex,
		}},
		ExactDependencySources: llamaDependencySourcesForTest(),
		BehaviorMatch: capabilitydriver.TextBehaviorAdapterMatchFacts{
			RecipeID:          capabilitydriver.LlamaGenericGGUFRecipeID,
			RecipeRevision:    "test-revision",
			DriverDialect:     capabilitydriver.LlamaDriverDialect,
			ModelAssetID:      "asset-junction",
			VerifiedContentID: "sha256:" + digestHex,
			EntrySHA256:       digestHex,
		},
		Request: &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}}},
	})
	if err != nil {
		t.Fatalf("PlanTextInvocation junction: %v", err)
	}
	if windowsLocalNTFSModelFilesEligible(junctionPlan.ModelFiles()) {
		t.Fatalf("NTFS junction path %q was erroneously marked eligible for warm skip", junctionModelPath)
	}

	server := newTestLlamaChatAndEmbedServer(t)
	mgr := newTrackedLlamaExecutionManager(server.URL)
	substrate := newManagerLlamaInvocationSubstrate(nil)
	substrate.manager = mgr
	var modelChecks atomic.Int32
	host := newExecutionHostWithSubstrate(substrate, server.Client())
	host.idle.after = time.Hour
	host.modelContentValidator = func(ctx context.Context, files []capabilitydriver.InvocationExactBinding) error {
		modelChecks.Add(1)
		return validateInvocationModelContentContext(ctx, files)
	}

	for turn := 1; turn <= 2; turn++ {
		if _, err := host.ExecuteText(context.Background(), junctionPlan, nil); err != nil {
			t.Fatalf("junction turn %d: %v", turn, err)
		}
	}
	if got := modelChecks.Load(); got != 2 {
		t.Fatalf("junction path modelChecks = %d, want 2 (reparse point must retain full re-verification)", got)
	}
}
