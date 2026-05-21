package appinstallgateway

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/appreleasecatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
)

func bundledDescriptor(appID string) appreleasecatalog.Descriptor {
	return appreleasecatalog.Descriptor{
		DescriptorID:    appID + ".bundled-with-nimi",
		AppID:           appID,
		Version:         "bundled-with-current-nimi-release",
		DescriptorClass: appreleasecatalog.DescriptorClassBundledWithNimi,
		Source: appreleasecatalog.Source{
			Kind: appreleasecatalog.SourceKindNimiBundle,
			Ref:  "current-atomic-nimi-release",
		},
		Artifact: appreleasecatalog.Artifact{
			Locator:                  "current-nimi-release-bundle",
			DigestAlgorithm:          "sha256",
			SHA256:                   "inherited-from-atomic-nimi-release-manifest",
			Size:                     "inherited-from-atomic-nimi-release-manifest",
			SignatureOrProvenanceRef: "nimi-first-party-signature-policy",
		},
		Runtime: appreleasecatalog.Runtime{
			PackageKind: "nimi-app",
			EntryRef:    appID + "-runtime-registration",
			SandboxRef:  "first-party-bundled-app",
		},
		PermissionsRef:   appID + ".permission_scope_ref",
		StoragePolicyRef: "nimi-data-app-roots",
		Review: appreleasecatalog.Review{
			AdmissionPath:                     "first-party-bundled-release",
			MutableSourceAllowed:              false,
			InstallDigestVerificationRequired: "inherited_from_atomic_bundle",
		},
		SourceRule: "P-NAPP-014",
	}
}

func writeBundledArtifact(t *testing.T, root string, appID string, files map[string]string) {
	t.Helper()
	appDir := filepath.Join(root, appID)
	for rel, content := range files {
		target := filepath.Join(appDir, rel)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			t.Fatalf("mkdir bundled artifact: %v", err)
		}
		if err := os.WriteFile(target, []byte(content), 0o644); err != nil {
			t.Fatalf("write bundled artifact file: %v", err)
		}
	}
}

func TestBundledArtifactSourceResolveAndMaterialize(t *testing.T) {
	bundledRoot := t.TempDir()
	writeBundledArtifact(t, bundledRoot, "nimi.parentos", map[string]string{
		"manifest.json": `{"name":"parentos"}`,
		"bin/run.js":    "console.log('parentos')",
	})
	source, err := NewBundledArtifactSource(bundledRoot)
	if err != nil {
		t.Fatalf("NewBundledArtifactSource: %v", err)
	}
	descriptor := bundledDescriptor("nimi.parentos")
	artifact, err := source.Resolve(context.Background(), descriptor)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if artifact.SHA256 == "" {
		t.Fatal("expected a deterministic tree digest")
	}
	if artifact.Payload != nil {
		t.Fatal("bundled artifact must not carry a byte payload")
	}

	plan, err := appstorage.Resolve(t.TempDir(), descriptor.AppID, descriptor.Version, descriptor.StoragePolicyRef)
	if err != nil {
		t.Fatalf("resolve plan: %v", err)
	}
	if err := appstorage.Materialize(plan); err != nil {
		t.Fatalf("materialize plan: %v", err)
	}
	if err := source.MaterializeInto(context.Background(), descriptor, plan); err != nil {
		t.Fatalf("MaterializeInto: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(plan.ReleaseRoot, "bin", "run.js"))
	if err != nil {
		t.Fatalf("read materialized file: %v", err)
	}
	if string(got) != "console.log('parentos')" {
		t.Fatalf("materialized content = %q", got)
	}
}

func TestBundledArtifactSourceRejectsExternalDescriptor(t *testing.T) {
	source, err := NewBundledArtifactSource(t.TempDir())
	if err != nil {
		t.Fatalf("NewBundledArtifactSource: %v", err)
	}
	descriptor := bundledDescriptor("nimi.parentos")
	descriptor.DescriptorClass = appreleasecatalog.DescriptorClassExternalImmutableArtifact
	_, err = source.Resolve(context.Background(), descriptor)
	if !errors.Is(err, ErrExternalDescriptorNotBundled) {
		t.Fatalf("error = %v, want ErrExternalDescriptorNotBundled", err)
	}
}

func TestBundledArtifactSourceMissingArtifactFailsClosed(t *testing.T) {
	source, err := NewBundledArtifactSource(t.TempDir())
	if err != nil {
		t.Fatalf("NewBundledArtifactSource: %v", err)
	}
	_, err = source.Resolve(context.Background(), bundledDescriptor("nimi.parentos"))
	if !errors.Is(err, ErrBundledArtifactNotFound) {
		t.Fatalf("error = %v, want ErrBundledArtifactNotFound", err)
	}
}

func TestGatewayInstallsBundledDescriptor(t *testing.T) {
	bundledRoot := t.TempDir()
	writeBundledArtifact(t, bundledRoot, "nimi.parentos", map[string]string{
		"manifest.json": `{"name":"parentos"}`,
	})
	bundledSource, err := NewBundledArtifactSource(bundledRoot)
	if err != nil {
		t.Fatalf("NewBundledArtifactSource: %v", err)
	}
	dataRoot := t.TempDir()
	gateway := New(nil, nil,
		WithStoragePlanner(DataRootPlanner{DataRootRef: dataRoot}),
		WithEvidenceWriter(FileEvidenceWriter{}),
		WithBundledSource(bundledSource),
	)
	installed, err := gateway.Install(context.Background(), bundledDescriptor("nimi.parentos"))
	if err != nil {
		t.Fatalf("Install bundled: %v", err)
	}
	if installed.Evidence.VerificationState != string(VerificationStateBundledSource) {
		t.Fatalf("verification state = %q, want bundled-source", installed.Evidence.VerificationState)
	}
	if _, err := os.Stat(filepath.Join(installed.Plan.ReleaseRoot, "manifest.json")); err != nil {
		t.Fatalf("expected materialized bundled release: %v", err)
	}
}
