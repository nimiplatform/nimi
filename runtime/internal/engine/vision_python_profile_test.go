package engine

import (
	"strings"
	"testing"
)

func TestLocateProfilesBindExactPlatformAndLoaderSupply(t *testing.T) {
	var digests []string
	for _, test := range []struct{ platform, plane, source, loader string }{
		{"windows/amd64", "cuda", "vision-locateanything-transformers-cu128", "locateanything_loader.modeling_locateanything"},
		{"darwin/arm64", "cpu", "vision-locateanything-mlx-cpu", "mlx_vlm"},
	} {
		t.Run(test.platform, func(t *testing.T) {
			identity, err := ResolvePythonDependencyProfileIdentity(VisionLocateConsumerID, test.platform, test.plane)
			if err != nil {
				t.Fatal(err)
			}
			if identity.SourceLabel != test.source || identity.DriverProtocol != visionDriverProtocolVersion {
				t.Fatalf("incorrect Locate profile: %+v", identity)
			}
			for _, digest := range digests {
				if digest == identity.ProfileDigest {
					t.Fatal("different platform loader supplies share a profile")
				}
			}
			digests = append(digests, identity.ProfileDigest)
			probes, err := pythonDependencyProfileImportProbes(VisionLocateConsumerID, identity)
			if err != nil || !strings.Contains(strings.Join(probes, ","), test.loader) {
				t.Fatalf("Locate loader is not verified: probes=%v err=%v", probes, err)
			}
			root := t.TempDir()
			if err := materializeVisionDriverBundle(root); err != nil {
				t.Fatal(err)
			}
			if err := verifyVisionDriverBundle(root); err != nil {
				t.Fatal(err)
			}
		})
	}
	for _, test := range []struct{ platform, plane string }{
		{"windows/amd64", "cpu"}, {"windows/arm64", "cuda"},
		{"darwin/amd64", "cpu"}, {"linux/amd64", "cuda"},
	} {
		if _, err := ResolvePythonDependencyProfileIdentity(VisionLocateConsumerID, test.platform, test.plane); err == nil {
			t.Fatalf("unsupported Locate tuple admitted: %+v", test)
		}
	}
}
