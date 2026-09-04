//go:build windows

package nimiappinstall

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash/crc32"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	"golang.org/x/sys/windows"
)

const (
	installTestRegistryRevision = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	installTestNextRevision     = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	installTestSourceCommit     = "cccccccccccccccccccccccccccccccccccccccc"
	installTestAppID            = "publisher.example-app"
	installTestVersion          = "1.2.3"
	installTestTargetID         = "windows-x86_64"
)

type installFixtureTransport struct {
	mu               sync.Mutex
	revision         string
	documents        map[string][]byte
	assetURL         string
	asset            []byte
	switchAfterAsset bool
	blockAfterAsset  bool
	blocked          bool
}

func (transport *installFixtureTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	transport.mu.Lock()
	defer transport.mu.Unlock()
	if request.URL.String() == "https://api.github.com/repos/nimiplatform/nimi-app-registry/git/ref/heads/main" {
		return fixtureHTTPResponse(request, http.StatusOK, mustFixtureJSON(map[string]any{
			"ref": "refs/heads/main", "object": map[string]any{"type": "commit", "sha": transport.revision},
		})), nil
	}
	if request.URL.Host == "raw.githubusercontent.com" {
		prefix := "/nimiplatform/nimi-app-registry/" + transport.revision + "/"
		path := strings.TrimPrefix(request.URL.Path, prefix)
		if path == request.URL.Path {
			return fixtureHTTPResponse(request, http.StatusNotFound, nil), nil
		}
		raw, ok := transport.documents[path]
		if !ok {
			return fixtureHTTPResponse(request, http.StatusNotFound, nil), nil
		}
		if path == "index.json" && transport.blocked {
			var index map[string]any
			if err := json.Unmarshal(raw, &index); err != nil {
				return nil, err
			}
			apps := index["apps"].(map[string]any)
			row := apps[installTestAppID].(map[string]any)
			row["kill_switch"] = map[string]any{"active": true, "reason": "security-review-revoked", "revision": 1}
			raw = mustFixtureJSON(index)
		}
		return fixtureHTTPResponse(request, http.StatusOK, raw), nil
	}
	if request.URL.String() == transport.assetURL {
		response := fixtureHTTPResponse(request, http.StatusOK, transport.asset)
		if transport.switchAfterAsset {
			transport.revision = installTestNextRevision
		}
		if transport.blockAfterAsset {
			transport.blocked = true
		}
		return response, nil
	}
	return fixtureHTTPResponse(request, http.StatusNotFound, nil), nil
}

func TestCoordinatorInstallsExactApprovedPackageAndRegistersAfterPublication(t *testing.T) {
	coordinator, client, kernel, transport := newInstallFixture(t, false)
	selector := resolveInstallFixture(t, client)
	result, err := coordinator.Install(context.Background(), selector)
	if err != nil {
		t.Fatal(err)
	}
	selectorText, _ := selector.Encode()
	if result.Job.Phase != localappkernel.PackageJobCompleted || result.Release.ReleaseRef != selectorText ||
		result.Registration.SourceClass != localappkernel.SourceClassVerified || result.Registration.ImmutableLineageID != selectorText ||
		result.Registration.ProvenanceRevision != 1 || !strings.HasPrefix(result.Registration.HostExecutableDigest, "bii_v1_") ||
		!strings.HasPrefix(result.Registration.PayloadRootDigest, "sha256:") {
		t.Fatalf("install result = %+v", result)
	}
	if raw, err := os.ReadFile(filepath.Join(result.Registration.ProjectRoot, "payload", "example-app.exe")); err != nil || len(raw) == 0 {
		t.Fatalf("committed Runtime entry bytes=%d err=%v", len(raw), err)
	}
	if result.Registration.ManifestPath != filepath.Join(result.Registration.ProjectRoot, "nimi.app.yaml") {
		t.Fatalf("manifest path = %q", result.Registration.ManifestPath)
	}
	assertInstallDirectoryNames(t, filepath.Join(kernel.DataRoot(), "apps", "packages", packageWorkDirectory), nil)
	assertInstallDirectoryNames(t, filepath.Join(kernel.DataRoot(), "apps", "packages", packageReleaseDirectory), []string{result.Job.JobID})
	if transport.revision != installTestRegistryRevision {
		t.Fatalf("Registry revision changed = %s", transport.revision)
	}
	if _, err := coordinator.Install(context.Background(), selector); !errors.Is(err, ErrAppAlreadyInstalled) {
		t.Fatalf("duplicate install error = %v", err)
	}
	jobs, err := kernel.PackageLifecycle().ListJobs(context.Background())
	if err != nil || len(jobs) != 1 {
		t.Fatalf("jobs=%+v err=%v", jobs, err)
	}
}

func TestCoordinatorRevalidatesBeforeCommitAndLeavesNoInstalledTruth(t *testing.T) {
	coordinator, client, kernel, _ := newInstallFixture(t, true)
	selector := resolveInstallFixture(t, client)
	if _, err := coordinator.Install(context.Background(), selector); !errors.Is(err, publicappregistry.ErrStaleSelection) {
		t.Fatalf("stale install error = %v", err)
	}
	if _, err := kernel.PackageLifecycle().GetCommittedRelease(context.Background(), installTestAppID, localappkernel.SourceClassVerified); !errors.Is(err, localappkernel.ErrCommittedReleaseNotFound) {
		t.Fatalf("stale selection created committed release: %v", err)
	}
	jobs, err := kernel.PackageLifecycle().ListJobs(context.Background())
	if err != nil || len(jobs) != 1 || jobs[0].Phase != localappkernel.PackageJobFailed || jobs[0].ReasonCode != "stale-selection" {
		t.Fatalf("stale job=%+v err=%v", jobs, err)
	}
	assertInstallDirectoryNames(t, filepath.Join(kernel.DataRoot(), "apps", "packages", packageWorkDirectory), nil)
	assertInstallDirectoryNames(t, filepath.Join(kernel.DataRoot(), "apps", "packages", packageReleaseDirectory), nil)
}

func TestCoordinatorPersistsSecondRevalidationPolicyBlockDistinctFromStaleness(t *testing.T) {
	coordinator, client, kernel, transport := newInstallFixture(t, false)
	selector := resolveInstallFixture(t, client)
	transport.blockAfterAsset = true
	if _, err := coordinator.Install(context.Background(), selector); !errors.Is(err, publicappregistry.ErrPolicyBlocked) {
		t.Fatalf("policy-blocked install error = %v", err)
	}
	jobs, err := kernel.PackageLifecycle().ListJobs(context.Background())
	if err != nil || len(jobs) != 1 || jobs[0].Phase != localappkernel.PackageJobFailed || jobs[0].ReasonCode != "policy-blocked" {
		t.Fatalf("policy-blocked job=%+v err=%v", jobs, err)
	}
	if _, err := kernel.PackageLifecycle().GetCommittedRelease(context.Background(), installTestAppID, localappkernel.SourceClassVerified); !errors.Is(err, localappkernel.ErrCommittedReleaseNotFound) {
		t.Fatalf("policy block created committed release: %v", err)
	}
}

func TestCoordinatorRecoveryFailsInterruptedJobAndPreservesCommittedRelease(t *testing.T) {
	coordinator, client, kernel, _ := newInstallFixture(t, false)
	selector := resolveInstallFixture(t, client)
	installed, err := coordinator.Install(context.Background(), selector)
	if err != nil {
		t.Fatal(err)
	}
	selectorText, _ := selector.Encode()
	steps := installProgressSteps
	interrupted, err := kernel.PackageLifecycle().Begin(context.Background(), localappkernel.BeginPackageJobInput{
		AppID: "publisher.interrupted", SourceClass: localappkernel.SourceClassVerified,
		Kind: localappkernel.PackageJobInstall, TargetRef: selectorText,
		ProgressBasis: localappkernel.PackageProgressSteps, StepsTotal: &steps, Cancelable: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, transition := range []struct {
		phase localappkernel.PackageJobPhase
		steps uint64
	}{
		{localappkernel.PackageJobDownloading, 0},
		{localappkernel.PackageJobVerifying, 1},
		{localappkernel.PackageJobStaging, 2},
		{localappkernel.PackageJobCommitting, 3},
	} {
		interrupted, err = kernel.PackageLifecycle().Advance(
			context.Background(), interrupted.JobID, interrupted.Phase, transition.phase,
			localappkernel.PackageJobProgress{StepsCompleted: transition.steps},
		)
		if err != nil {
			t.Fatal(err)
		}
	}
	packagesPath := filepath.Join(kernel.DataRoot(), "apps", "packages")
	for _, relative := range []string{
		filepath.Join(packageWorkDirectory, interrupted.JobID),
		filepath.Join(packageReleaseDirectory, packageStagePrefix+interrupted.JobID),
		filepath.Join(packageReleaseDirectory, interrupted.JobID),
		filepath.Join(packageWorkDirectory, installed.Job.JobID),
		filepath.Join(packageReleaseDirectory, "orphan-release"),
	} {
		if err := os.Mkdir(filepath.Join(packagesPath, relative), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := coordinator.Recover(context.Background()); err != nil {
		t.Fatal(err)
	}
	job, err := kernel.PackageLifecycle().GetJob(context.Background(), interrupted.JobID)
	if err != nil || job.Phase != localappkernel.PackageJobFailed || job.ReasonCode != "runtime-restarted" {
		t.Fatalf("recovered job=%+v err=%v", job, err)
	}
	if _, err := os.Stat(installed.Registration.ProjectRoot); err != nil {
		t.Fatalf("committed release was removed: %v", err)
	}
	assertInstallDirectoryNames(t, filepath.Join(packagesPath, packageWorkDirectory), nil)
	assertInstallDirectoryNames(t, filepath.Join(packagesPath, packageReleaseDirectory), []string{installed.Job.JobID})
}

func TestPublishStagedReleaseNeverReplacesExistingFinal(t *testing.T) {
	rootPath := t.TempDir()
	for _, name := range []string{"stage", "final"} {
		if err := os.Mkdir(filepath.Join(rootPath, name), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(rootPath, "final", "sentinel"), []byte("existing"), 0o600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Close() }()
	if err := publishStagedRelease(root, "stage", "final"); !errors.Is(err, ErrReleasePublication) {
		t.Fatalf("existing final error = %v", err)
	}
	if raw, err := os.ReadFile(filepath.Join(rootPath, "final", "sentinel")); err != nil || string(raw) != "existing" {
		t.Fatalf("existing final changed: %q err=%v", raw, err)
	}
	if _, err := os.Stat(filepath.Join(rootPath, "stage")); err != nil {
		t.Fatalf("stage disappeared after rejected publication: %v", err)
	}
}

func TestRecoveryContinuesOtherJobsWhenCommittedPayloadIsMissing(t *testing.T) {
	coordinator, client, kernel, _ := newInstallFixture(t, false)
	selector := resolveInstallFixture(t, client)
	installed, err := coordinator.Install(context.Background(), selector)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(installed.Registration.ProjectRoot); err != nil {
		t.Fatal(err)
	}
	selectorText, _ := selector.Encode()
	steps := installProgressSteps
	interrupted, err := kernel.PackageLifecycle().Begin(context.Background(), localappkernel.BeginPackageJobInput{
		AppID: "publisher.other-app", SourceClass: localappkernel.SourceClassVerified,
		Kind: localappkernel.PackageJobInstall, TargetRef: selectorText,
		ProgressBasis: localappkernel.PackageProgressSteps, StepsTotal: &steps, Cancelable: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	workPath := filepath.Join(kernel.DataRoot(), "apps", "packages", packageWorkDirectory, interrupted.JobID)
	if err := os.Mkdir(workPath, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.Recover(context.Background()); !errors.Is(err, ErrInstallRecoveryRequired) {
		t.Fatalf("missing committed payload recovery error = %v", err)
	}
	recovered, err := kernel.PackageLifecycle().GetJob(context.Background(), interrupted.JobID)
	if err != nil || recovered.Phase != localappkernel.PackageJobFailed {
		t.Fatalf("unrelated interrupted job=%+v err=%v", recovered, err)
	}
	if _, err := os.Stat(workPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unrelated work was not cleaned: %v", err)
	}
}

func TestRecoveryReopensKernelAndFailsInterruptedJob(t *testing.T) {
	coordinator, client, kernel, _ := newInstallFixture(t, false)
	selector := resolveInstallFixture(t, client)
	selectorText, _ := selector.Encode()
	steps := installProgressSteps
	interrupted, err := kernel.PackageLifecycle().Begin(context.Background(), localappkernel.BeginPackageJobInput{
		AppID: "publisher.restart-app", SourceClass: localappkernel.SourceClassVerified,
		Kind: localappkernel.PackageJobInstall, TargetRef: selectorText,
		ProgressBasis: localappkernel.PackageProgressSteps, StepsTotal: &steps, Cancelable: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	dataRoot := kernel.DataRoot()
	workPath := filepath.Join(dataRoot, "apps", "packages", packageWorkDirectory, interrupted.JobID)
	if err := os.Mkdir(workPath, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.Close(); err != nil {
		t.Fatal(err)
	}
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}
	identity, err := localappkernel.ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	databasePath, err := localappkernel.CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	reopenedKernel, err := localappkernel.OpenSQLite(context.Background(), databasePath, identity, localappkernel.Options{
		HostInstallID: "install-fixture-host", DataRoot: dataRoot,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reopenedKernel.Close() }()
	reopenedCoordinator, err := NewCoordinator(client, reopenedKernel)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reopenedCoordinator.Close() }()
	if err := reopenedCoordinator.Recover(context.Background()); err != nil {
		t.Fatal(err)
	}
	recovered, err := reopenedKernel.PackageLifecycle().GetJob(context.Background(), interrupted.JobID)
	if err != nil || recovered.Phase != localappkernel.PackageJobFailed || recovered.ReasonCode != "runtime-restarted" {
		t.Fatalf("reopened recovery job=%+v err=%v", recovered, err)
	}
	if _, err := os.Stat(workPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("reopened recovery left work root: %v", err)
	}
}

func newInstallFixture(t *testing.T, switchAfterAsset bool) (*Coordinator, *publicappregistry.Client, *localappkernel.Kernel, *installFixtureTransport) {
	t.Helper()
	packageBytes := buildInstallTestPackage(t)
	digest := sha256.Sum256(packageBytes)
	assetName := installTestAppID + "-" + installTestVersion + "-" + installTestTargetID + ".nimiapp"
	repository := "https://github.com/publisher/example-app"
	assetURL := repository + "/releases/download/v" + installTestVersion + "/" + assetName
	documents := installRegistryDocuments(packageBytes, hex.EncodeToString(digest[:]), assetName, assetURL, repository)
	transport := &installFixtureTransport{
		revision: installTestRegistryRevision, documents: documents,
		assetURL: assetURL, asset: packageBytes, switchAfterAsset: switchAfterAsset,
	}
	previousTransport := http.DefaultTransport
	http.DefaultTransport = transport
	t.Cleanup(func() { http.DefaultTransport = previousTransport })
	client := publicappregistry.NewCanonicalClient()
	dataRoot := t.TempDir()
	identity, err := localappkernel.ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	databasePath, err := localappkernel.CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(context.Background(), databasePath, identity, localappkernel.Options{
		HostInstallID: "install-fixture-host", DataRoot: dataRoot,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	coordinator, err := NewCoordinator(client, kernel)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = coordinator.Close() })
	return coordinator, client, kernel, transport
}

func resolveInstallFixture(t *testing.T, client *publicappregistry.Client) publicappregistry.ApprovedTargetSelector {
	t.Helper()
	snapshot, err := client.Load(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := snapshot.Resolve(context.Background(), installTestAppID, installTestTargetID, "windows", "x86_64")
	if err != nil {
		t.Fatal(err)
	}
	return resolved.Selector
}

func installRegistryDocuments(packageBytes []byte, packageSHA, assetName, assetURL, repository string) map[string][]byte {
	commonID := "https://registry.nimi.ai/schema/common.schema.json"
	indexID := "https://registry.nimi.ai/schema/index.schema.json"
	descriptorSchemaID := "https://registry.nimi.ai/schema/approved-descriptor.schema.json"
	descriptorID := installTestAppID + "@" + installTestVersion
	descriptorPath := "descriptors/" + installTestAppID + "/" + installTestVersion + ".json"
	tag := "v" + installTestVersion
	descriptor := map[string]any{
		"schema_version":       1,
		"descriptor_id":        descriptorID,
		"publisher_submission": map[string]any{"pull_number": 7, "path": "submissions/publisher/" + installTestAppID + "/" + installTestVersion + ".json", "head_sha": installTestSourceCommit},
		"admission": map[string]any{
			"ordinary_release_proof": true, "trust_tier": "community", "build_assurance": "developer-attested",
			"dependency_assurance": map[string]any{"lockfile_reviewed": true, "sbom_ref": nil},
			"review":               map[string]any{"decision": "approved", "adjudicator_login": "maintainer", "adjudicator_actor_id": 42, "reason_code": "approved-review", "decided_at": "2026-09-04T00:00:00Z"},
		},
		"candidate": map[string]any{
			"app_id": installTestAppID, "display_name": "Example App", "version": installTestVersion,
			"publisher":  map[string]any{"github_namespace": "publisher", "namespace_kind": "organization", "assurance": "pseudonymous", "verified_domain_ref": nil, "kyc_ref": nil},
			"source":     map[string]any{"repository": repository, "license": map[string]any{"spdx_expression": "MIT", "files": []any{map[string]any{"path": "LICENSE", "sha256": strings.Repeat("1", 64)}}}},
			"release":    map[string]any{"tag": tag, "tag_protection_ref": "https://api.github.com/repos/publisher/example-app/rulesets/1", "commit_sha": installTestSourceCommit, "release_id": 21, "release_url": repository + "/releases/tag/" + tag, "release_notes_url": repository + "/releases/tag/" + tag, "immutable": true, "prerelease": false},
			"aggregate":  map[string]any{"asset_id": 100, "asset_name": "candidate.json", "asset_url": repository + "/releases/download/" + tag + "/candidate.json", "size": 10, "sha256": strings.Repeat("2", 64)},
			"package":    map[string]any{"kind": "nimiapp", "runtime_kind": "native", "registration_mode": "app-managed", "sandbox_ref": "windows-current-user-v1"},
			"app_access": []string{"runtime.consume"}, "capability_contract_refs": []string{}, "required_standardized_feature_refs": []string{},
			"storage_policy": map[string]any{"kind": "nimi-mediated-default", "os_storage_disclosure": nil},
			"update_channel": "stable", "rollback_marker": "none",
			"support": map[string]any{"diagnostics_bundle_fields": []string{}, "redaction_rules": []string{}, "issue_categories": []string{}, "escalation_url": repository + "/issues", "kill_switch_visibility": "visible", "recovery_instructions": "Reinstall the approved release."},
			"targets": []any{map[string]any{
				"target_id": installTestTargetID, "os": "windows", "arch": "x86_64", "asset_id": 101,
				"asset_name": assetName, "asset_url": assetURL, "size": len(packageBytes), "sha256": packageSHA,
				"runtime_entry": "payload/example-app.exe", "provenance_attestation_refs": []string{"https://api.github.com/repos/publisher/example-app/attestations/sha256:" + packageSHA},
				"execution_profile_ref": "windows-user-mode-as-invoker-v1",
				"native_trust":          map[string]any{"signing_subject": nil, "observed_subject": nil, "entitlements_ref": nil, "windows_code_signing": "unsigned", "macos_notarization": "not-applicable", "macos_developer_id_subject": nil},
			}},
		},
	}
	index := map[string]any{
		"schema_version": 1,
		"apps": map[string]any{installTestAppID: map[string]any{
			"display_name": "Example App", "visibility": "public", "admission_status": "approved",
			"kill_switch":                       map[string]any{"active": false, "reason": nil, "revision": 0},
			"latest_admitted_release_by_target": map[string]any{installTestTargetID: map[string]any{"descriptor_id": descriptorID, "path": descriptorPath}},
		}},
	}
	minimalSchema := func(id string) []byte {
		return mustFixtureJSON(map[string]any{"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": id, "type": "object"})
	}
	return map[string][]byte{
		"schema/common.schema.json":              minimalSchema(commonID),
		"schema/index.schema.json":               minimalSchema(indexID),
		"schema/approved-descriptor.schema.json": minimalSchema(descriptorSchemaID),
		"index.json":                             mustFixtureJSON(index),
		descriptorPath:                           mustFixtureJSON(descriptor),
	}
}

type installArchiveEntry struct {
	name  string
	bytes []byte
	mode  uint32
}

func buildInstallTestPackage(t *testing.T) []byte {
	t.Helper()
	executable, err := os.ReadFile(compileInstallTestPE(t))
	if err != nil {
		t.Fatal(err)
	}
	manifest := mustFixtureJSON(map[string]any{
		"format": "nimi.app-package/v1", "app_id": installTestAppID, "version": installTestVersion,
		"target_id": installTestTargetID, "os": "windows", "arch": "x86_64", "runtime_entry": "payload/example-app.exe",
		"native_trust":      map[string]any{"posture": "production-unsigned", "windows_authenticode": "unsigned", "certificate_subject": nil},
		"execution_profile": map[string]any{"requested_execution_level": "asInvoker", "ui_access": false},
	})
	entries := []installArchiveEntry{
		{name: "LICENSE", bytes: []byte("MIT\n"), mode: 0o644},
		{name: "manifest.json", bytes: manifest, mode: 0o644},
		{name: "nimi.app.yaml", bytes: []byte("app_id: " + installTestAppID + "\nversion: " + installTestVersion + "\napp_access:\n  - runtime.consume\n"), mode: 0o644},
		{name: "payload/example-app.exe", bytes: executable, mode: 0o755},
		{name: "payload/resources/index.html", bytes: []byte("<html>fixture</html>"), mode: 0o644},
	}
	sort.Slice(entries, func(left, right int) bool { return entries[left].name < entries[right].name })
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	for _, entry := range entries {
		header := &zip.FileHeader{
			Name: entry.name, Method: zip.Store, Flags: 0x0800,
			CreatorVersion: 0x0314, ReaderVersion: 20, CRC32: crc32.ChecksumIEEE(entry.bytes),
			CompressedSize: uint32(len(entry.bytes)), UncompressedSize: uint32(len(entry.bytes)),
			CompressedSize64: uint64(len(entry.bytes)), UncompressedSize64: uint64(len(entry.bytes)),
			ExternalAttrs: (0o100000 | entry.mode) << 16,
		}
		entryWriter, err := writer.CreateRaw(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entryWriter.Write(entry.bytes); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func compileInstallTestPE(t *testing.T) string {
	t.Helper()
	windowsDirectory, err := windows.GetSystemWindowsDirectory()
	if err != nil {
		t.Fatal(err)
	}
	compiler := filepath.Join(windowsDirectory, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe")
	if _, err := os.Stat(compiler); err != nil {
		compiler = filepath.Join(windowsDirectory, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")
	}
	if _, err := os.Stat(compiler); err != nil {
		t.Fatal("a real Windows C# compiler is required")
	}
	root := t.TempDir()
	executable := filepath.Join(root, "example-app.exe")
	source := filepath.Join(root, "Program.cs")
	manifest := filepath.Join(root, "app.manifest")
	if err := os.WriteFile(source, []byte("internal static class Program { [System.STAThread] private static void Main() {} }\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifest, []byte(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges>
    <requestedExecutionLevel level="asInvoker" uiAccess="false" />
  </requestedPrivileges></security></trustInfo>
</assembly>
`), 0o600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(compiler, "/nologo", "/target:winexe", "/platform:x64", "/out:"+executable, "/win32manifest:"+manifest, source)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("compile install fixture PE: %v\n%s", err, output)
	}
	return executable
}

func fixtureHTTPResponse(request *http.Request, status int, payload []byte) *http.Response {
	return &http.Response{
		StatusCode: status, Status: http.StatusText(status), Header: make(http.Header),
		Body: io.NopCloser(bytes.NewReader(payload)), ContentLength: int64(len(payload)), Request: request,
	}
}

func mustFixtureJSON(value any) []byte {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return raw
}

func assertInstallDirectoryNames(t *testing.T, directory string, expected []string) {
	t.Helper()
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	sort.Strings(expected)
	if strings.Join(names, "\x00") != strings.Join(expected, "\x00") {
		t.Fatalf("directory %s entries=%v want=%v", directory, names, expected)
	}
}
