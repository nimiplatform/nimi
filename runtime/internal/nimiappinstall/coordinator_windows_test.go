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
	"fmt"
	"hash/crc32"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
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
	stallAsset       bool
}

func (transport *installFixtureTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	transport.mu.Lock()
	defer transport.mu.Unlock()
	if request.URL.String() == "https://github.com/nimiplatform/nimi-app-registry.git/info/refs?service=git-upload-pack" {
		ref := transport.revision + " refs/heads/main\x00object-format=sha1\n"
		advertisement := fmt.Sprintf("001e# service=git-upload-pack\n0000%04x%s0000", len(ref)+4, ref)
		response := fixtureHTTPResponse(request, http.StatusOK, []byte(advertisement))
		response.Header.Set("Content-Type", "application/x-git-upload-pack-advertisement")
		return response, nil
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
		if transport.stallAsset {
			response := fixtureHTTPResponse(request, http.StatusOK, nil)
			response.ContentLength = int64(len(transport.asset))
			response.Body = &contextBlockingBody{ctx: request.Context()}
			return response, nil
		}
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

func TestUpdatePreservesSubjectDataAndOldReleaseThroughCancellationAndFailure(t *testing.T) {
	ctx := context.Background()
	coordinator, client, kernel, transport := newInstallFixture(t, false)
	initial, err := coordinator.Install(ctx, resolveInstallFixture(t, client))
	if err != nil {
		t.Fatal(err)
	}
	handle := initial.Registration.RegistrationHandle
	stopped := func(observed string) error {
		if observed != handle {
			t.Fatal("wrong installed subject")
		}
		return nil
	}
	if _, err := coordinator.StartUpdate(ctx, resolveInstallFixture(t, client), handle, installTestVersion, stopped); !errors.Is(err, ErrAppAlreadyInstalled) {
		t.Fatalf("same-version update: %v", err)
	}
	assets, err := appstorage.NewAssetStore(kernel.DataRoot(), appstorage.AssetPolicy{})
	if err != nil {
		t.Fatal(err)
	}
	owner := appstorage.ManagedOwner{AccountID: "test-account", RegisteredAppSubject: initial.Registration.RegisteredAppSubject}
	if _, err := assets.Write(ctx, owner, "profile.json", "application/json", false, io.NopCloser(strings.NewReader(`{"note":"preserve across update"}`))); err != nil {
		t.Fatal(err)
	}
	advanceInstallFixture(t, transport, "1.2.4")
	selector := resolveInstallFixture(t, client)
	if _, err := coordinator.StartUpdate(ctx, selector, "wrong-installed-handle", installTestVersion, stopped); !errors.Is(err, publicappregistry.ErrStaleSelection) {
		t.Fatalf("stale installed selection: %v", err)
	}
	if _, err := coordinator.StartUpdate(ctx, selector, handle, installTestVersion, func(string) error { return ErrUpdateHostRunning }); !errors.Is(err, ErrUpdateHostRunning) {
		t.Fatalf("running Host update: %v", err)
	}
	if _, err := coordinator.StartUpdate(ctx, selector, handle, "1.2.2", stopped); !errors.Is(err, publicappregistry.ErrStaleSelection) {
		t.Fatalf("stale installed version: %v", err)
	}
	jobs, _ := kernel.PackageLifecycle().ListJobs(ctx)
	if len(jobs) != 1 {
		t.Fatalf("rejected update created jobs: %d", len(jobs))
	}
	assertOld := func() {
		t.Helper()
		current, err := kernel.PackageLifecycle().GetCommittedRelease(ctx, initial.Release.AppID, localappkernel.SourceClassVerified)
		if err != nil || current.ReleaseRef != initial.Release.ReleaseRef {
			t.Fatalf("old release lost: %+v %v", current, err)
		}
		registration, err := kernel.Registrations().GetByHandle(ctx, handle)
		if err != nil || registration.SourceGeneration != initial.Registration.SourceGeneration || registration.RegisteredAppSubject != owner.RegisteredAppSubject {
			t.Fatalf("old registration changed: %+v %v", registration, err)
		}
		if _, err := os.Stat(initial.Registration.ProjectRoot); err != nil {
			t.Fatal("old package removed", err)
		}
	}
	transport.mu.Lock()
	transport.stallAsset = true
	transport.mu.Unlock()
	job, err := coordinator.StartUpdate(ctx, selector, handle, installTestVersion, stopped)
	if err != nil || job.Kind != localappkernel.PackageJobUpdate {
		t.Fatalf("update start: %+v %v", job, err)
	}
	waitForInstallPhase(t, kernel, job.JobID, localappkernel.PackageJobDownloading)
	assertOld()
	if _, err := coordinator.CancelInstall(ctx, job.JobID, localappkernel.PackageJobDownloading, "user-canceled"); err != nil {
		t.Fatal(err)
	}
	assertOld()
	transport.mu.Lock()
	transport.stallAsset = false
	validAsset := append([]byte(nil), transport.asset...)
	transport.asset[len(transport.asset)-1] ^= 1
	transport.mu.Unlock()
	job, err = coordinator.StartUpdate(ctx, selector, handle, installTestVersion, stopped)
	if err != nil {
		t.Fatal(err)
	}
	waitForInstallPhase(t, kernel, job.JobID, localappkernel.PackageJobFailed)
	assertOld()
	transport.mu.Lock()
	transport.asset = validAsset
	transport.mu.Unlock()
	job, err = coordinator.StartUpdate(ctx, selector, handle, installTestVersion, stopped)
	if err != nil {
		t.Fatal(err)
	}
	waitForInstallPhase(t, kernel, job.JobID, localappkernel.PackageJobCompleted)
	if err := coordinator.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	current, err := kernel.PackageLifecycle().GetCommittedRelease(ctx, initial.Release.AppID, localappkernel.SourceClassVerified)
	if err != nil || current.Version != "1.2.4" || current.RegistrationHandle != handle {
		t.Fatalf("updated release: %+v %v", current, err)
	}
	registration, err := kernel.Registrations().GetByHandle(ctx, handle)
	if err != nil || registration.RegisteredAppSubject != owner.RegisteredAppSubject || registration.SourceGeneration != initial.Registration.SourceGeneration+1 {
		t.Fatalf("updated subject: %+v %v", registration, err)
	}
	read, err := assets.Open(ctx, appstorage.ManagedOwner{AccountID: owner.AccountID, RegisteredAppSubject: registration.RegisteredAppSubject}, "profile.json")
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(read.Body)
	_ = read.Body.Close()
	if err != nil || string(data) != `{"note":"preserve across update"}` {
		t.Fatalf("App data lost: %q %v", data, err)
	}
	if err := coordinator.WithVerifiedInstalledLaunch(ctx, handle, func(launch VerifiedInstalledLaunch) error {
		if launch.Release.Version != current.Version || launch.Registration.ProvenanceRevision != registration.ProvenanceRevision {
			t.Fatal("launch did not use the updated release")
		}
		return nil
	}); err != nil {
		t.Fatalf("updated release cannot launch: %v", err)
	}
	if _, err := os.Stat(initial.Registration.ProjectRoot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("retired package retained: %v", err)
	}
	// A crash after reserving another update keeps the committed release.
	advanceInstallFixture(t, transport, "1.2.5")
	_, interrupted, err := coordinator.beginInstallLocked(ctx, resolveInstallFixture(t, client), handle, current.Version, stopped)
	if err != nil {
		t.Fatal(err)
	}
	if err := coordinator.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	paused, err := kernel.PackageLifecycle().GetJob(ctx, interrupted.JobID)
	if err != nil || paused.Phase != localappkernel.PackageJobPaused || paused.ReasonCode != "runtime-interrupted" {
		t.Fatalf("interrupted update: %+v %v", paused, err)
	}
	retained, _ := kernel.PackageLifecycle().GetCommittedRelease(ctx, current.AppID, current.SourceClass)
	if retained.ReleaseRef != current.ReleaseRef {
		t.Fatal("restart lost committed update")
	}
}

func advanceInstallFixture(t *testing.T, transport *installFixtureTransport, version string) {
	t.Helper()
	asset := buildInstallTestPackage(t, version)
	digest := sha256.Sum256(asset)
	name := installTestAppID + "-" + version + "-" + installTestTargetID + ".nimiapp"
	repository := "https://github.com/publisher/example-app"
	url := repository + "/releases/download/v" + version + "/" + name
	documents := installRegistryDocuments(asset, hex.EncodeToString(digest[:]), name, url, repository, version)
	transport.mu.Lock()
	defer transport.mu.Unlock()
	for path, raw := range transport.documents {
		if strings.HasPrefix(path, "descriptors/") {
			documents[path] = raw
		}
	}
	transport.documents = documents
	transport.asset = asset
	transport.assetURL = url
	transport.revision = installTestNextRevision
}

func TestInstalledLaunchRechecksFullPayloadCurrentPolicyAndReservation(t *testing.T) {
	ctx := context.Background()
	coordinator, client, kernel, transport := newInstallFixture(t, false)
	result, err := coordinator.Install(ctx, resolveInstallFixture(t, client))
	if err != nil {
		t.Fatal(err)
	}
	handle := result.Registration.RegistrationHandle
	called := false
	bind := func(launch VerifiedInstalledLaunch) error {
		called = true
		if launch.RuntimeEntry != filepath.Join(result.Registration.ProjectRoot, "payload", "example-app.exe") || launch.Release.RegistrationHandle != handle {
			t.Fatalf("wrong exact entry: %+v", launch)
		}
		return nil
	}
	if err := coordinator.WithVerifiedInstalledLaunch(ctx, handle, bind); err != nil || !called {
		t.Fatalf("verified launch: %v", err)
	}
	transport.revision = installTestNextRevision
	if err := coordinator.WithVerifiedInstalledLaunch(ctx, handle, bind); err != nil {
		t.Fatalf("Registry head alone invalidated installed release: %v", err)
	}
	called = false
	transport.blocked = true
	if err := coordinator.WithVerifiedInstalledLaunch(ctx, handle, bind); !errors.Is(err, publicappregistry.ErrPolicyBlocked) || called {
		t.Fatalf("policy bypass: %v", err)
	}
	transport.blocked = false
	job, err := kernel.PackageLifecycle().Begin(ctx, localappkernel.BeginPackageJobInput{
		AppID: result.Release.AppID, SourceClass: localappkernel.SourceClassVerified, Kind: localappkernel.PackageJobUninstall,
		TargetRef: result.Release.ReleaseRef, ProgressBasis: localappkernel.PackageProgressIndeterminate, Cancelable: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := coordinator.WithVerifiedInstalledLaunch(ctx, handle, bind); !errors.Is(err, localappkernel.ErrPackageJobActive) || called {
		t.Fatalf("uninstall reservation bypass: %v", err)
	}
	if _, err := kernel.PackageLifecycle().Cancel(ctx, job.JobID, job.Phase, "user-canceled"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(result.Registration.ProjectRoot, "payload", "resources", "index.html"), []byte("changed non-executable payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.WithVerifiedInstalledLaunch(ctx, handle, bind); !errors.Is(err, nimiapppackage.ErrPackageIntegrity) || called {
		t.Fatalf("non-EXE mutation bypass: %v", err)
	}
}

func TestUninstallReservesCancelsAndRemovesOnlyExactManagedRelease(t *testing.T) {
	ctx := context.Background()
	coordinator, client, kernel, _ := newInstallFixture(t, false)
	installed, err := coordinator.Install(ctx, resolveInstallFixture(t, client))
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(kernel.DataRoot(), "shared-model-marker")
	if err := os.WriteFile(marker, []byte("retain"), 0o600); err != nil {
		t.Fatal(err)
	}
	handle := installed.Registration.RegistrationHandle
	first, err := coordinator.StartUninstall(ctx, handle)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := coordinator.CancelUninstall(ctx, first.JobID, first.Phase, "user-canceled"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(installed.Registration.ProjectRoot); err != nil {
		t.Fatal("cancellation removed package", err)
	}
	job, err := coordinator.StartUninstall(ctx, handle)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := coordinator.CompleteUninstall(ctx, job.JobID, "wrong-selector"); !errors.Is(err, ErrUninstall) {
		t.Fatalf("wrong selector accepted: %v", err)
	}
	if err := coordinator.WithVerifiedInstalledLaunch(ctx, handle, func(VerifiedInstalledLaunch) error { t.Fatal("uninstall reservation admitted launch"); return nil }); !errors.Is(err, localappkernel.ErrPackageJobActive) {
		t.Fatal(err)
	}
	completed, err := coordinator.CompleteUninstall(ctx, job.JobID, handle)
	if err != nil || completed.Phase != localappkernel.PackageJobCompleted || completed.StepsCompleted != 2 {
		t.Fatalf("uninstall = %+v %v", completed, err)
	}
	if _, err := os.Stat(installed.Registration.ProjectRoot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("package remains: %v", err)
	}
	if _, err := kernel.PackageLifecycle().GetCommittedRelease(ctx, installed.Release.AppID, localappkernel.SourceClassVerified); !errors.Is(err, localappkernel.ErrCommittedReleaseNotFound) {
		t.Fatal(err)
	}
	if _, err := kernel.Registrations().GetActiveByHandle(ctx, handle); !errors.Is(err, localappkernel.ErrRegistrationTombstoned) {
		t.Fatal(err)
	}
	if err := coordinator.Recover(ctx); err != nil {
		t.Fatal("recovery after canceled then completed uninstall", err)
	}
	if data, err := os.ReadFile(marker); err != nil || string(data) != "retain" {
		t.Fatal("unrelated data changed")
	}
	if _, err := client.RevalidateInstalled(ctx, resolveInstallFixture(t, client)); err != nil {
		t.Fatal("uninstall changed Registry admission", err)
	}
}

func TestUninstallRestartRestoresDetachedRootBeforeFailingJob(t *testing.T) {
	ctx := context.Background()
	coordinator, client, kernel, _ := newInstallFixture(t, false)
	installed, err := coordinator.Install(ctx, resolveInstallFixture(t, client))
	if err != nil {
		t.Fatal(err)
	}
	job, err := coordinator.StartUninstall(ctx, installed.Registration.RegistrationHandle)
	if err != nil {
		t.Fatal(err)
	}
	job, err = coordinator.lifecycle.Advance(ctx, job.JobID, job.Phase, localappkernel.PackageJobRemovingPackage, localappkernel.PackageJobProgress{})
	if err != nil {
		t.Fatal(err)
	}
	root, err := coordinator.packagesRoot.OpenRoot(packageReleaseDirectory)
	if err != nil {
		t.Fatal(err)
	}
	if err := publishStagedRelease(root, filepath.Base(installed.Registration.ProjectRoot), uninstallRootPrefix+job.JobID); err != nil {
		t.Fatal(err)
	}
	_ = root.Close()
	if err := coordinator.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(installed.Registration.ProjectRoot); err != nil {
		t.Fatal("detached package was not restored", err)
	}
	current, err := kernel.PackageLifecycle().GetJob(ctx, job.JobID)
	if err != nil || current.Phase != localappkernel.PackageJobFailed || current.ReasonCode != "runtime-restarted" {
		t.Fatalf("recovered uninstall = %+v %v", current, err)
	}
	if _, err := kernel.Registrations().GetActiveByHandle(ctx, installed.Registration.RegistrationHandle); err != nil {
		t.Fatal(err)
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

func TestCoordinatorStartAndCancelWaitsForCleanupBeforeTerminalState(t *testing.T) {
	coordinator, client, kernel, transport := newInstallFixture(t, false)
	selector := resolveInstallFixture(t, client)
	transport.stallAsset = true
	started, err := coordinator.StartInstall(context.Background(), selector)
	if err != nil {
		t.Fatal(err)
	}
	job := waitForInstallPhase(t, kernel, started.JobID, localappkernel.PackageJobDownloading)
	canceled, err := coordinator.CancelInstall(context.Background(), job.JobID, job.Phase, "user-canceled")
	if err != nil {
		t.Fatal(err)
	}
	if canceled.Phase != localappkernel.PackageJobCanceled || canceled.ReasonCode != "user-canceled" || canceled.Cancelable {
		t.Fatalf("canceled job = %+v", canceled)
	}
	assertInstallDirectoryNames(t, filepath.Join(kernel.DataRoot(), "apps", "packages", packageWorkDirectory), nil)
	assertInstallDirectoryNames(t, filepath.Join(kernel.DataRoot(), "apps", "packages", packageReleaseDirectory), nil)
}

func TestCoordinatorRecoveryFailsInterruptedJobAndPreservesCommittedRelease(t *testing.T) {
	coordinator, client, kernel, _ := newInstallFixture(t, false)
	selector := resolveInstallFixture(t, client)
	installed, err := coordinator.Install(context.Background(), selector)
	if err != nil {
		t.Fatal(err)
	}
	selectorText, _ := selector.Encode()
	steps := uint64(3)
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
	if err := detachInstalledRelease(context.Background(), root, "stage", "final"); !errors.Is(err, ErrReleasePublication) {
		t.Fatalf("uninstall replaced existing final: %v", err)
	}
	if raw, err := os.ReadFile(filepath.Join(rootPath, "final", "sentinel")); err != nil || string(raw) != "existing" {
		t.Fatalf("existing final changed: %q err=%v", raw, err)
	}
	if _, err := os.Stat(filepath.Join(rootPath, "stage")); err != nil {
		t.Fatalf("stage disappeared after rejected publication: %v", err)
	}
}

func TestUninstallDetachWaitsForDirectoryRelease(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		name := "released"
		if cancel {
			name = "canceled"
		}
		t.Run(name, func(t *testing.T) {
			rootPath := t.TempDir()
			sourcePath := filepath.Join(rootPath, "installed")
			if err := os.Mkdir(sourcePath, 0o700); err != nil {
				t.Fatal(err)
			}
			root, err := os.OpenRoot(rootPath)
			if err != nil {
				t.Fatal(err)
			}
			defer root.Close()
			pointer, err := windows.UTF16PtrFromString(sourcePath)
			if err != nil {
				t.Fatal(err)
			}
			handle, err := windows.CreateFile(pointer, windows.FILE_LIST_DIRECTORY, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
			if err != nil {
				t.Fatal(err)
			}
			held := os.NewFile(uintptr(handle), sourcePath)
			defer held.Close()
			if err := publishStagedRelease(root, "installed", "removed"); !isReleaseRenameBusy(err) {
				t.Fatalf("open directory did not block rename: %v", err)
			}
			if cancel {
				ctx, cancelContext := context.WithCancel(context.Background())
				cancelContext()
				if err := detachInstalledRelease(ctx, root, "installed", "removed"); !errors.Is(err, context.Canceled) {
					t.Fatalf("canceled detach error = %v", err)
				}
				if _, err := root.Stat("installed"); err != nil {
					t.Fatalf("canceled detach lost source: %v", err)
				}
				return
			}
			released := make(chan error, 1)
			go func() {
				time.Sleep(150 * time.Millisecond)
				released <- held.Close()
			}()
			detachErr := detachInstalledRelease(context.Background(), root, "installed", "removed")
			if err := <-released; err != nil {
				t.Fatal(err)
			}
			if detachErr != nil {
				t.Fatalf("detach after directory release: %v", detachErr)
			}
			if _, err := root.Stat("removed"); err != nil {
				t.Fatalf("detached directory missing: %v", err)
			}
		})
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
	steps := uint64(3)
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
	if err != nil || recovered.Phase != localappkernel.PackageJobPaused {
		t.Fatalf("unrelated interrupted job=%+v err=%v", recovered, err)
	}
	if _, err := os.Stat(workPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unrelated work was not cleaned: %v", err)
	}
}

func TestRecoveryReopensKernelAndPausesInterruptedJob(t *testing.T) {
	coordinator, client, kernel, _ := newInstallFixture(t, false)
	selector := resolveInstallFixture(t, client)
	selectorText, _ := selector.Encode()
	steps := uint64(3)
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
	if err := Recover(context.Background(), reopenedKernel); err != nil {
		t.Fatal(err)
	}
	recovered, err := reopenedKernel.PackageLifecycle().GetJob(context.Background(), interrupted.JobID)
	if err != nil || recovered.Phase != localappkernel.PackageJobPaused || recovered.ReasonCode != "runtime-interrupted" {
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
	coordinator, err := NewCoordinator(client, kernel, slog.New(slog.NewTextHandler(io.Discard, nil)))
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

func installRegistryDocuments(packageBytes []byte, packageSHA, assetName, assetURL, repository string, versions ...string) map[string][]byte {
	version := installTestVersion
	if len(versions) > 0 {
		version = versions[0]
	}
	commonID := "https://registry.nimi.ai/schema/common.schema.json"
	indexID := "https://registry.nimi.ai/schema/index.schema.json"
	descriptorSchemaID := "https://registry.nimi.ai/schema/approved-descriptor.schema.json"
	descriptorID := installTestAppID + "@" + version
	descriptorPath := "descriptors/" + installTestAppID + "/" + version + ".json"
	tag := "v" + version
	descriptor := map[string]any{
		"schema_version":       1,
		"descriptor_id":        descriptorID,
		"publisher_submission": map[string]any{"pull_number": 7, "path": "submissions/publisher/" + installTestAppID + "/" + version + ".json", "head_sha": installTestSourceCommit},
		"admission": map[string]any{
			"ordinary_release_proof": true, "trust_tier": "community", "build_assurance": "developer-attested",
			"dependency_assurance": map[string]any{"lockfile_reviewed": true, "sbom_ref": nil},
			"review":               map[string]any{"decision": "approved", "adjudicator_login": "maintainer", "adjudicator_actor_id": 42, "reason_code": "approved-review", "decided_at": "2026-09-04T00:00:00Z"},
		},
		"candidate": map[string]any{
			"app_id": installTestAppID, "display_name": "Example App", "version": version,
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

func buildInstallTestPackage(t *testing.T, versions ...string) []byte {
	t.Helper()
	version := installTestVersion
	if len(versions) > 0 {
		version = versions[0]
	}
	executable, err := os.ReadFile(compileInstallTestPE(t))
	if err != nil {
		t.Fatal(err)
	}
	manifest := mustFixtureJSON(map[string]any{
		"format": "nimi.app-package/v1", "app_id": installTestAppID, "version": version,
		"target_id": installTestTargetID, "os": "windows", "arch": "x86_64", "runtime_entry": "payload/example-app.exe",
		"native_trust":      map[string]any{"posture": "production-unsigned", "windows_authenticode": "unsigned", "certificate_subject": nil},
		"execution_profile": map[string]any{"requested_execution_level": "asInvoker", "ui_access": false},
	})
	entries := []installArchiveEntry{
		{name: "LICENSE", bytes: []byte("MIT\n"), mode: 0o644},
		{name: "manifest.json", bytes: manifest, mode: 0o644},
		{name: "nimi.app.yaml", bytes: []byte("app_id: " + installTestAppID + "\nversion: " + version + "\napp_access:\n  - runtime.consume\n"), mode: 0o644},
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

func waitForInstallPhase(
	t *testing.T,
	kernel *localappkernel.Kernel,
	jobID string,
	want localappkernel.PackageJobPhase,
) localappkernel.PackageJob {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		job, err := kernel.PackageLifecycle().GetJob(context.Background(), jobID)
		if err == nil && job.Phase == want {
			return job
		}
		time.Sleep(5 * time.Millisecond)
	}
	job, err := kernel.PackageLifecycle().GetJob(context.Background(), jobID)
	t.Fatalf("job did not reach %s: %+v err=%v", want, job, err)
	return localappkernel.PackageJob{}
}
