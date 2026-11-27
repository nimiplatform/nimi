//go:build windows

package nimiappinstall

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	_ "modernc.org/sqlite"
)

type controllableTestClock struct {
	mu  sync.Mutex
	now time.Time
}

func newControllableTestClock(start time.Time) *controllableTestClock {
	return &controllableTestClock{now: start.UTC()}
}

func (c *controllableTestClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *controllableTestClock) Advance(delta time.Duration) time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(delta)
	return c.now
}

func (c *controllableTestClock) Set(ts time.Time) time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = ts.UTC()
	return c.now
}

type offlineGraceTransport struct {
	base             *installFixtureTransport
	mu               sync.Mutex
	offline          bool
	delisted         bool
	killSwitchSet    bool
	killSwitchActive bool
	killSwitchRev    uint64
	killSwitchReason string
	revSeq           uint64
	beforeRoundTrip  func(request *http.Request) (*http.Response, error, bool)
}

func (t *offlineGraceTransport) bumpRevisionLocked() {
	t.revSeq++
	t.base.mu.Lock()
	t.base.revision = fmt.Sprintf("%040x", 0x1000+t.revSeq)
	t.base.mu.Unlock()
}

func (t *offlineGraceTransport) setOffline(offline bool) {
	t.mu.Lock()
	t.offline = offline
	t.mu.Unlock()
}

func (t *offlineGraceTransport) setDelisted(delisted bool) {
	t.mu.Lock()
	t.delisted = delisted
	t.bumpRevisionLocked()
	t.mu.Unlock()
}

func (t *offlineGraceTransport) setBlocked(blocked bool) {
	t.mu.Lock()
	t.killSwitchSet = true
	t.killSwitchActive = blocked
	t.killSwitchRev++
	if blocked {
		t.killSwitchReason = "security-review-revoked"
	} else {
		t.killSwitchReason = ""
	}
	t.base.mu.Lock()
	t.base.blocked = false
	t.base.mu.Unlock()
	t.bumpRevisionLocked()
	t.mu.Unlock()
}

func (t *offlineGraceTransport) setKillSwitchState(active bool, rev uint64, reason string) {
	t.mu.Lock()
	t.delisted = false
	t.killSwitchSet = true
	t.killSwitchActive = active
	t.killSwitchRev = rev
	t.killSwitchReason = reason
	t.base.mu.Lock()
	t.base.blocked = false
	t.base.mu.Unlock()
	t.bumpRevisionLocked()
	t.mu.Unlock()
}

func (t *offlineGraceTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	t.mu.Lock()
	hook := t.beforeRoundTrip
	t.mu.Unlock()
	if hook != nil {
		if resp, err, handled := hook(request); handled {
			return resp, err
		}
	}
	t.mu.Lock()
	offline := t.offline
	delisted := t.delisted
	ksSet := t.killSwitchSet
	ksActive := t.killSwitchActive
	ksRev := t.killSwitchRev
	ksReason := t.killSwitchReason
	t.mu.Unlock()
	if offline {
		return nil, errors.New("simulated registry network unreachable")
	}
	if (delisted || ksSet) && request.URL.Host == "raw.githubusercontent.com" {
		t.base.mu.Lock()
		expectedPath := "/nimiplatform/nimi-app-registry/" + t.base.revision + "/index.json"
		raw := t.base.documents["index.json"]
		t.base.mu.Unlock()
		if request.URL.Path == expectedPath {
			var index map[string]any
			if err := json.Unmarshal(raw, &index); err != nil {
				return nil, err
			}
			if delisted {
				index["apps"] = map[string]any{}
			} else if ksSet {
				apps := index["apps"].(map[string]any)
				if row, ok := apps[installTestAppID].(map[string]any); ok {
					var reason any
					if ksActive {
						reason = ksReason
					}
					row["kill_switch"] = map[string]any{
						"active":   ksActive,
						"reason":   reason,
						"revision": ksRev,
					}
				}
			}
			return fixtureHTTPResponse(request, http.StatusOK, mustFixtureJSON(index)), nil
		}
	}
	return t.base.RoundTrip(request)
}

func newOfflineGraceFixture(t *testing.T, clock *controllableTestClock) (*Coordinator, *publicappregistry.Client, *localappkernel.Kernel, *offlineGraceTransport) {
	t.Helper()
	coordinator, _, kernel, baseTransport := newInstallFixture(t, false)
	dataRoot := kernel.DataRoot()
	if err := coordinator.Close(); err != nil {
		t.Fatal(err)
	}
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}
	wrapped := &offlineGraceTransport{base: baseTransport}
	http.DefaultTransport = wrapped
	// Construct a fresh CanonicalClient after installing wrapped http.DefaultTransport.
	client := publicappregistry.NewCanonicalClient()

	reopenedKernel := reopenOfflineGraceKernel(t, dataRoot, clock)
	reopenedCoordinator := reopenOfflineGraceCoordinator(t, client, reopenedKernel, clock)
	return reopenedCoordinator, client, reopenedKernel, wrapped
}

func reopenOfflineGraceKernel(t *testing.T, dataRoot string, clock *controllableTestClock) *localappkernel.Kernel {
	t.Helper()
	identity, err := localappkernel.ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	databasePath, err := localappkernel.CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(context.Background(), databasePath, identity, localappkernel.Options{
		HostInstallID: "install-fixture-host",
		DataRoot:      dataRoot,
		Now:           clock.Now,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	return kernel
}

func reopenOfflineGraceCoordinator(t *testing.T, client *publicappregistry.Client, kernel *localappkernel.Kernel, clock *controllableTestClock) *Coordinator {
	t.Helper()
	coordinator, err := NewCoordinator(client, kernel, slog.New(slog.NewTextHandler(io.Discard, nil)), auditlog.New(64, 16))
	if err != nil {
		t.Fatal(err)
	}
	coordinator.SetClock(clock.Now)
	t.Cleanup(func() { _ = coordinator.Close() })
	return coordinator
}

func TestVerifiedInstalledLaunchUsesStoredApprovalAfterLongOutageAndRestart(t *testing.T) {
	ctx := context.Background()
	start := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
	clock := newControllableTestClock(start)
	coordinator, client, kernel, transport := newOfflineGraceFixture(t, clock)

	selector := resolveInstallFixture(t, client)
	installed, err := coordinator.Install(ctx, selector)
	if err != nil {
		t.Fatalf("install verified app: %v", err)
	}
	handle := installed.Registration.RegistrationHandle
	transport.setOffline(true)
	clock.Advance(30 * 24 * time.Hour)
	dataRoot := kernel.DataRoot()
	if err := coordinator.Close(); err != nil {
		t.Fatal(err)
	}
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}
	kernel = reopenOfflineGraceKernel(t, dataRoot, clock)
	client = publicappregistry.NewCanonicalClient()
	coordinator = reopenOfflineGraceCoordinator(t, client, kernel, clock)

	prepareAndBind := func(t *testing.T) {
		t.Helper()
		callbacks := 0
		useLaunch := func(launch InstalledLaunch) error {
			callbacks++
			if launch.Release.ReleaseRef != installed.Release.ReleaseRef {
				t.Fatalf("launch release = %s, want %s", launch.Release.ReleaseRef, installed.Release.ReleaseRef)
			}
			return nil
		}
		if err := coordinator.PrepareInstalledLaunch(ctx, handle, useLaunch); err != nil {
			t.Fatalf("offline prepare: %v", err)
		}
		if err := coordinator.WithInstalledLaunch(ctx, handle, useLaunch); err != nil {
			t.Fatalf("offline bind: %v", err)
		}
		if callbacks != 2 {
			t.Fatalf("prepare and bind invoked %d callbacks, want 2", callbacks)
		}
	}
	t.Run("past_previous_time_limit", prepareAndBind)
	t.Run("clock_before_approval", func(t *testing.T) {
		clock.Set(start.Add(-time.Hour))
		prepareAndBind(t)
	})

	stored, err := kernel.PackageLifecycle().GetVerifiedPolicy(ctx, installed.Release.AppID, installed.Release.ReleaseRef, selector.DescriptorID(), selector.TargetID())
	if err != nil || stored.Status != localappkernel.VerifiedPolicyAllowed || !stored.VerifiedAt.Equal(start) {
		t.Fatalf("offline use or restart changed approval: %+v err=%v", stored, err)
	}

	transport.setOffline(false)
	reverifiedAt := start.Add(31 * 24 * time.Hour)
	clock.Set(reverifiedAt)
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); err != nil {
		t.Fatalf("online re-verification: %v", err)
	}
	stored, err = kernel.PackageLifecycle().GetVerifiedPolicy(ctx, installed.Release.AppID, installed.Release.ReleaseRef, selector.DescriptorID(), selector.TargetID())
	if err != nil || stored.Status != localappkernel.VerifiedPolicyAllowed || !stored.VerifiedAt.Equal(reverifiedAt) {
		t.Fatalf("online re-verification did not update approval: %+v err=%v", stored, err)
	}

	t.Run("missing_descriptor_is_not_an_outage", func(t *testing.T) {
		transport.mu.Lock()
		transport.bumpRevisionLocked()
		transport.beforeRoundTrip = func(request *http.Request) (*http.Response, error, bool) {
			if request.URL.Host == "raw.githubusercontent.com" && strings.Contains(request.URL.Path, "/descriptors/") {
				return fixtureHTTPResponse(request, http.StatusNotFound, nil), nil, true
			}
			return nil, nil, false
		}
		transport.mu.Unlock()
		if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
			t.Fatal("launch used stored approval despite missing descriptor in current Registry snapshot")
			return nil
		}); !errors.Is(err, publicappregistry.ErrInvalidRegistrySnapshot) {
			t.Fatalf("missing descriptor error = %v, want ErrInvalidRegistrySnapshot", err)
		}
	})
}

func TestVerifiedInstalledLaunchMissingPriorPolicyRecordRequiresOnline(t *testing.T) {
	ctx := context.Background()
	start := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
	clock := newControllableTestClock(start)
	coordinator, client, kernel, transport := newOfflineGraceFixture(t, clock)

	selector := resolveInstallFixture(t, client)
	installed, err := coordinator.Install(ctx, selector)
	if err != nil {
		t.Fatal(err)
	}
	handle := installed.Registration.RegistrationHandle
	dataRoot := kernel.DataRoot()
	databasePath, err := localappkernel.CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}

	// Simulate an existing pre-D1 installation with no row in verified_app_policy_verification.
	if err := coordinator.Close(); err != nil {
		t.Fatal(err)
	}
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}
	rawDB, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rawDB.ExecContext(ctx, `DELETE FROM verified_app_policy_verification`); err != nil {
		_ = rawDB.Close()
		t.Fatal(err)
	}
	if err := rawDB.Close(); err != nil {
		t.Fatal(err)
	}

	kernel = reopenOfflineGraceKernel(t, dataRoot, clock)
	client = publicappregistry.NewCanonicalClient()
	coordinator = reopenOfflineGraceCoordinator(t, client, kernel, clock)

	// Offline launch MUST fail without a verifiable prior policy record.
	transport.setOffline(true)
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
		t.Fatal("launch unexpectedly succeeded with no prior policy record")
		return nil
	}); !errors.Is(err, publicappregistry.ErrRegistryUnavailable) {
		t.Fatalf("missing policy record offline error = %v, want ErrRegistryUnavailable", err)
	}

	// Online verification succeeds and establishes the verification record.
	transport.setOffline(false)
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); err != nil {
		t.Fatalf("online launch after missing record failed: %v", err)
	}

	// The target can now launch while the Registry is unavailable.
	transport.setOffline(true)
	clock.Advance(time.Hour)
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); err != nil {
		t.Fatalf("offline launch after establishing record failed: %v", err)
	}
}

func TestVerifiedInstalledLaunchKnownDenyKillSwitchDelistedAndRevocationBeatGrace(t *testing.T) {
	ctx := context.Background()
	start := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
	clock := newControllableTestClock(start)
	coordinator, client, kernel, transport := newOfflineGraceFixture(t, clock)

	selector := resolveInstallFixture(t, client)
	installed, err := coordinator.Install(ctx, selector)
	if err != nil {
		t.Fatal(err)
	}
	handle := installed.Registration.RegistrationHandle

	// 1. Live kill-switch observed online immediately blocks AND persists deny over prior allow.
	clock.Advance(time.Hour)
	transport.setBlocked(true)
	var blocked *publicappregistry.PolicyBlockedError
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
		t.Fatal("kill-switched app unexpectedly launched online")
		return nil
	}); !errors.As(err, &blocked) {
		t.Fatalf("online kill-switch error = %v, want PolicyBlockedError", err)
	}

	// The observed kill switch still blocks launch when the Registry is unavailable.
	clock.Advance(time.Hour)
	transport.setOffline(true)
	blocked = nil
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
		t.Fatal("kill-switched app unexpectedly bypassed deny offline")
		return nil
	}); !errors.As(err, &blocked) {
		t.Fatalf("offline after known kill-switch error = %v, want PolicyBlockedError", err)
	}

	// Lifting kill-switch online restores launch and updates persisted policy to allowed.
	clock.Advance(time.Hour)
	transport.setBlocked(false)
	transport.setOffline(false)
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); err != nil {
		t.Fatalf("launch after kill-switch lifted failed: %v", err)
	}

	// 2. Live delisted/absent row observed online immediately blocks AND persists row_absent over prior allow.
	clock.Advance(time.Hour)
	transport.setDelisted(true)
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
		t.Fatal("delisted app unexpectedly launched online")
		return nil
	}); !errors.Is(err, publicappregistry.ErrCatalogAppNotFound) {
		t.Fatalf("online delisted error = %v, want ErrCatalogAppNotFound", err)
	}

	// The observed absent row still blocks launch when the Registry is unavailable.
	clock.Advance(time.Hour)
	transport.setOffline(true)
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
		t.Fatal("delisted app unexpectedly bypassed absent row offline")
		return nil
	}); !errors.Is(err, publicappregistry.ErrCatalogAppNotFound) {
		t.Fatalf("offline after known delisted error = %v, want ErrCatalogAppNotFound", err)
	}

	// Restore row online, verify allow, then test offline new install/update rejection + local revocation.
	clock.Advance(time.Hour)
	transport.setDelisted(false)
	transport.setOffline(false)
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); err != nil {
		t.Fatalf("launch after row restored failed: %v", err)
	}

	// 3. New install and update continue requiring live online Registry even while grace is active.
	advanceInstallFixture(t, transport.base, "1.2.4")
	updateSelector := resolveInstallFixture(t, client)
	transport.setOffline(true)
	if _, err := coordinator.StartUpdate(ctx, updateSelector, handle, installTestVersion, func(string) error { return nil }); !errors.Is(err, publicappregistry.ErrRegistryUnavailable) {
		t.Fatalf("offline StartUpdate error = %v, want ErrRegistryUnavailable", err)
	}

	// 4. Installation integrity/identity mismatch immediately blocks while the Registry is offline.
	exePath := installed.Registration.ProjectRoot + `\payload\example-app.exe`
	originalExe, err := os.ReadFile(exePath)
	if err != nil {
		t.Fatal(err)
	}
	tampered := append([]byte(nil), originalExe...)
	tampered[len(tampered)-1] ^= 0xff
	if err := os.WriteFile(exePath, tampered, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
		t.Fatal("tampered executable launched under offline grace")
		return nil
	}); err == nil {
		t.Fatal("expected tampered executable to fail under offline grace")
	}
	if err := os.WriteFile(exePath, originalExe, 0o755); err != nil {
		t.Fatal(err)
	}

	// 5. Local revocation (tombstoned registration) immediately blocks while the Registry is offline.
	if err := kernel.Registrations().Tombstone(ctx, handle); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
		t.Fatal("tombstoned registration launched under offline grace")
		return nil
	}); !errors.Is(err, ErrInstalledLaunch) {
		t.Fatalf("tombstoned offline launch error = %v, want ErrInstalledLaunch", err)
	}
}

func execSQLitePolicyDDL(t *testing.T, dbPath string, statements ...string) {
	t.Helper()
	rawDB, err := sql.Open("sqlite", dbPath+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rawDB.Close() }()
	for _, stmt := range statements {
		if _, err := rawDB.ExecContext(context.Background(), stmt); err != nil {
			t.Fatalf("exec %q: %v", stmt, err)
		}
	}
}

func TestVerifiedInstalledLaunchDenyPersistenceFailureStaysFailClosed(t *testing.T) {
	ctx := context.Background()
	start := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
	clock := newControllableTestClock(start)
	coordinator, client, kernel, transport := newOfflineGraceFixture(t, clock)

	selector := resolveInstallFixture(t, client)
	installed, err := coordinator.Install(ctx, selector)
	if err != nil {
		t.Fatal(err)
	}
	handle := installed.Registration.RegistrationHandle
	dbPath, err := localappkernel.CanonicalRegistrationDatabasePath(kernel.DataRoot())
	if err != nil {
		t.Fatal(err)
	}

	// Inject real SQLite failure on BOTH UPDATE and DELETE so the stale valid
	// Stored approval stays on disk.
	execSQLitePolicyDDL(t, dbPath,
		`CREATE TRIGGER test_fail_policy_update BEFORE UPDATE ON verified_app_policy_verification
		 BEGIN SELECT RAISE(ABORT, 'simulated sqlite write failure'); END`,
		`CREATE TRIGGER test_fail_policy_delete BEFORE DELETE ON verified_app_policy_verification
		 BEGIN SELECT RAISE(ABORT, 'simulated sqlite delete failure'); END`,
	)

	// 1. Observe policy_blocked online while SQLite writes fail.
	clock.Advance(time.Hour)
	transport.setBlocked(true)
	var blocked *publicappregistry.PolicyBlockedError
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
		t.Fatal("kill-switched app unexpectedly launched online")
		return nil
	}); !errors.As(err, &blocked) || blocked.Revision != 1 {
		t.Fatalf("online kill-switch error = %v, want PolicyBlockedError rev=1", err)
	}
	// Stale allow row is still on disk because both UPDATE and DELETE failed.
	onDisk, err := kernel.PackageLifecycle().GetVerifiedPolicy(ctx, installed.Release.AppID, installed.Release.ReleaseRef, selector.DescriptorID(), selector.TargetID())
	if err != nil || onDisk.Status != localappkernel.VerifiedPolicyAllowed {
		t.Fatalf("expected stale allowed row to remain on disk during injected failure, got %+v err=%v", onDisk, err)
	}

	// Going offline MUST STILL immediately return PolicyBlockedError via the in-process deny barrier.
	clock.Advance(time.Hour)
	transport.setOffline(true)
	blocked = nil
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
		t.Fatal("prepare bypassed unpersisted kill-switch offline")
		return nil
	}); !errors.As(err, &blocked) || blocked.Revision != 1 {
		t.Fatalf("offline prepare after failed deny write = %v, want PolicyBlockedError rev=1", err)
	}
	blocked = nil
	if err := coordinator.WithInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
		t.Fatal("bind bypassed unpersisted kill-switch offline")
		return nil
	}); !errors.As(err, &blocked) || blocked.Revision != 1 {
		t.Fatalf("offline bind after failed deny write = %v, want PolicyBlockedError rev=1", err)
	}

	// SQLite recovers: the next check retries persisting the pending deny barrier to disk!
	execSQLitePolicyDDL(t, dbPath,
		`DROP TRIGGER test_fail_policy_update`,
		`DROP TRIGGER test_fail_policy_delete`,
	)
	blocked = nil
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
		t.Fatal("prepare bypassed recovered deny barrier")
		return nil
	}); !errors.As(err, &blocked) || blocked.Revision != 1 {
		t.Fatalf("offline prepare after sqlite recovery = %v, want PolicyBlockedError rev=1", err)
	}
	persisted, err := kernel.PackageLifecycle().GetVerifiedPolicy(ctx, installed.Release.AppID, installed.Release.ReleaseRef, selector.DescriptorID(), selector.TargetID())
	if err != nil || persisted.Status != localappkernel.VerifiedPolicyBlocked || persisted.PolicyRevision != 1 {
		t.Fatalf("pending deny barrier was not persisted after sqlite recovery: %+v err=%v", persisted, err)
	}

	// Lift kill-switch online with strictly incremented PolicyRevision (rev=2).
	clock.Advance(time.Hour)
	transport.setBlocked(false)
	transport.setOffline(false)
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); err != nil {
		t.Fatalf("online launch after kill-switch lift rev=2 failed: %v", err)
	}
	lifted, err := kernel.PackageLifecycle().GetVerifiedPolicy(ctx, installed.Release.AppID, installed.Release.ReleaseRef, selector.DescriptorID(), selector.TargetID())
	if err != nil || lifted.Status != localappkernel.VerifiedPolicyAllowed || lifted.PolicyRevision != 2 {
		t.Fatalf("kill-switch lift did not persist allowed rev=2: %+v err=%v", lifted, err)
	}
	// Offline grace is cleanly restored after rev=2 lift.
	clock.Advance(time.Hour)
	transport.setOffline(true)
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); err != nil {
		t.Fatalf("offline launch after lift failed: %v", err)
	}

	// 2. Repeat real persistence failure for row_absent over a stored approval.
	execSQLitePolicyDDL(t, dbPath,
		`CREATE TRIGGER test_fail_policy_update BEFORE UPDATE ON verified_app_policy_verification
		 BEGIN SELECT RAISE(ABORT, 'simulated sqlite write failure'); END`,
		`CREATE TRIGGER test_fail_policy_delete BEFORE DELETE ON verified_app_policy_verification
		 BEGIN SELECT RAISE(ABORT, 'simulated sqlite delete failure'); END`,
	)
	clock.Advance(time.Hour)
	transport.setOffline(false)
	transport.setDelisted(true)
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
		t.Fatal("delisted app launched online")
		return nil
	}); !errors.Is(err, publicappregistry.ErrCatalogAppNotFound) {
		t.Fatalf("online delisted error = %v, want ErrCatalogAppNotFound", err)
	}
	// Stale allowed row is still on disk; offline launch MUST still return ErrCatalogAppNotFound.
	clock.Advance(time.Hour)
	transport.setOffline(true)
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
		t.Fatal("prepare bypassed unpersisted row_absent offline")
		return nil
	}); !errors.Is(err, publicappregistry.ErrCatalogAppNotFound) {
		t.Fatalf("offline prepare after failed row_absent write = %v, want ErrCatalogAppNotFound", err)
	}
	if err := coordinator.WithInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
		t.Fatal("bind bypassed unpersisted row_absent offline")
		return nil
	}); !errors.Is(err, publicappregistry.ErrCatalogAppNotFound) {
		t.Fatalf("offline bind after failed row_absent write = %v, want ErrCatalogAppNotFound", err)
	}

	// SQLite recovers: next check flushes row_absent to disk.
	execSQLitePolicyDDL(t, dbPath,
		`DROP TRIGGER test_fail_policy_update`,
		`DROP TRIGGER test_fail_policy_delete`,
	)
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
		t.Fatal("prepare bypassed recovered row_absent barrier")
		return nil
	}); !errors.Is(err, publicappregistry.ErrCatalogAppNotFound) {
		t.Fatalf("offline prepare after sqlite recovery = %v, want ErrCatalogAppNotFound", err)
	}
	persisted, err = kernel.PackageLifecycle().GetVerifiedPolicy(ctx, installed.Release.AppID, installed.Release.ReleaseRef, selector.DescriptorID(), selector.TargetID())
	if err != nil || persisted.Status != localappkernel.VerifiedPolicyRowAbsent {
		t.Fatalf("pending row_absent barrier was not persisted after sqlite recovery: %+v err=%v", persisted, err)
	}
}

func TestVerifiedInstalledLaunchOutOfOrderAllowNeverOverwritesNewerDeny(t *testing.T) {
	runCase := func(t *testing.T, mode string) {
		ctx := context.Background()
		start := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
		clock := newControllableTestClock(start)
		coordinator, client, kernel, transport := newOfflineGraceFixture(t, clock)

		selector := resolveInstallFixture(t, client)
		installed, err := coordinator.Install(ctx, selector)
		if err != nil {
			t.Fatal(err)
		}
		handle := installed.Registration.RegistrationHandle
		// Capture the initial allowed revision so Request A fetches that older snapshot.
		transport.base.mu.Lock()
		oldRev := transport.base.revision
		transport.base.mu.Unlock()

		enteredOldFetch := make(chan struct{})
		releaseOldFetch := make(chan struct{})
		var gateUsed atomic.Bool
		transport.mu.Lock()
		transport.beforeRoundTrip = func(request *http.Request) (*http.Response, error, bool) {
			if request.URL.String() == "https://github.com/nimiplatform/nimi-app-registry.git/info/refs?service=git-upload-pack" {
				// Only intercept the very first git-refs call (Request A).
				if gateUsed.CompareAndSwap(false, true) {
					close(enteredOldFetch)
					<-releaseOldFetch
					ref := oldRev + " refs/heads/main\x00object-format=sha1\n"
					adv := fmt.Sprintf("001e# service=git-upload-pack\n0000%04x%s0000", len(ref)+4, ref)
					resp := fixtureHTTPResponse(request, http.StatusOK, []byte(adv))
					resp.Header.Set("Content-Type", "application/x-git-upload-pack-advertisement")
					return resp, nil, true
				}
			}
			// Serve oldRev index/descriptor documents cleanly for Request A even after transport revision moved forward.
			if request.URL.Host == "raw.githubusercontent.com" && strings.HasPrefix(request.URL.Path, "/nimiplatform/nimi-app-registry/"+oldRev+"/") {
				docPath := strings.TrimPrefix(request.URL.Path, "/nimiplatform/nimi-app-registry/"+oldRev+"/")
				transport.base.mu.Lock()
				raw, ok := transport.base.documents[docPath]
				transport.base.mu.Unlock()
				if ok {
					return fixtureHTTPResponse(request, http.StatusOK, raw), nil, true
				}
			}
			return nil, nil, false
		}
		transport.mu.Unlock()

		// Start Request A (older allow), wait until it is paused inside Registry fetch.
		reqADone := make(chan error, 1)
		go func() {
			reqADone <- coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil })
		}()
		<-enteredOldFetch

		// Request B runs while Request A is paused and observes the newer deny.
		if mode == "kill-switch" {
			clock.Advance(time.Minute)
			transport.setBlocked(true)
		} else {
			clock.Advance(-time.Minute)
			transport.setDelisted(true)
		}
		errB := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
			t.Error("Request B unexpectedly allowed")
			return nil
		})
		if mode == "kill-switch" {
			var blocked *publicappregistry.PolicyBlockedError
			if !errors.As(errB, &blocked) || blocked.Revision != 1 {
				t.Fatalf("Request B error = %v, want PolicyBlockedError rev=1", errB)
			}
		} else if !errors.Is(errB, publicappregistry.ErrCatalogAppNotFound) {
			t.Fatalf("Request B error = %v, want ErrCatalogAppNotFound", errB)
		}

		// Now unblock Request A (the stale older allow) and wait for it to finish.
		close(releaseOldFetch)
		errA := <-reqADone
		if mode == "kill-switch" {
			var blocked *publicappregistry.PolicyBlockedError
			if !errors.As(errA, &blocked) {
				t.Fatalf("late Request A error = %v, want PolicyBlockedError", errA)
			}
		} else if !errors.Is(errA, publicappregistry.ErrCatalogAppNotFound) {
			t.Fatalf("late Request A error = %v, want ErrCatalogAppNotFound", errA)
		}

		// DB MUST still hold the deny, and subsequent offline launches MUST remain blocked/absent.
		got, err := kernel.PackageLifecycle().GetVerifiedPolicy(ctx, installed.Release.AppID, installed.Release.ReleaseRef, selector.DescriptorID(), selector.TargetID())
		if err != nil {
			t.Fatal(err)
		}
		if mode == "kill-switch" && (got.Status != localappkernel.VerifiedPolicyBlocked || got.PolicyRevision != 1) {
			t.Fatalf("DB policy after race = %+v, want policy_blocked rev=1", got)
		}
		if mode == "row-absent" && got.Status != localappkernel.VerifiedPolicyRowAbsent {
			t.Fatalf("DB policy after race = %+v, want row_absent", got)
		}

		transport.mu.Lock()
		transport.beforeRoundTrip = nil
		transport.mu.Unlock()
		transport.setOffline(true)
		clock.Advance(time.Minute)
		offlineErr := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
			t.Fatal("offline launch bypassed newer deny after race")
			return nil
		})
		if mode == "kill-switch" {
			var blocked *publicappregistry.PolicyBlockedError
			if !errors.As(offlineErr, &blocked) || blocked.Revision != 1 {
				t.Fatalf("offline error after kill-switch race = %v, want PolicyBlockedError rev=1", offlineErr)
			}
		} else if !errors.Is(offlineErr, publicappregistry.ErrCatalogAppNotFound) {
			t.Fatalf("offline error after row-absent race = %v, want ErrCatalogAppNotFound", offlineErr)
		}

		// Clean lift / restore restores allow and offline grace.
		clock.Advance(time.Minute)
		transport.setOffline(false)
		if mode == "kill-switch" {
			transport.setBlocked(false)
		} else {
			transport.setDelisted(false)
		}
		if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); err != nil {
			t.Fatalf("launch after lift/restore failed: %v", err)
		}
		clock.Advance(time.Minute)
		transport.setOffline(true)
		if err := coordinator.WithInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); err != nil {
			t.Fatalf("offline grace after lift/restore failed: %v", err)
		}
	}

	t.Run("kill-switch", func(t *testing.T) { runCase(t, "kill-switch") })
	t.Run("row-absent", func(t *testing.T) { runCase(t, "row-absent") })
}

func TestVerifiedInstalledLaunchRestartStaleOnlineAllowRespectsPersistedDeny(t *testing.T) {
	t.Run("policy_blocked_lower_and_equal_rev_then_higher_rev_lift", func(t *testing.T) {
		ctx := context.Background()
		start := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
		clock := newControllableTestClock(start)
		coordinator, client, kernel, transport := newOfflineGraceFixture(t, clock)

		selector := resolveInstallFixture(t, client)
		installed, err := coordinator.Install(ctx, selector)
		if err != nil {
			t.Fatal(err)
		}
		handle := installed.Registration.RegistrationHandle
		dataRoot := kernel.DataRoot()
		key := verifiedPolicyKey{
			appID:        installed.Release.AppID,
			releaseRef:   installed.Release.ReleaseRef,
			descriptorID: selector.DescriptorID(),
			targetID:     selector.TargetID(),
		}

		// Persist policy_blocked rev=2 in SQLite.
		clock.Advance(time.Hour)
		transport.setKillSwitchState(true, 2, "security-revoked-v2")
		var blocked *publicappregistry.PolicyBlockedError
		if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
			t.Fatal("blocked app unexpectedly launched before restart")
			return nil
		}); !errors.As(err, &blocked) || blocked.Revision != 2 {
			t.Fatalf("pre-restart block error = %v, want PolicyBlockedError rev=2", err)
		}

		restartCoordinator := func() (*Coordinator, *localappkernel.Kernel) {
			t.Helper()
			if err := coordinator.Close(); err != nil {
				t.Fatal(err)
			}
			if err := kernel.Close(); err != nil {
				t.Fatal(err)
			}
			k := reopenOfflineGraceKernel(t, dataRoot, clock)
			c := reopenOfflineGraceCoordinator(t, publicappregistry.NewCanonicalClient(), k, clock)
			return c, k
		}

		// An official absence after restart provides no evidence of a lift.
		coordinator, kernel = restartCoordinator()
		staleSeq, staleAt := coordinator.BeginPolicyObservation()
		transport.setDelisted(true)
		if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
			t.Fatal("absent App unexpectedly launched")
			return nil
		}); !errors.Is(err, publicappregistry.ErrCatalogAppNotFound) {
			t.Fatalf("confirmed absence returned %v, want ErrCatalogAppNotFound", err)
		}
		// An older in-flight allow cannot use even a higher revision to bypass
		// the more recent missing-row observation.
		blocked = nil
		if err := coordinator.recordVerifiedAllowed(ctx, key, 3, strings.Repeat("f", 40), staleSeq, staleAt); !errors.As(err, &blocked) || blocked.Revision != 2 {
			t.Fatalf("older allow after absence returned %v, want PolicyBlockedError rev=2", err)
		}
		transport.setOffline(true)
		blocked = nil
		if err := coordinator.WithInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
			t.Fatal("missing row displaced a known kill-switch during offline bind")
			return nil
		}); !errors.As(err, &blocked) || blocked.Revision != 2 {
			t.Fatalf("offline bind after absence returned %v, want PolicyBlockedError rev=2", err)
		}
		transport.setOffline(false)

		// Check both stale lower rev (1) and stale equal rev (2) after brand-new restarts
		// (empty in-memory barriers each time).
		for _, staleRev := range []uint64{1, 2} {
			coordinator, kernel = restartCoordinator()
			clock.Advance(10 * time.Minute)
			transport.setKillSwitchState(false, staleRev, "")

			bindCalled := false
			blocked = nil
			err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
				bindCalled = true
				return nil
			})
			if !errors.As(err, &blocked) || blocked.Revision != 2 || blocked.Reason != "security-revoked-v2" {
				t.Fatalf("PrepareInstalledLaunch after restart with stale allow rev=%d: err=%v, want PolicyBlockedError rev=2", staleRev, err)
			}
			if bindCalled {
				t.Fatalf("PrepareInstalledLaunch invoked bind on stale allow rev=%d", staleRev)
			}

			// Verify in-process deny barrier was hydrated from SQLite's effective return.
			coordinator.policyMu.Lock()
			barrier, hydrated := coordinator.policyDenyBarriers[key]
			coordinator.policyMu.Unlock()
			if !hydrated || !barrier.persisted || barrier.status != localappkernel.VerifiedPolicyBlocked || barrier.policyRevision != 2 {
				t.Fatalf("expected hydrated persisted policy_blocked rev=2 barrier after rev=%d, got hydrated=%v barrier=%+v", staleRev, hydrated, barrier)
			}

			// WithInstalledLaunch MUST also reject and never invoke bind.
			blocked = nil
			err = coordinator.WithInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
				bindCalled = true
				return nil
			})
			if !errors.As(err, &blocked) || blocked.Revision != 2 {
				t.Fatalf("WithInstalledLaunch after restart with stale allow rev=%d: err=%v, want PolicyBlockedError rev=2", staleRev, err)
			}
			if bindCalled {
				t.Fatalf("WithInstalledLaunch invoked bind on stale allow rev=%d", staleRev)
			}

			// DB MUST still hold policy_blocked rev=2.
			stored, getErr := kernel.PackageLifecycle().GetVerifiedPolicy(ctx, key.appID, key.releaseRef, key.descriptorID, key.targetID)
			if getErr != nil || stored.Status != localappkernel.VerifiedPolicyBlocked || stored.PolicyRevision != 2 {
				t.Fatalf("DB policy corrupted after stale allow rev=%d: %+v err=%v", staleRev, stored, getErr)
			}
		}

		// Strictly higher-revision lift (rev=3 allowed) after restart MUST restore offline launch.
		coordinator, kernel = restartCoordinator()
		liftTime := clock.Advance(10 * time.Minute)
		transport.setKillSwitchState(false, 3, "")
		prepared := false
		if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
			prepared = true
			return nil
		}); err != nil || !prepared {
			t.Fatalf("higher-rev lift rev=3 after restart failed: err=%v prepared=%v", err, prepared)
		}
		stored, err := kernel.PackageLifecycle().GetVerifiedPolicy(ctx, key.appID, key.releaseRef, key.descriptorID, key.targetID)
		if err != nil || stored.Status != localappkernel.VerifiedPolicyAllowed || stored.PolicyRevision != 3 || !stored.VerifiedAt.Equal(liftTime) {
			t.Fatalf("DB policy after rev=3 lift = %+v err=%v", stored, err)
		}

		// The newly approved target remains usable offline.
		transport.setOffline(true)
		clock.Advance(48 * time.Hour)
		if err := coordinator.WithInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); err != nil {
			t.Fatalf("offline grace after rev=3 lift failed: %v", err)
		}
	})

	t.Run("row_absence_survives_clock_correction_and_restart_until_official_restore", func(t *testing.T) {
		ctx := context.Background()
		start := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
		clock := newControllableTestClock(start)
		coordinator, client, kernel, transport := newOfflineGraceFixture(t, clock)

		selector := resolveInstallFixture(t, client)
		installed, err := coordinator.Install(ctx, selector)
		if err != nil {
			t.Fatal(err)
		}
		handle := installed.Registration.RegistrationHandle
		dataRoot := kernel.DataRoot()
		key := verifiedPolicyKey{
			appID:        installed.Release.AppID,
			releaseRef:   installed.Release.ReleaseRef,
			descriptorID: selector.DescriptorID(),
			targetID:     selector.TargetID(),
		}

		// The old approval was recorded before the host clock was corrected.
		absentAt := clock.Advance(-time.Hour)
		transport.setDelisted(true)
		assertDenied := func() {
			t.Helper()
			for _, launch := range []func(context.Context, string, func(InstalledLaunch) error) error{
				coordinator.PrepareInstalledLaunch, coordinator.WithInstalledLaunch,
			} {
				if err := launch(ctx, handle, func(InstalledLaunch) error {
					t.Fatal("delisted App unexpectedly reached launch callback")
					return nil
				}); !errors.Is(err, publicappregistry.ErrCatalogAppNotFound) {
					t.Fatalf("confirmed Registry absence returned %v, want ErrCatalogAppNotFound", err)
				}
			}
		}
		assertDenied()
		stored, err := kernel.PackageLifecycle().GetVerifiedPolicy(ctx, key.appID, key.releaseRef, key.descriptorID, key.targetID)
		if err != nil || stored.Status != localappkernel.VerifiedPolicyRowAbsent || !stored.VerifiedAt.Equal(absentAt) {
			t.Fatalf("stored policy after clock correction and confirmed absence = %+v, err = %v", stored, err)
		}

		transport.setOffline(true)
		assertDenied()
		if err := coordinator.Close(); err != nil {
			t.Fatal(err)
		}
		if err := kernel.Close(); err != nil {
			t.Fatal(err)
		}
		clock.Advance(-time.Hour)
		kernel = reopenOfflineGraceKernel(t, dataRoot, clock)
		coordinator = reopenOfflineGraceCoordinator(t, publicappregistry.NewCanonicalClient(), kernel, clock)
		assertDenied()

		transport.setDelisted(false)
		assertDenied()
		// Only a successfully verified official restore changes the outcome,
		// even if the corrected clock still puts it before the stored absence.
		transport.setOffline(false)
		if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); err != nil {
			t.Fatalf("official online restore after row absence failed: %v", err)
		}
		transport.setOffline(true)
		clock.Advance(30 * 24 * time.Hour)
		if err := coordinator.WithInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); err != nil {
			t.Fatalf("long offline launch after verified restoration failed: %v", err)
		}
		stored, err = kernel.PackageLifecycle().GetVerifiedPolicy(ctx, key.appID, key.releaseRef, key.descriptorID, key.targetID)
		if err != nil || stored.Status != localappkernel.VerifiedPolicyAllowed {
			t.Fatalf("DB policy after restore = %+v err=%v", stored, err)
		}
	})
}

func TestVerifiedInstalledLaunchConcurrentBanBeforeFinalBindRejectsWithoutBind(t *testing.T) {
	ctx := context.Background()
	start := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
	clock := newControllableTestClock(start)
	coordinator, client, kernel, transport := newOfflineGraceFixture(t, clock)

	selector := resolveInstallFixture(t, client)
	installed, err := coordinator.Install(ctx, selector)
	if err != nil {
		t.Fatal(err)
	}
	handle := installed.Registration.RegistrationHandle
	key := verifiedPolicyKey{
		appID:        installed.Release.AppID,
		releaseRef:   installed.Release.ReleaseRef,
		descriptorID: selector.DescriptorID(),
		targetID:     selector.TargetID(),
	}

	// 1. Concurrent kill-switch recorded after online policy check passes (while VerifyHost runs,
	// before final bind acquires launchMu).
	reverifyAt := clock.Advance(10 * time.Minute)
	coordinator.launchMu.Lock()
	var bindCalled atomic.Bool
	launchDone := make(chan error, 1)
	go func() {
		launchDone <- coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
			bindCalled.Store(true)
			return nil
		})
	}()

	// Wait deterministically until enforceVerifiedInstalledPolicy has persisted the online allow,
	// confirming the goroutine is past online policy check and blocked before final bind.
	deadline := time.Now().Add(5 * time.Second)
	for {
		rec, getErr := kernel.PackageLifecycle().GetVerifiedPolicy(ctx, key.appID, key.releaseRef, key.descriptorID, key.targetID)
		if getErr == nil && rec.Status == localappkernel.VerifiedPolicyAllowed && rec.VerifiedAt.Equal(reverifyAt) {
			break
		}
		if time.Now().After(deadline) {
			coordinator.launchMu.Unlock()
			t.Fatalf("timed out waiting for online policy check to complete before final bind (last rec=%+v err=%v)", rec, getErr)
		}
		time.Sleep(5 * time.Millisecond)
	}

	// Record concurrent kill-switch while VerifyHost / final bind waits on launchMu.
	clock.Advance(time.Minute)
	seq, obsAt := coordinator.BeginPolicyObservation()
	coordinator.RecordObservedCatalogKillSwitch(ctx, installed.Release.AppID, "kill-switch-during-verify", 2, strings.Repeat("f", 40), seq, obsAt)
	coordinator.launchMu.Unlock()

	err = <-launchDone
	var blocked *publicappregistry.PolicyBlockedError
	if !errors.As(err, &blocked) || blocked.Revision != 2 || blocked.Reason != "kill-switch-during-verify" {
		t.Fatalf("PrepareInstalledLaunch after concurrent ban = %v, want PolicyBlockedError rev=2", err)
	}
	if bindCalled.Load() {
		t.Fatal("final bind invoked callback despite concurrent kill-switch before launchMu")
	}

	// 2. Lift to rev=3, then verify a direct SQLite deny (no in-memory barrier) arriving before final bind
	// also fails closed and hydrates the in-memory barrier.
	clock.Advance(time.Minute)
	transport.setKillSwitchState(false, 3, "")
	if err := coordinator.PrepareInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); err != nil {
		t.Fatalf("lift to rev=3 failed: %v", err)
	}
	reverifyAt2 := clock.Advance(10 * time.Minute)
	coordinator.launchMu.Lock()
	bindCalled.Store(false)
	launchDone2 := make(chan error, 1)
	go func() {
		launchDone2 <- coordinator.WithInstalledLaunch(ctx, handle, func(InstalledLaunch) error {
			bindCalled.Store(true)
			return nil
		})
	}()
	deadline = time.Now().Add(5 * time.Second)
	for {
		rec, getErr := kernel.PackageLifecycle().GetVerifiedPolicy(ctx, key.appID, key.releaseRef, key.descriptorID, key.targetID)
		if getErr == nil && rec.Status == localappkernel.VerifiedPolicyAllowed && rec.VerifiedAt.Equal(reverifyAt2) {
			break
		}
		if time.Now().After(deadline) {
			coordinator.launchMu.Unlock()
			t.Fatalf("timed out waiting for second online policy check (last rec=%+v err=%v)", rec, getErr)
		}
		time.Sleep(5 * time.Millisecond)
	}
	banAt := clock.Advance(time.Minute)
	if _, err := kernel.PackageLifecycle().RecordVerifiedPolicy(ctx, localappkernel.VerifiedPolicyVerification{
		AppID:          key.appID,
		ReleaseRef:     key.releaseRef,
		DescriptorID:   key.descriptorID,
		TargetID:       key.targetID,
		Status:         localappkernel.VerifiedPolicyBlocked,
		PolicyReason:   "db-ban-before-bind",
		PolicyRevision: 4,
		VerifiedAt:     banAt,
		ObservedAt:     banAt,
	}); err != nil {
		coordinator.launchMu.Unlock()
		t.Fatal(err)
	}
	coordinator.launchMu.Unlock()

	err = <-launchDone2
	blocked = nil
	if !errors.As(err, &blocked) || blocked.Revision != 4 || blocked.Reason != "db-ban-before-bind" {
		t.Fatalf("WithInstalledLaunch after concurrent DB ban = %v, want PolicyBlockedError rev=4", err)
	}
	if bindCalled.Load() {
		t.Fatal("final bind invoked callback despite concurrent DB deny before launchMu")
	}
	coordinator.policyMu.Lock()
	hydratedBarrier, hasHydrated := coordinator.policyDenyBarriers[key]
	coordinator.policyMu.Unlock()
	if !hasHydrated || !hydratedBarrier.persisted || hydratedBarrier.policyRevision != 4 {
		t.Fatalf("expected final bind DB check to hydrate rev=4 barrier, got has=%v barrier=%+v", hasHydrated, hydratedBarrier)
	}
}

func TestVerifiedPolicyProbeBudgetLeavesOfflineHeadroom(t *testing.T) {
	cases := []struct {
		remaining time.Duration
		want      time.Duration
	}{
		{remaining: 0, want: 0},
		{remaining: -time.Second, want: 0},
		{remaining: 300 * time.Millisecond, want: 150 * time.Millisecond},
		{remaining: 3 * time.Second, want: 1500 * time.Millisecond},
		{remaining: 4 * time.Second, want: 2 * time.Second},
		{remaining: 6 * time.Second, want: 4 * time.Second},
		{remaining: 12 * time.Second, want: 10 * time.Second},
		{remaining: 15 * time.Second, want: 10 * time.Second},
	}
	for _, tc := range cases {
		got := verifiedPolicyProbeBudget(tc.remaining)
		if got != tc.want {
			t.Fatalf("verifiedPolicyProbeBudget(%v) = %v, want %v", tc.remaining, got, tc.want)
		}
		if tc.remaining > 0 && got >= tc.remaining {
			t.Fatalf("verifiedPolicyProbeBudget(%v) = %v did not leave headroom", tc.remaining, got)
		}
	}
}

func TestVerifiedInstalledLaunchStalledRegistryUnderDeadlineFallsBackToOfflineGrace(t *testing.T) {
	ctx := context.Background()
	start := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
	clock := newControllableTestClock(start)
	coordinator, client, kernel, transport := newOfflineGraceFixture(t, clock)

	selector := resolveInstallFixture(t, client)
	installed, err := coordinator.Install(ctx, selector)
	if err != nil {
		t.Fatalf("install verified app: %v", err)
	}
	handle := installed.Registration.RegistrationHandle
	clock.Advance(2 * time.Hour)

	// Simulate a stalled Registry whose network latency exceeds the caller's deadline:
	// the request blocks until its probe context expires or is canceled.
	var probeEntered chan struct{}
	var probeEnteredMu sync.Mutex
	var lastProbeDeadline atomic.Int64
	transport.mu.Lock()
	transport.beforeRoundTrip = func(request *http.Request) (*http.Response, error, bool) {
		if dl, ok := request.Context().Deadline(); ok {
			lastProbeDeadline.Store(dl.UnixNano())
		} else {
			lastProbeDeadline.Store(0)
		}
		probeEnteredMu.Lock()
		ch := probeEntered
		probeEnteredMu.Unlock()
		if ch != nil {
			select {
			case ch <- struct{}{}:
			default:
			}
		}
		<-request.Context().Done()
		return nil, request.Context().Err(), true
	}
	transport.mu.Unlock()

	// 1. Both PrepareInstalledLaunch and WithInstalledLaunch under a short parent deadline
	// (modeling the 15s rebind deadline vs 15s Registry timeout) MUST bound the probe and
	// succeed using stored approval before the parent deadline expires.
	for _, mode := range []string{"prepare", "bind"} {
		t.Run("stalled_registry_"+mode, func(t *testing.T) {
			parentCtx, parentCancel := context.WithTimeout(ctx, 400*time.Millisecond)
			defer parentCancel()
			parentDeadline, _ := parentCtx.Deadline()

			var runErr error
			if mode == "prepare" {
				runErr = coordinator.PrepareInstalledLaunch(parentCtx, handle, func(InstalledLaunch) error { return nil })
			} else {
				runErr = coordinator.WithInstalledLaunch(parentCtx, handle, func(InstalledLaunch) error { return nil })
			}
			if runErr != nil {
				t.Fatalf("%s under stalled Registry failed: %v (parent ctx.Err=%v)", mode, runErr, parentCtx.Err())
			}
			probeDL := time.Unix(0, lastProbeDeadline.Load())
			if !probeDL.Before(parentDeadline) {
				t.Fatalf("probe deadline %v was not strictly shorter than parent deadline %v", probeDL, parentDeadline)
			}
			stored, getErr := kernel.PackageLifecycle().GetVerifiedPolicy(ctx, installed.Release.AppID, installed.Release.ReleaseRef, selector.DescriptorID(), selector.TargetID())
			if getErr != nil || !stored.VerifiedAt.Equal(start) {
				t.Fatalf("stalled Registry offline grace renewed VerifiedAt: %+v err=%v", stored, getErr)
			}
		})
	}

	// 2. Explicit parent cancellation MUST still fail closed immediately without offline grace.
	t.Run("explicit_parent_cancellation_fails_closed", func(t *testing.T) {
		entered := make(chan struct{}, 1)
		probeEnteredMu.Lock()
		probeEntered = entered
		probeEnteredMu.Unlock()
		defer func() {
			probeEnteredMu.Lock()
			probeEntered = nil
			probeEnteredMu.Unlock()
		}()

		parentCtx, parentCancel := context.WithTimeout(ctx, 2*time.Second)
		defer parentCancel()
		var bindCalled atomic.Bool
		errCh := make(chan error, 1)
		go func() {
			errCh <- coordinator.WithInstalledLaunch(parentCtx, handle, func(InstalledLaunch) error {
				bindCalled.Store(true)
				return nil
			})
		}()
		select {
		case <-entered:
		case <-time.After(time.Second):
			t.Fatal("stalled Registry probe did not start")
		}
		parentCancel()

		runErr := <-errCh
		if !errors.Is(runErr, context.Canceled) {
			t.Fatalf("explicit parent cancellation error = %v, want context.Canceled", runErr)
		}
		if bindCalled.Load() {
			t.Fatal("explicit parent cancellation unexpectedly invoked bind via offline grace")
		}
	})

	// 3. Known persisted ban (policy_blocked and row_absent) MUST still fail closed under stalled Registry.
	t.Run("known_bans_under_stalled_registry_fail_closed", func(t *testing.T) {
		// Record known kill-switch online first, then re-enable stall.
		transport.mu.Lock()
		stallHook := transport.beforeRoundTrip
		transport.beforeRoundTrip = nil
		transport.mu.Unlock()

		clock.Advance(time.Hour)
		transport.setKillSwitchState(true, 2, "stalled-ban-check")
		var blocked *publicappregistry.PolicyBlockedError
		if err := coordinator.WithInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); !errors.As(err, &blocked) {
			t.Fatalf("seed kill-switch error = %v, want PolicyBlockedError", err)
		}

		transport.mu.Lock()
		transport.beforeRoundTrip = stallHook
		transport.mu.Unlock()
		parentCtx, parentCancel := context.WithTimeout(ctx, 400*time.Millisecond)
		defer parentCancel()
		blocked = nil
		if err := coordinator.WithInstalledLaunch(parentCtx, handle, func(InstalledLaunch) error {
			t.Fatal("known kill-switch bypassed under stalled Registry")
			return nil
		}); !errors.As(err, &blocked) || blocked.Revision != 2 {
			t.Fatalf("stalled Registry with known kill-switch = %v, want PolicyBlockedError rev=2", err)
		}

		// Lift the explicit block before exercising a standalone missing row.
		transport.mu.Lock()
		transport.beforeRoundTrip = nil
		transport.mu.Unlock()
		clock.Advance(time.Hour)
		transport.setKillSwitchState(false, 3, "")
		if err := coordinator.WithInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); err != nil {
			t.Fatalf("lift prior kill-switch: %v", err)
		}
		transport.setDelisted(true)
		if err := coordinator.WithInstalledLaunch(ctx, handle, func(InstalledLaunch) error { return nil }); !errors.Is(err, publicappregistry.ErrCatalogAppNotFound) {
			t.Fatalf("seed delisted error = %v, want ErrCatalogAppNotFound", err)
		}

		transport.mu.Lock()
		transport.beforeRoundTrip = stallHook
		transport.mu.Unlock()
		parentCtx2, parentCancel2 := context.WithTimeout(ctx, 400*time.Millisecond)
		defer parentCancel2()
		if err := coordinator.WithInstalledLaunch(parentCtx2, handle, func(InstalledLaunch) error {
			t.Fatal("known row_absent bypassed under stalled Registry")
			return nil
		}); !errors.Is(err, publicappregistry.ErrCatalogAppNotFound) {
			t.Fatalf("stalled Registry with known row_absent = %v, want ErrCatalogAppNotFound", err)
		}
	})
}
