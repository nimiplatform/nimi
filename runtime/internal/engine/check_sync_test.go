package engine

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestManagedEnvironmentCheckSyncDoesNotPromoteStaticOnlyProfileAndPreservesUnknown(t *testing.T) {
	dataRoot := t.TempDir()
	manager, err := NewManager(nil, ManagedRoots{
		Environments: filepath.Join(dataRoot, "environments"),
		Dependencies: filepath.Join(dataRoot, "dependencies"),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	consumer := "speech.qwen3-tts.python"
	profilePlatform := currentGOOS() + "/" + currentGOARCH()
	identity, err := ResolvePythonDependencyProfileIdentity(consumer, profilePlatform, "cpu")
	if err != nil {
		profilePlatform = "darwin/arm64"
		identity, err = ResolvePythonDependencyProfileIdentity(consumer, profilePlatform, "cpu")
	}
	if err != nil {
		t.Fatal(err)
	}
	profileRoot := filepath.Join(dataRoot, "environments", "python-profiles", identity.ProfileDigest)
	files, err := PythonDependencyProfileStaticFiles(consumer, identity)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		path := filepath.Join(profileRoot, file.RelativePath)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, file.Content, 0o444); err != nil {
			t.Fatal(err)
		}
	}
	if err := writePythonDependencyProfileManifest(profileRoot, consumer, identity); err != nil {
		t.Fatal(err)
	}
	otherPlatform := "darwin/arm64"
	if otherPlatform == profilePlatform {
		otherPlatform = "windows/amd64"
	}
	incompatibleIdentity, err := ResolvePythonDependencyProfileIdentity(consumer, otherPlatform, "cpu")
	if err != nil {
		t.Fatal(err)
	}
	incompatibleRoot := filepath.Join(dataRoot, "environments", "python-profiles", incompatibleIdentity.ProfileDigest)
	if err := os.MkdirAll(incompatibleRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := writePythonDependencyProfileManifest(incompatibleRoot, consumer, incompatibleIdentity); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dataRoot, "dependencies", "third-party-cache"), 0o755); err != nil {
		t.Fatal(err)
	}

	results := manager.checkSyncManagedEnvironment(context.Background(), dataRoot, profilePlatform)
	profileUnavailable := false
	unknownPreserved := false
	incompatiblePreserved := false
	for _, result := range results {
		profileUnavailable = profileUnavailable || result.Kind == "python_profile" && result.Reference == identity.ProfileDigest && result.Status == "unavailable" && result.Reason == "PYTHON_PROFILE_PROMOTED_INTERPRETER_UNAVAILABLE"
		unknownPreserved = unknownPreserved || result.Locator == "dependencies/third-party-cache" && result.Status == "unknown"
		incompatiblePreserved = incompatiblePreserved || result.Reference == incompatibleIdentity.ProfileDigest && result.Status == "incompatible" && result.NextAction == "rerun_check_sync"
	}
	if !profileUnavailable || !unknownPreserved || !incompatiblePreserved {
		t.Fatalf("managed environment Check & Sync = %+v", results)
	}
}

func TestManagedEnvironmentCheckSyncPersistsAndReportsLegacyRegistryRebase(t *testing.T) {
	dataRoot := t.TempDir()
	environmentsRoot := filepath.Join(dataRoot, "environments")
	dependenciesRoot := filepath.Join(dataRoot, "dependencies")
	legacyRoot := filepath.Join(t.TempDir(), "former-root", "environments")
	legacyBinary := filepath.Join(legacyRoot, "llama", "1.0.0", llamaBinaryName())
	currentBinary := filepath.Join(environmentsRoot, "llama", "1.0.0", llamaBinaryName())
	if err := os.MkdirAll(filepath.Dir(currentBinary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(currentBinary, []byte("engine"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dependenciesRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	registryPath := filepath.Join(environmentsRoot, "registry.json")
	payload, err := json.Marshal([]*RegistryEntry{{
		Engine: EngineLlama, Version: "1.0.0", BinaryPath: legacyBinary,
		Platform: PlatformString(), InstalledAt: "2026-01-01T00:00:00Z",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(registryPath, payload, 0o600); err != nil {
		t.Fatal(err)
	}

	manager, err := NewManager(nil, ManagedRoots{Environments: environmentsRoot, Dependencies: dependenciesRoot}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := manager.registry.Get(EngineLlama, "1.0.0"); got != nil {
		t.Fatalf("pending legacy rebase was visible before durable Check & Sync: %+v", got)
	}
	before, err := os.ReadFile(registryPath)
	if err != nil {
		t.Fatal(err)
	}
	var beforeEntries []*RegistryEntry
	if err := json.Unmarshal(before, &beforeEntries); err != nil || len(beforeEntries) != 1 || beforeEntries[0].BinaryPath != legacyBinary {
		t.Fatalf("registry loader rewrote legacy owner state before Check & Sync: %s", before)
	}

	results := manager.CheckSyncManagedEnvironment(context.Background(), dataRoot)
	foundRebase := false
	for _, result := range results {
		foundRebase = foundRebase || result.Kind == "engine_package" && result.Reference == "llama/1.0.0" &&
			result.Status == "unavailable" && result.Change == "rebased" && result.Reason == "ENGINE_REGISTRY_EVIDENCE_INCOMPLETE"
	}
	if !foundRebase {
		t.Fatalf("engine registry rebase was not reported by its owner: %+v", results)
	}
	after, err := os.ReadFile(registryPath)
	if err != nil {
		t.Fatal(err)
	}
	var afterEntries []*RegistryEntry
	if err := json.Unmarshal(after, &afterEntries); err != nil || len(afterEntries) != 1 ||
		filepath.IsAbs(afterEntries[0].BinaryPath) || filepath.ToSlash(afterEntries[0].BinaryPath) != "llama/1.0.0/"+llamaBinaryName() {
		t.Fatalf("owner reconciliation did not persist a root-relative locator: %s", after)
	}
}

func TestManagedEnvironmentRegistryDoesNotInferForeignAbsoluteSuffix(t *testing.T) {
	dataRoot := t.TempDir()
	environmentsRoot := filepath.Join(dataRoot, "environments")
	dependenciesRoot := filepath.Join(dataRoot, "dependencies")
	foreign := filepath.Join(t.TempDir(), "environments", "unrelated", "payload.exe")
	guessed := filepath.Join(environmentsRoot, "unrelated", "payload.exe")
	if err := os.MkdirAll(filepath.Dir(guessed), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(guessed, []byte("must-not-be-adopted"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dependenciesRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal([]*RegistryEntry{{
		Engine: EngineLlama, Version: "1.0.0", BinaryPath: foreign, Platform: currentGOOS() + "/" + currentGOARCH(),
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(environmentsRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(environmentsRoot, "registry.json"), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := NewManager(nil, ManagedRoots{Environments: environmentsRoot, Dependencies: dependenciesRoot}, nil)
	if err != nil {
		t.Fatal(err)
	}
	entries := manager.registry.List()
	want := filepath.Join(environmentsRoot, string(EngineLlama), "1.0.0", llamaBinaryName())
	if len(entries) != 1 || !sameManagedPath(entries[0].BinaryPath, want) || sameManagedPath(entries[0].BinaryPath, guessed) {
		t.Fatalf("foreign registry suffix was inferred: entries=%+v guessed=%q want=%q", entries, guessed, want)
	}
	results := manager.CheckSyncManagedEnvironment(context.Background(), dataRoot)
	for _, result := range results {
		if result.Kind == "engine_package" && result.Reference == "llama/1.0.0" {
			if result.Status != "unavailable" {
				t.Fatalf("foreign registry locator produced pseudo-ready material: %+v", result)
			}
			return
		}
	}
	t.Fatalf("foreign registry inventory result missing: %+v", results)
}

func TestManagedEnvironmentCheckSyncRequiresAndVerifiesRegistrySHAAndPlatform(t *testing.T) {
	dataRoot := t.TempDir()
	environmentsRoot := filepath.Join(dataRoot, "environments")
	dependenciesRoot := filepath.Join(dataRoot, "dependencies")
	version := DefaultLlamaConfig().Version
	assetName, err := preferredLlamaAssetNameForCurrentHost(version)
	if err != nil {
		t.Skipf("current host has no supported llama package: %v", err)
	}
	binary := filepath.Join(environmentsRoot, string(EngineLlama), version, llamaBinaryName())
	if err := os.MkdirAll(filepath.Dir(binary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(binary, []byte("verified-engine"), 0o700); err != nil {
		t.Fatal(err)
	}
	digest, err := sha256File(binary)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := NewRegistry(environmentsRoot)
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.Put(&RegistryEntry{
		Engine: EngineLlama, Version: version, BinaryPath: binary, SHA256: digest,
		Platform: currentGOOS() + "/" + currentGOARCH(), AssetName: assetName,
		AcceleratorPlane: llamaAcceleratorPlaneForAsset(assetName),
	}); err != nil {
		t.Fatal(err)
	}
	manager, err := NewManager(nil, ManagedRoots{Environments: environmentsRoot, Dependencies: dependenciesRoot}, nil)
	if err != nil {
		t.Fatal(err)
	}
	results := manager.CheckSyncManagedEnvironment(context.Background(), dataRoot)
	for _, result := range results {
		if result.Kind == "engine_package" && result.Reference == string(EngineLlama)+"/"+version {
			if result.Status != "available" || result.Reason != "ENGINE_REGISTRY_ENTRY_VERIFIED" {
				t.Fatalf("verified registry result = %+v", result)
			}
			return
		}
	}
	t.Fatalf("verified registry result missing: %+v", results)
}
