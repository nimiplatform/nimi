package capabilitydriver

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// This validates real file facts against the product Model Contract. A model
// accepted by the upstream Python library alone is not Nimi model admission.
func TestVoxCPMRealModelContract(t *testing.T) {
	accepted := os.Getenv("NIMI_VOXCPM_MODEL_TEST_ROOT")
	if accepted == "" {
		t.Skip("explicit real VoxCPM2 model bundle was not supplied")
	}
	for _, tc := range []struct {
		name, root string
		admitted   bool
	}{
		{"admitted", accepted, true},
		{"other architecture", os.Getenv("NIMI_VOXCPM_REJECTED_MODEL_TEST_ROOT"), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.root == "" {
				t.Skip("explicit incompatible model bundle was not supplied")
			}
			var files []ModelAssetFileFact
			var entry ModelAssetFileFact
			var entryDigest string
			content := sha256.New()
			err := filepath.WalkDir(tc.root, func(path string, item fs.DirEntry, walkErr error) error {
				if walkErr != nil {
					return walkErr
				}
				if item.IsDir() {
					return nil
				}
				file, err := os.Open(path)
				if err != nil {
					return err
				}
				defer func() { _ = file.Close() }()
				digest := sha256.New()
				size, err := io.Copy(digest, file)
				if err != nil {
					return err
				}
				_, _ = content.Write(digest.Sum(nil))
				if _, err := file.Seek(0, io.SeekStart); err != nil {
					return err
				}
				probe, err := io.ReadAll(io.LimitReader(file, MaxAssetFormatProbeBytes))
				if err != nil {
					return err
				}
				relative, err := filepath.Rel(tc.root, path)
				if err != nil {
					return err
				}
				fact := ModelAssetFileFact{RelativePath: filepath.ToSlash(relative), SizeBytes: size, FormatProbe: probe}
				files = append(files, fact)
				if fact.RelativePath == "model.safetensors" {
					entry, entryDigest = fact, hex.EncodeToString(digest.Sum(nil))
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			driver := VoxCPMDriver{}
			requirements, reason := driver.ProjectRecipe(VoxCPMRecipeID, nil, nil)
			if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
				t.Fatal(reason)
			}
			_, reason = driver.ProjectModelAssetBinding(ModelAssetBindingInput{
				RecipeID: VoxCPMRecipeID, Requirement: requirements[0], Entry: entry, Files: files,
				Binding: &runtimev1.ModelAssetExactBinding{RequirementId: VoxCPMModelRequirementID,
					ModelAssetId: "real-model-contract-test", VerifiedContentId: "sha256:" + hex.EncodeToString(content.Sum(nil)), EntrySha256: entryDigest},
			})
			if (reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED) != tc.admitted {
				t.Fatalf("real model admission = %s, want admitted=%t", reason, tc.admitted)
			}
		})
	}
}
