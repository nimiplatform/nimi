//go:build darwin && cgo

package protectedlocal

import (
	"fmt"
	"time"
)

// BindDirectLocalAppLaunch snapshots and verifies the exact start-suspended
// Desktop child before any App code can run.
func BindMacOSDirectLocalAppLaunch(
	launches *DirectLocalAppLaunches,
	launchID Identifier,
	childPID uint32,
	desktopPID uint32,
	expectedUID uint32,
	bindDeadline time.Time,
) (time.Time, error) {
	return bindMacOSDirectLocalAppLaunch(launches, launchID, childPID, desktopPID, expectedUID, bindDeadline, true)
}

// RebindMacOSDirectLocalAppLaunch captures a fresh PID-reuse-safe witness for
// the already-running exact Desktop child after source D2 Runtime loss.
func RebindMacOSDirectLocalAppLaunch(
	launches *DirectLocalAppLaunches,
	launchID Identifier,
	childPID uint32,
	desktopPID uint32,
	expectedUID uint32,
	bindDeadline time.Time,
) (time.Time, error) {
	return bindMacOSDirectLocalAppLaunch(launches, launchID, childPID, desktopPID, expectedUID, bindDeadline, false)
}

func bindMacOSDirectLocalAppLaunch(
	launches *DirectLocalAppLaunches,
	launchID Identifier,
	childPID uint32,
	desktopPID uint32,
	expectedUID uint32,
	bindDeadline time.Time,
	requireSuspended bool,
) (time.Time, error) {
	if launches == nil || childPID == 0 {
		return time.Time{}, fmt.Errorf("direct local-app security state is unavailable")
	}
	launch, ok := launches.Prepared(launchID)
	if !ok || launch.DesktopPID != desktopPID || launch.ExpectedUID != expectedUID {
		return time.Time{}, fmt.Errorf("direct local-app launch is unavailable")
	}
	snapshot, err := inspectMacOSProcess(childPID)
	if err != nil {
		return time.Time{}, err
	}
	policy, err := macOSDirectLocalAppBindingCodePolicy()
	if err != nil {
		return time.Time{}, err
	}
	if _, err := verifyMacOSProcessIdentity(snapshot, nil, policy, launch.HostExecutablePath, desktopPID, requireSuspended); err != nil {
		return time.Time{}, err
	}
	witness := DirectLocalAppProcessWitness{
		PID: snapshot.pid, ParentPID: snapshot.parentPID, UID: snapshot.euid,
		StartSeconds: snapshot.startSeconds, StartMicros: snapshot.startMicros, ExecutablePath: snapshot.executablePath,
	}
	return launches.Bind(launchID, witness, desktopPID, expectedUID, bindDeadline)
}
