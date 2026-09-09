package engine

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

// This opt-in test exercises the delivered Host and Worker against a profile
// and ModelAsset already installed by Runtime. It neither installs dependencies
// nor publishes a Job. Run without another active Locate Worker; API admission,
// semantic localization quality, and App consumption are separate acceptance.
func TestVisionExecutionHostInstalledModel(t *testing.T) {
	profileRoot, bundle, imagePath := os.Getenv("NIMI_LOCATE_TEST_PROFILE"), os.Getenv("NIMI_LOCATE_TEST_MODEL"), os.Getenv("NIMI_LOCATE_TEST_IMAGE")
	if profileRoot == "" || bundle == "" || imagePath == "" {
		t.Skip("requires an installed Runtime profile, ModelAsset bundle, and image")
	}
	manifest, err := ReadPythonDependencyProfileManifest(profileRoot)
	if err != nil {
		t.Fatal(err)
	}
	var asset struct {
		ModelAssetID string `json:"model_asset_id"`
		ContentID    string `json:"content_id"`
		Entry        string `json:"entry"`
		Files        []struct {
			Path   string `json:"relative_path"`
			SHA256 string `json:"sha256"`
		} `json:"files"`
	}
	raw, err := os.ReadFile(filepath.Join(bundle, "asset.manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &asset); err != nil {
		t.Fatal(err)
	}
	imageBytes, err := os.ReadFile(imagePath)
	if err != nil {
		t.Fatal(err)
	}
	width, height, err := localexecution.VisionLocateImageSize(imageBytes)
	if err != nil {
		t.Fatal(err)
	}
	binding := capabilitydriver.InvocationExactBinding{RequirementID: capabilitydriver.LocateAnythingModelSlot, ModelAssetID: asset.ModelAssetID, BundleDir: filepath.Clean(bundle), AbsolutePath: filepath.Join(bundle, asset.Entry), VerifiedContentID: asset.ContentID}
	for _, file := range asset.Files {
		binding.DeclaredFiles = append(binding.DeclaredFiles, file.Path)
		if file.Path == asset.Entry {
			binding.EntrySHA256 = strings.TrimPrefix(file.SHA256, "sha256:")
		}
	}
	environments := filepath.Dir(filepath.Dir(profileRoot))
	manager, err := NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), ManagedRoots{Environments: environments, Dependencies: filepath.Join(filepath.Dir(environments), "dependencies")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	host := NewVisionExecutionHost(manager)
	t.Cleanup(func() {
		if err := host.stop(); err != nil {
			t.Error(err)
		}
	})
	backend, err := visionPythonBackend(manifest.Identity.PlatformTuple, manifest.Identity.AcceleratorPlane)
	if err != nil {
		t.Fatal(err)
	}
	query := os.Getenv("NIMI_LOCATE_TEST_QUERY")
	if query == "" {
		t.Fatal("NIMI_LOCATE_TEST_QUERY must name a visible target")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	var previousPID int
	for _, geometry := range []runtimev1.VisionLocateGeometry{runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_BOX, runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_POINT} {
		plan := &capabilitydriver.VisionLocateInvocationPlan{Backend: backend, ProfileRoot: profileRoot, ProfileDigest: manifest.Identity.ProfileDigest, DriverBundleDigest: manifest.Identity.DriverBundleDigest, DriverProtocol: manifest.Identity.DriverProtocol, Request: &runtimev1.VisionLocateScenarioSpec{ImageArtifactId: "locate-verification-image", Query: query, Geometry: geometry}, ImageBytes: imageBytes, Width: width, Height: height, Binding: binding}
		started := time.Now()
		result, err := host.ExecuteVisionLocate(ctx, plan, nil)
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Locations) == 0 {
			t.Fatal("visible-target verification produced no match")
		}
		info, err := manager.EngineStatus(engineVisionExecutionHost)
		if err != nil {
			t.Fatal(err)
		}
		if previousPID != 0 && previousPID != info.PID {
			t.Fatal("same model and profile did not reuse its resident Worker")
		}
		previousPID = info.PID
		encoded, _ := json.Marshal(result)
		t.Logf("%s elapsed=%s pid=%d result=%s", geometry, time.Since(started), info.PID, encoded)
	}
}
