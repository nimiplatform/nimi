package protectedlocal

import (
	"crypto/rand"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// DirectLocalAppPeer is the minimal native identity retained after a per-user
// local endpoint peer has been checked.
type DirectLocalAppPeer struct {
	OS  OperatingSystem
	PID uint32
	UID uint32
}

func (peer DirectLocalAppPeer) valid() bool {
	return (peer.OS == OSMacOS || peer.OS == OSWindows) && peer.PID != 0 && peer.UID != 0
}

// DirectLocalAppProcessWitness is captured from the kernel while the exact
// Desktop child is still start-suspended. The later socket peer must match the
// same start tuple, preventing PID reuse from inheriting a prepared launch.
type DirectLocalAppProcessWitness struct {
	PID            uint32
	ParentPID      uint32
	UID            uint32
	StartSeconds   uint64
	StartMicros    uint64
	ExecutablePath string
}

func (witness DirectLocalAppProcessWitness) valid() bool {
	return witness.PID != 0 && witness.ParentPID != 0 && witness.UID != 0 &&
		witness.StartSeconds != 0 && witness.StartMicros < 1_000_000 &&
		filepath.IsAbs(witness.ExecutablePath) &&
		witness.ExecutablePath == filepath.Clean(strings.TrimSpace(witness.ExecutablePath))
}

// DirectLocalAppLaunch is the one-time Runtime-owned association needed to
// join a Desktop-prepared launch to a native local-endpoint peer. It is
// in-memory only.
type DirectLocalAppLaunch struct {
	LaunchID              Identifier
	RegistrationHandle    Identifier
	SupervisorRunID       Identifier
	SourceGeneration      uint64
	DeclarationGeneration uint64
	DesktopPID            uint32
	ExpectedUID           uint32
	HostExecutablePath    string
	Process               DirectLocalAppProcessWitness
	ExpiresAt             time.Time
	BindDeadline          time.Time
}

func (launch DirectLocalAppLaunch) valid() bool {
	return launch.LaunchID != (Identifier{}) &&
		launch.RegistrationHandle != (Identifier{}) &&
		launch.SupervisorRunID != (Identifier{}) &&
		launch.SourceGeneration != 0 &&
		launch.DeclarationGeneration != 0 &&
		launch.DesktopPID != 0 &&
		launch.ExpectedUID != 0 &&
		filepath.IsAbs(launch.HostExecutablePath) &&
		launch.HostExecutablePath == filepath.Clean(strings.TrimSpace(launch.HostExecutablePath)) &&
		launch.Process.valid() && launch.Process.ParentPID == launch.DesktopPID &&
		launch.Process.UID == launch.ExpectedUID && launch.Process.ExecutablePath == launch.HostExecutablePath &&
		!launch.ExpiresAt.IsZero()
}

// DirectLocalAppLaunches owns the single common in-memory prepared-launch map
// used by per-user native peer adapters. It creates no durable launch, process,
// session, boot-epoch, or proof record.
type DirectLocalAppLaunches struct {
	mu       sync.Mutex
	now      func() time.Time
	byLaunch map[Identifier]*DirectLocalAppLaunch
	byPID    map[uint32]*DirectLocalAppLaunch
}

func NewDirectLocalAppLaunches() *DirectLocalAppLaunches {
	return &DirectLocalAppLaunches{
		now:      time.Now,
		byLaunch: make(map[Identifier]*DirectLocalAppLaunch),
		byPID:    make(map[uint32]*DirectLocalAppLaunch),
	}
}

func (launches *DirectLocalAppLaunches) Prepare(
	registrationHandle Identifier,
	supervisorRunID Identifier,
	sourceGeneration uint64,
	declarationGeneration uint64,
	desktopPID uint32,
	expectedUID uint32,
	hostExecutablePath string,
	expiresAt time.Time,
) (DirectLocalAppLaunch, error) {
	hostExecutablePath = filepath.Clean(strings.TrimSpace(hostExecutablePath))
	if launches == nil || registrationHandle == (Identifier{}) || supervisorRunID == (Identifier{}) ||
		sourceGeneration == 0 || declarationGeneration == 0 || desktopPID == 0 || expectedUID == 0 ||
		!filepath.IsAbs(hostExecutablePath) || expiresAt.IsZero() {
		return DirectLocalAppLaunch{}, fmt.Errorf("complete direct local-app launch authority is required")
	}
	now := launches.now().UTC()
	expiresAt = expiresAt.UTC()
	if !now.Before(expiresAt) {
		return DirectLocalAppLaunch{}, fmt.Errorf("direct local-app launch deadline has expired")
	}
	launches.mu.Lock()
	defer launches.mu.Unlock()
	launches.removeExpiredLocked(now)
	for _, pending := range launches.byLaunch {
		if pending.RegistrationHandle != registrationHandle || pending.SupervisorRunID != supervisorRunID {
			continue
		}
		if pending.SourceGeneration != sourceGeneration || pending.DeclarationGeneration != declarationGeneration ||
			pending.DesktopPID != desktopPID || pending.ExpectedUID != expectedUID ||
			pending.HostExecutablePath != hostExecutablePath {
			return DirectLocalAppLaunch{}, fmt.Errorf("existing direct local-app launch no longer matches current authority")
		}
		return *pending, nil
	}
	launchID, err := readIdentifier(rand.Reader)
	if err != nil {
		return DirectLocalAppLaunch{}, fmt.Errorf("generate direct local-app launch identifier: %w", err)
	}
	launch := DirectLocalAppLaunch{
		LaunchID: launchID, RegistrationHandle: registrationHandle, SupervisorRunID: supervisorRunID,
		SourceGeneration: sourceGeneration, DeclarationGeneration: declarationGeneration,
		DesktopPID: desktopPID, ExpectedUID: expectedUID, HostExecutablePath: hostExecutablePath,
		ExpiresAt: expiresAt,
	}
	launches.byLaunch[launchID] = &launch
	return launch, nil
}

func (launches *DirectLocalAppLaunches) Prepared(launchID Identifier) (DirectLocalAppLaunch, bool) {
	if launches == nil || launchID == (Identifier{}) {
		return DirectLocalAppLaunch{}, false
	}
	launches.mu.Lock()
	defer launches.mu.Unlock()
	launches.removeExpiredLocked(time.Now())
	pending := launches.byLaunch[launchID]
	if pending == nil {
		return DirectLocalAppLaunch{}, false
	}
	return *pending, true
}

func (launches *DirectLocalAppLaunches) Bind(
	launchID Identifier,
	process DirectLocalAppProcessWitness,
	desktopPID uint32,
	expectedUID uint32,
	bindDeadline time.Time,
) (time.Time, error) {
	if launches == nil || launchID == (Identifier{}) || !process.valid() || desktopPID == 0 ||
		expectedUID == 0 || bindDeadline.IsZero() {
		return time.Time{}, fmt.Errorf("complete direct local-app process binding is required")
	}
	now := launches.now().UTC()
	bindDeadline = bindDeadline.UTC()
	launches.mu.Lock()
	defer launches.mu.Unlock()
	launches.removeExpiredLocked(now)
	pending := launches.byLaunch[launchID]
	if pending == nil || pending.DesktopPID != desktopPID || pending.ExpectedUID != expectedUID ||
		process.ParentPID != desktopPID || process.UID != expectedUID ||
		process.ExecutablePath != pending.HostExecutablePath ||
		!now.Before(bindDeadline) || bindDeadline.After(pending.ExpiresAt) {
		return time.Time{}, fmt.Errorf("direct local-app launch does not admit this process")
	}
	if pending.Process.valid() {
		if pending.Process != process || launches.byPID[process.PID] != pending {
			return time.Time{}, fmt.Errorf("direct local-app process binding changed")
		}
		return pending.BindDeadline, nil
	}
	if launches.byPID[process.PID] != nil {
		return time.Time{}, fmt.Errorf("direct local-app process is already bound")
	}
	pending.Process = process
	pending.BindDeadline = bindDeadline
	launches.byPID[process.PID] = pending
	return bindDeadline, nil
}

func (launches *DirectLocalAppLaunches) Bound(childPID uint32, uid uint32) (DirectLocalAppLaunch, bool) {
	if launches == nil || childPID == 0 || uid == 0 {
		return DirectLocalAppLaunch{}, false
	}
	now := launches.now().UTC()
	launches.mu.Lock()
	defer launches.mu.Unlock()
	launches.removeExpiredLocked(now)
	pending := launches.byPID[childPID]
	if pending == nil || pending.Process.PID != childPID || pending.ExpectedUID != uid ||
		pending.BindDeadline.IsZero() || !now.Before(pending.BindDeadline) || !pending.valid() {
		return DirectLocalAppLaunch{}, false
	}
	return *pending, true
}

func (launches *DirectLocalAppLaunches) Consume(childPID uint32, uid uint32) (DirectLocalAppLaunch, error) {
	if launches == nil || childPID == 0 || uid == 0 {
		return DirectLocalAppLaunch{}, fmt.Errorf("connected direct local-app peer is required")
	}
	now := launches.now().UTC()
	launches.mu.Lock()
	defer launches.mu.Unlock()
	launches.removeExpiredLocked(now)
	pending := launches.byPID[childPID]
	if pending == nil || pending.Process.PID != childPID || pending.ExpectedUID != uid ||
		pending.BindDeadline.IsZero() || !now.Before(pending.BindDeadline) || !pending.valid() {
		return DirectLocalAppLaunch{}, fmt.Errorf("connected direct local-app peer has no prepared launch")
	}
	delete(launches.byPID, childPID)
	delete(launches.byLaunch, pending.LaunchID)
	return *pending, nil
}

func (launches *DirectLocalAppLaunches) Revoke(launchID Identifier) {
	if launches == nil || launchID == (Identifier{}) {
		return
	}
	launches.mu.Lock()
	defer launches.mu.Unlock()
	pending := launches.byLaunch[launchID]
	if pending == nil {
		return
	}
	delete(launches.byLaunch, launchID)
	if pending.Process.PID != 0 {
		delete(launches.byPID, pending.Process.PID)
	}
}

func (launches *DirectLocalAppLaunches) RevokeRun(registrationHandle Identifier, supervisorRunID Identifier) {
	if launches == nil || registrationHandle == (Identifier{}) || supervisorRunID == (Identifier{}) {
		return
	}
	launches.mu.Lock()
	defer launches.mu.Unlock()
	for launchID, pending := range launches.byLaunch {
		if pending.RegistrationHandle != registrationHandle || pending.SupervisorRunID != supervisorRunID {
			continue
		}
		delete(launches.byLaunch, launchID)
		if pending.Process.PID != 0 {
			delete(launches.byPID, pending.Process.PID)
		}
	}
}

func (launches *DirectLocalAppLaunches) RevokeRegistration(registrationHandle Identifier) {
	if launches == nil || registrationHandle == (Identifier{}) {
		return
	}
	launches.mu.Lock()
	defer launches.mu.Unlock()
	for launchID, pending := range launches.byLaunch {
		if pending.RegistrationHandle != registrationHandle {
			continue
		}
		delete(launches.byLaunch, launchID)
		if pending.Process.PID != 0 {
			delete(launches.byPID, pending.Process.PID)
		}
	}
}

func (launches *DirectLocalAppLaunches) removeExpiredLocked(now time.Time) {
	for launchID, pending := range launches.byLaunch {
		deadline := pending.ExpiresAt
		if !pending.BindDeadline.IsZero() && pending.BindDeadline.Before(deadline) {
			deadline = pending.BindDeadline
		}
		if now.Before(deadline) {
			continue
		}
		delete(launches.byLaunch, launchID)
		if pending.Process.PID != 0 {
			delete(launches.byPID, pending.Process.PID)
		}
	}
}
