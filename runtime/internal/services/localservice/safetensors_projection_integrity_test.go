package localservice

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestQwen3StructuredProbeStillVerifiesUnusedCompanionsAtAdmission(t *testing.T) {
	for _, damage := range []string{"same-size-content", "declared-size", "undeclared-file"} {
		t.Run(damage, func(t *testing.T) {
			setLocalRuntimePlatformForTest(t, "darwin", "arm64")
			svc := newLoadoutTestService(t, t.TempDir())
			asset := importSpeechModelAssetForLoadoutTest(t, svc, "tts")
			prepared, err := svc.PrepareLoadout(context.Background(), &runtimev1.PrepareLoadoutRequest{
				CapabilityContract: capabilitydriver.AudioSynthesizeContract, RecipeId: capabilitydriver.Qwen3TTSCustomVoiceRecipeID,
				Options: &structpb.Struct{}, DisplayName: "Qwen3 companion integrity",
				ModelAxes: []*runtimev1.LoadoutModelAxisInput{{SlotId: capabilitydriver.Qwen3TTSModelRequirementID, ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId()}},
			})
			if err != nil {
				t.Fatal(err)
			}
			committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
			resolved, err := svc.ResolveLocalExecution(capabilitydriver.AudioSynthesizeContract, committed.GetLoadoutId())
			if err != nil || !resolved.Configured || len(resolved.ExactBindings) != 1 || len(resolved.ExactBindings[0].DeclaredFiles) != len(asset.GetFiles()) {
				t.Fatalf("baseline admission = %+v, %v", resolved, err)
			}
			// End the previous admission's continuous file holds before changing
			// the fixture. A new admission must then verify every payload anew.
			svc.releaseAdmissionHolds()
			root := resolved.ExactBindings[0].BundleDir
			companion := filepath.Join(root, "config.json")
			info, err := os.Stat(companion)
			if err != nil {
				t.Fatal(err)
			}
			switch damage {
			case "same-size-content":
				content, err := os.ReadFile(companion)
				if err != nil {
					t.Fatal(err)
				}
				changed := bytes.Replace(content, []byte("tts"), []byte("bad"), 1)
				if bytes.Equal(content, changed) || len(content) != len(changed) {
					t.Fatal("fixture mutation did not preserve size")
				}
				if err := os.WriteFile(companion, changed, 0o600); err != nil {
					t.Fatal(err)
				}
				if err := os.Chtimes(companion, info.ModTime(), info.ModTime()); err != nil {
					t.Fatal(err)
				}
			case "declared-size":
				if err := os.WriteFile(companion, []byte(`{}`), 0o600); err != nil {
					t.Fatal(err)
				}
				projection, err := svc.GetLoadout(context.Background(), &runtimev1.GetLoadoutRequest{LoadoutId: committed.GetLoadoutId()})
				if err != nil || projection.GetLoadout().GetValidationState() == runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
					t.Fatalf("projection ignored changed companion size: %+v, %v", projection, err)
				}
			case "undeclared-file":
				if err := os.WriteFile(filepath.Join(root, "untracked.json"), []byte(`{}`), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := svc.ResolveLocalExecution(capabilitydriver.AudioSynthesizeContract, committed.GetLoadoutId()); grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH {
				t.Fatalf("admission accepted %s after unused-prefix removal: %v", damage, err)
			}
		})
	}
}
