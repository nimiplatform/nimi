package protectedlocal

import (
	"crypto/rand"
	"fmt"
	"sync"
	"time"
)

// DirectLocalAppPeer is the minimal native identity retained for a macOS
// local-app connection after the Unix peer has been checked.
type DirectLocalAppPeer struct {
	OS  OperatingSystem
	PID uint32
	UID uint32
}

func (peer DirectLocalAppPeer) valid() bool {
	return peer.OS == OSMacOS && peer.PID != 0 && peer.UID != 0
}

// DirectLocalAppLaunch is the one-time Runtime-owned association needed to
// join a Desktop-prepared launch to a Unix socket peer. It is in-memory only.
type DirectLocalAppLaunch struct {
	LaunchID              Identifier
	RegistrationHandle    Identifier
	SupervisorRunID       Identifier
	SourceGeneration      uint64
	DeclarationGeneration uint64
	DesktopPID            uint32
	ExpectedUID           uint32
	ChildPID              uint32
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
		!launch.ExpiresAt.IsZero()
}

// DirectLocalAppLaunches owns the single in-memory prepared-launch map used by
// the macOS direct peer path. It creates no durable launch, process, session,
// boot-epoch, or proof record.
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
	expiresAt time.Time,
) (DirectLocalAppLaunch, error) {
	if launches == nil || registrationHandle == (Identifier{}) || supervisorRunID == (Identifier{}) ||
		sourceGeneration == 0 || declarationGeneration == 0 || desktopPID == 0 || expectedUID == 0 ||
		expiresAt.IsZero() {
		return DirectLocalAppLaunch{}, fmt.Errorf("complete direct local-app launch authority is required")
	}
	now := launches.now().UTC()
	expiresAt = expiresAt.UTC()
	if !now.Before(expiresAt) {
		return DirectLocalAppLaunch{}, fmt.Errorf("direct local-app launch deadline has expired")
	}
	launchID, err := readIdentifier(rand.Reader)
	if err != nil {
		return DirectLocalAppLaunch{}, fmt.Errorf("generate direct local-app launch identifier: %w", err)
	}
	launch := DirectLocalAppLaunch{
		LaunchID: launchID, RegistrationHandle: registrationHandle, SupervisorRunID: supervisorRunID,
		SourceGeneration: sourceGeneration, DeclarationGeneration: declarationGeneration,
		DesktopPID: desktopPID, ExpectedUID: expectedUID, ExpiresAt: expiresAt,
	}
	launches.mu.Lock()
	defer launches.mu.Unlock()
	launches.removeExpiredLocked(now)
	launches.byLaunch[launchID] = &launch
	return launch, nil
}

func (launches *DirectLocalAppLaunches) Bind(
	launchID Identifier,
	childPID uint32,
	desktopPID uint32,
	expectedUID uint32,
	bindDeadline time.Time,
) (time.Time, error) {
	if launches == nil || launchID == (Identifier{}) || childPID == 0 || desktopPID == 0 ||
		expectedUID == 0 || bindDeadline.IsZero() {
		return time.Time{}, fmt.Errorf("complete direct local-app process binding is required")
	}
	now := launches.now().UTC()
	bindDeadline = bindDeadline.UTC()
	launches.mu.Lock()
	defer launches.mu.Unlock()
	launches.removeExpiredLocked(now)
	pending := launches.byLaunch[launchID]
	if pending == nil || pending.ChildPID != 0 || launches.byPID[childPID] != nil ||
		pending.DesktopPID != desktopPID || pending.ExpectedUID != expectedUID ||
		!now.Before(bindDeadline) || bindDeadline.After(pending.ExpiresAt) {
		return time.Time{}, fmt.Errorf("direct local-app launch does not admit this process")
	}
	pending.ChildPID = childPID
	pending.BindDeadline = bindDeadline
	launches.byPID[childPID] = pending
	return bindDeadline, nil
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
	if pending == nil || pending.ChildPID != childPID || pending.ExpectedUID != uid ||
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
	if pending.ChildPID != 0 {
		delete(launches.byPID, pending.ChildPID)
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
		if pending.ChildPID != 0 {
			delete(launches.byPID, pending.ChildPID)
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
		if pending.ChildPID != 0 {
			delete(launches.byPID, pending.ChildPID)
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
		if pending.ChildPID != 0 {
			delete(launches.byPID, pending.ChildPID)
		}
	}
}
