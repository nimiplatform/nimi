package localservice

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestVoxCPMStructuredProbeKeepsUnusedCompanionAdmissionIntegrity(t *testing.T) {
	for _, damage := range []string{"same-size-content", "declared-size", "undeclared-file"} {
		t.Run(damage, func(t *testing.T) {
			setLocalRuntimePlatformForTest(t, "darwin", "arm64")
			svc := newLoadoutTestService(t, t.TempDir())
			asset := importVoxCPMModelAssetForLoadoutTest(t, svc, "voxcpm2", safetensorsLoadoutTestBytes(map[string][]int64{"model.embed_tokens.weight": {32000, 2048}}), "audiovae.pth", "tokenization_voxcpm2.py")
			prepared := prepareVoxCPMLoadoutForTest(t, svc, "VoxCPM prefix integrity", asset)
			committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
			driver, requirements, err := svc.projectStoredLoadout(committed)
			if err != nil || len(requirements) != 1 {
				t.Fatalf("driver projection: %v, %v", requirements, err)
			}
			admit := func() (resolvedLoadoutAxis, runtimev1.ReasonCode, error) {
				return svc.resolveLoadoutModelAxisForAdmission(context.Background(), admissionPass{}, committed, driver, requirements[0], committed.GetModelAxes()[0])
			}
			baseline, reason, err := admit()
			if err != nil || reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || len(baseline.declaredFiles) != len(asset.GetFiles()) {
				t.Fatalf("baseline axis admission: %v, %v", reason, err)
			}
			svc.releaseAdmissionHolds()
			path := filepath.Join(baseline.bundleDir, "tokenizer.json")
			info, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			switch damage {
			case "same-size-content":
				content, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				changed := bytes.Replace(content, []byte("1.0"), []byte("2.0"), 1)
				if bytes.Equal(content, changed) || len(content) != len(changed) {
					t.Fatal("fixture mutation must preserve size")
				}
				if err := os.WriteFile(path, changed, 0o600); err != nil {
					t.Fatal(err)
				}
				if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
					t.Fatal(err)
				}
			case "declared-size":
				if err := os.WriteFile(path, []byte(`{}`), 0o600); err != nil {
					t.Fatal(err)
				}
				projection, err := svc.GetLoadout(context.Background(), &runtimev1.GetLoadoutRequest{LoadoutId: committed.GetLoadoutId()})
				if err != nil || projection.GetLoadout().GetValidationState() == runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
					t.Fatalf("projection missed changed companion size: %+v, %v", projection, err)
				}
			case "undeclared-file":
				if err := os.WriteFile(filepath.Join(baseline.bundleDir, "undeclared.json"), []byte(`{}`), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if _, reason, err := admit(); err != nil || reason != runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH {
				t.Fatalf("axis admission accepted %s: %v, %v", damage, reason, err)
			}
		})
	}
}
