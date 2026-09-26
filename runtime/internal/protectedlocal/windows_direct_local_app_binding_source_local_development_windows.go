//go:build windows && nimi_windows_source_local_development

package protectedlocal

import (
	"context"
	"fmt"
	"strconv"
	"time"
)

func BindPlatformDirectLocalAppLaunch(
	launches *DirectLocalAppLaunches,
	launchID Identifier,
	childPID uint32,
	desktopPeer DesktopPeerIdentity,
	bindDeadline time.Time,
) (time.Time, error) {
	return bindWindowsSourceDirectLocalAppLaunch(launches, launchID, childPID, desktopPeer, bindDeadline)
}

func RebindPlatformDirectLocalAppLaunch(
	launches *DirectLocalAppLaunches,
	launchID Identifier,
	childPID uint32,
	desktopPeer DesktopPeerIdentity,
	bindDeadline time.Time,
) (time.Time, error) {
	return bindWindowsSourceDirectLocalAppLaunch(launches, launchID, childPID, desktopPeer, bindDeadline)
}

func bindWindowsSourceDirectLocalAppLaunch(
	launches *DirectLocalAppLaunches,
	launchID Identifier,
	childPID uint32,
	desktopPeer DesktopPeerIdentity,
	bindDeadline time.Time,
) (time.Time, error) {
	if launches == nil || childPID == 0 || desktopPeer.OS != OSWindows ||
		desktopPeer.PID == 0 || desktopPeer.UID == 0 || desktopPeer.AuditSession != desktopPeer.UID {
		return time.Time{}, fmt.Errorf("complete Windows direct local-app launch authority is required")
	}
	launch, ok := launches.Prepared(launchID)
	if !ok {
		return time.Time{}, ErrDirectLocalAppLaunchUnavailable
	}
	if launch.DesktopPID != desktopPeer.PID || launch.ExpectedUID != desktopPeer.UID {
		return time.Time{}, fmt.Errorf("Windows direct local-app launch is unavailable")
	}
	active, err := resolveWindowsActiveSessionIdentity(desktopPeer.AuditSession)
	if err != nil || active.sessionID != desktopPeer.AuditSession {
		return time.Time{}, fmt.Errorf("Windows direct local-app session changed")
	}
	process, liveness, err := inspectWindowsSourceProcess(context.Background(), childPID, active, launch.HostExecutablePath)
	if err != nil {
		return time.Time{}, err
	}
	defer func() { _ = liveness.Close() }()
	if process.parentPID != desktopPeer.PID || process.sessionID != desktopPeer.AuditSession {
		return time.Time{}, fmt.Errorf("Windows direct local-app parent or session mismatch")
	}
	start, err := strconv.ParseUint(process.creationMarker, 16, 64)
	if err != nil || start == 0 {
		return time.Time{}, fmt.Errorf("Windows direct local-app creation marker is invalid")
	}
	witness := DirectLocalAppProcessWitness{
		PID: childPID, ParentPID: process.parentPID, UID: process.sessionID,
		StartSeconds: start, StartMicros: 0, ExecutablePath: process.executablePath,
	}
	return launches.Bind(launchID, witness, desktopPeer.PID, desktopPeer.UID, bindDeadline)
}

func verifyWindowsSourceDirectLocalAppPeer(
	launch DirectLocalAppLaunch,
	process windowsSourceProcessIdentity,
) (DirectLocalAppPeer, error) {
	start, err := strconv.ParseUint(process.creationMarker, 16, 64)
	if err != nil || start == 0 {
		return DirectLocalAppPeer{}, fmt.Errorf("Windows local-app creation marker is invalid")
	}
	witness := DirectLocalAppProcessWitness{
		PID: process.pid, ParentPID: process.parentPID, UID: process.sessionID,
		StartSeconds: start, StartMicros: 0, ExecutablePath: process.executablePath,
	}
	if launch.Process != witness || launch.DesktopPID != process.parentPID || launch.ExpectedUID != process.sessionID {
		return DirectLocalAppPeer{}, fmt.Errorf("Windows local-app peer process witness mismatch")
	}
	if launch.InstalledRegistrationHandle != "" && (launch.InstalledProcess.ExecutableDigest != process.executableDigest ||
		launch.InstalledProcess.CanonicalExecutableIdentity != process.canonicalExecutableIdentity ||
		launch.InstalledProcess.SecurityPrincipal != process.userSID || launch.InstalledProcess.OSLoginSession != process.logonLUID) {
		return DirectLocalAppPeer{}, fmt.Errorf("installed App native peer changed after bind")
	}
	return DirectLocalAppPeer{OS: OSWindows, PID: process.pid, UID: process.sessionID}, nil
}

func RevalidateDirectLocalAppProcess(ctx context.Context, connection *LocalAppConnection) error {
	if connection == nil || !connection.Live() {
		return fmt.Errorf("direct App process is unavailable")
	}
	launch, ok := connection.DirectLaunch()
	if !ok || launch.DesktopOwner == nil || !launch.DesktopOwner.VerifiedDesktopTransport() {
		return fmt.Errorf("direct App supervision is unavailable")
	}
	if err := RevalidateDesktopConnectionProcess(ctx, launch.DesktopOwner); err != nil {
		return err
	}
	desktop, ok := launch.DesktopOwner.DirectDesktopPeer()
	if !ok || desktop.PID != launch.DesktopPID || desktop.UID != launch.ExpectedUID {
		return fmt.Errorf("direct App supervisor changed")
	}
	active, err := resolveWindowsActiveSessionIdentity(desktop.AuditSession)
	if err != nil {
		return err
	}
	process, liveness, err := inspectWindowsSourceProcess(ctx, launch.Process.PID, active, launch.HostExecutablePath)
	if err != nil {
		return err
	}
	defer func() { _ = liveness.Close() }()
	_, err = verifyWindowsSourceDirectLocalAppPeer(launch, process)
	return err
}
