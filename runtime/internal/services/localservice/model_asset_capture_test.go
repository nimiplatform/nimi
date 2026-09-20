package localservice

import (
	"context"
	"os"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

func TestModelAssetCaptureSurvivesRemovalThroughJobHandoff(t *testing.T) {
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	svc, asset := loadoutEmbeddingFixture(t)
	svc.OpenModelAssetReclamation()
	prepared := prepareEmbeddingLoadoutForTest(t, svc, context.Background(), "", "capture lifetime", asset)
	loadout := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	selected, err := svc.CaptureLocalExecution(capabilitydriver.TextEmbedCapabilityContract, loadout.GetLoadoutId())
	if err != nil {
		t.Fatal(err)
	}
	if selected.ModelAssetUse == nil {
		t.Fatal("capture returned paths without ownership")
	}
	removed, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId(), Force: true})
	if err != nil || !removed.GetCleanupPending() {
		t.Fatalf("captured removal = %+v err=%v", removed, err)
	}
	job, err := selected.ModelAssetUse.Retain()
	if err != nil {
		t.Fatal(err)
	}
	selected.ModelAssetUse.Release()
	path := selected.ExactBindings[0].AbsolutePath
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("handoff lost captured path: %v", err)
	}
	if use, err := svc.HoldCapturedLocalExecution(selected); err == nil {
		use.Release()
		t.Fatal("new admission accepted removed inventory")
	}
	if use := svc.AcquireModelAssetUse(asset.GetModelAssetId(), "late-job"); use != nil {
		use()
		t.Fatal("late publication acquired removed inventory")
	}
	job.Release()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("last executor exit did not clean path: %v", err)
	}
}
