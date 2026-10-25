package localservice

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

func TestDemucsSmallPrefixKeepsCompleteAdmission(t *testing.T) {
	for _, damage := range []string{"same-size-content", "declared-size", "undeclared-file"} {
		t.Run(damage, func(t *testing.T) {
			svc := newLoadoutTestService(t, t.TempDir())
			content := make([]byte, 8192)
			copy(content, []byte{'P', 'K', 3, 4})
			asset := importModelAssetBytesForLoadoutTest(t, svc, "demucs.th", content)
			prepared, err := svc.PrepareLoadout(context.Background(), &runtimev1.PrepareLoadoutRequest{
				CapabilityContract: capabilitydriver.AudioSeparateContract, RecipeId: capabilitydriver.DemucsRecipeID, DisplayName: "Demucs prefix integrity",
				ModelAxes: []*runtimev1.LoadoutModelAxisInput{{SlotId: capabilitydriver.DemucsModelRequirementID, ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId()}},
			})
			if err != nil {
				t.Fatal(err)
			}
			row := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
			driver, requirements, err := svc.projectStoredLoadout(row)
			if err != nil || len(requirements) != 1 {
				t.Fatalf("contract: %v/%v", requirements, err)
			}
			admit := func() (resolvedLoadoutAxis, runtimev1.ReasonCode, error) {
				return svc.resolveLoadoutModelAxisForAdmission(context.Background(), admissionPass{}, row, driver, requirements[0], row.GetModelAxes()[0])
			}
			baseline, reason, err := admit()
			if err != nil || reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
				t.Fatalf("baseline: %v/%v", reason, err)
			}
			svc.releaseAdmissionHolds()
			path := baseline.absolutePath
			info, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			switch damage {
			case "same-size-content":
				content[len(content)-1] = 1
				if err := os.WriteFile(path, content, info.Mode()); err != nil {
					t.Fatal(err)
				}
				if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
					t.Fatal(err)
				}
			case "declared-size":
				if err := os.WriteFile(path, content[:4], info.Mode()); err != nil {
					t.Fatal(err)
				}
			case "undeclared-file":
				if err := os.WriteFile(filepath.Join(baseline.bundleDir, "extra.bin"), []byte("extra"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, reason, err := admit(); err != nil || reason != runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH {
				t.Fatalf("admitted %s: %v/%v", damage, reason, err)
			}
		})
	}
}
