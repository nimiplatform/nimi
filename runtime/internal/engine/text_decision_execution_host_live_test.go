package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

// This opt-in test materializes the exact Laya dependency profile into an
// isolated managed root that already contains the pinned uv tool and Python
// runtime (NIMI_LAYA_TEST_SCRATCH_ROOT/{environments,dependencies}). It never
// touches the Runtime data root and downloads packages into its own cache.
func TestTextDecisionProfileMaterializesInIsolatedRoot(t *testing.T) {
	root := os.Getenv("NIMI_LAYA_TEST_SCRATCH_ROOT")
	if root == "" {
		t.Skip("requires NIMI_LAYA_TEST_SCRATCH_ROOT with the pinned uv tool and Python runtime")
	}
	plane := os.Getenv("NIMI_LAYA_TEST_PLANE")
	if plane == "" {
		plane = "cuda"
	}
	roots := ManagedRoots{Environments: filepath.Join(root, "environments"), Dependencies: filepath.Join(root, "dependencies")}
	manager, err := NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	python, found, err := discoverManagedPythonRuntime(engineVersionDir(roots.Environments, EngineKind("python"), ManagedPythonVersion), ManagedPythonVersion)
	if err != nil || !found {
		t.Fatalf("pinned Python runtime: %v %v", found, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	status, err := manager.EnsurePythonDependencyProfile(ctx, managedUVPath(filepath.Join(roots.Dependencies, "uv")), python, TextDecisionConsumerID, currentGOOS()+"/"+currentGOARCH(), plane)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("profile_root=%s digest=%s torch=%s cuda=%s probes=%v", status.ProfileRoot, status.Identity.ProfileDigest, status.ObservedTorchVersion, status.ObservedCUDAABI, status.ImportProbes)
	again, err := manager.EnsurePythonDependencyProfile(ctx, managedUVPath(filepath.Join(roots.Dependencies, "uv")), python, TextDecisionConsumerID, currentGOOS()+"/"+currentGOARCH(), plane)
	if err != nil || !again.Reused || again.ProfileRoot != status.ProfileRoot {
		t.Fatalf("promoted profile was not reused: %+v %v", again, err)
	}
}

// This opt-in test runs the delivered Host and Worker against a promoted
// profile (NIMI_LAYA_TEST_PROFILE) and one checkpoint directory whose files are
// exactly the Laya checkpoint (NIMI_LAYA_TEST_CHECKPOINT). It neither installs
// dependencies nor publishes a Job; App admission and Loadout capture are
// separate acceptance.
func TestTextDecisionExecutionHostInstalledCheckpoint(t *testing.T) {
	profileRoot, checkpoint := os.Getenv("NIMI_LAYA_TEST_PROFILE"), os.Getenv("NIMI_LAYA_TEST_CHECKPOINT")
	if profileRoot == "" || checkpoint == "" {
		t.Skip("requires NIMI_LAYA_TEST_PROFILE and NIMI_LAYA_TEST_CHECKPOINT")
	}
	manifest, err := ReadPythonDependencyProfileManifest(profileRoot)
	if err != nil {
		t.Fatal(err)
	}
	checkpoint = filepath.Clean(checkpoint)
	declared := []string{"encoder/config.json", "model.safetensors", "rl_agent_config.json", "tokenizer/tokenizer.json", "tokenizer/tokenizer_config.json"}
	sort.Strings(declared)
	hasher := sha256.New()
	binding := capabilitydriver.InvocationExactBinding{
		RequirementID: capabilitydriver.LayaModelSlot, ModelAssetID: "live-laya", BundleDir: checkpoint,
		AbsolutePath: filepath.Join(checkpoint, "model.safetensors"), DeclaredFiles: declared,
	}
	for _, relative := range declared {
		content, err := os.Open(filepath.Join(checkpoint, filepath.FromSlash(relative)))
		if err != nil {
			t.Fatal(err)
		}
		fileHash := sha256.New()
		_, err = io.Copy(fileHash, content)
		_ = content.Close()
		if err != nil {
			t.Fatal(err)
		}
		sum := fileHash.Sum(nil)
		hasher.Write(sum)
		if relative == "model.safetensors" {
			binding.EntrySHA256 = hex.EncodeToString(sum)
		}
	}
	binding.VerifiedContentID = "sha256:" + hex.EncodeToString(hasher.Sum(nil))
	environments := filepath.Dir(filepath.Dir(profileRoot))
	manager, err := NewManager(slog.New(slog.NewTextHandler(os.Stderr, nil)), ManagedRoots{Environments: environments, Dependencies: filepath.Join(filepath.Dir(environments), "dependencies")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	host := NewTextDecisionExecutionHost(manager)
	t.Cleanup(func() {
		if err := host.stopWorker(); err != nil {
			t.Error(err)
		}
	})
	spec := &runtimev1.TextDecideScenarioSpec{
		State: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Json{Json: `{"request":"latest rust async runtime news","now":"2026-09-24"}`}},
		Questions: []*runtimev1.TextDecisionQuestion{
			{Id: "window", Instructions: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: "Which time window does the request ask for?"}},
				Kind: &runtimev1.TextDecisionQuestion_Choice{Choice: &runtimev1.TextDecisionChoice{Candidates: []*runtimev1.TextDecisionCandidate{
					{Id: "any", Description: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: "any time"}}},
					{Id: "day", Description: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: "past day"}}},
					{Id: "week", Description: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: "past week"}}},
					{Id: "month"},
				}}}},
			{Id: "news", Instructions: &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: "Is the user asking for news?"}},
				Kind: &runtimev1.TextDecisionQuestion_Boolean{Boolean: &runtimev1.TextDecisionBoolean{}}},
		},
	}
	plan := &capabilitydriver.TextDecisionInvocationPlan{
		Request: spec, Binding: binding, ModelDir: checkpoint, ProfileRoot: filepath.Clean(profileRoot),
		ProfileDigest: manifest.Identity.ProfileDigest, DriverBundleDigest: manifest.Identity.DriverBundleDigest, DriverProtocol: capabilitydriver.LayaProtocol,
	}
	// A deadline that expires during the cold checkpoint load stops the Worker
	// and publishes no result; the next call starts a fresh Worker.
	shortCtx, cancelShort := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	_, err = host.ExecuteTextDecision(shortCtx, plan)
	cancelShort()
	if kind := localexecution.FailureKindOf(err); kind != localexecution.FailureTimeout {
		t.Fatalf("cold-load deadline: kind=%q err=%v", kind, err)
	}
	for call := 0; call < 2; call++ {
		started := time.Now()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		result, err := host.ExecuteTextDecision(ctx, plan)
		cancel()
		if err != nil {
			t.Fatalf("call %d: %v", call, err)
		}
		t.Logf("call %d device=%s elapsed=%s tokens=%d compute_ms=%d answers=%v", call, manifest.Identity.AcceleratorPlane, time.Since(started), result.InputTokens, result.ComputeMS, result.Result)
	}
	limit := &capabilitydriver.TextDecisionInvocationPlan{}
	*limit = *plan
	limit.Request = &runtimev1.TextDecideScenarioSpec{
		State:     &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: strings.Repeat("word ", 9000)}},
		Questions: spec.Questions[1:],
	}
	_, err = host.ExecuteTextDecision(context.Background(), limit)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_INPUT_LIMIT_EXCEEDED {
		t.Fatalf("encoder limit: %v", err)
	}
	t.Logf("limit: %v", err)
	if _, err := host.ExecuteTextDecision(context.Background(), plan); err != nil {
		t.Fatalf("the Worker did not stay resident after a typed input rejection: %v", err)
	}
}
