//go:build darwin && cgo

package protectedlocal

import (
	"context"
	"fmt"
)

// RevalidateDirectLocalAppProcess reuses the still-live transport's captured
// witness and compares it with current native process and code evidence.
func RevalidateDirectLocalAppProcess(ctx context.Context, connection *LocalAppConnection) error {
	if connection == nil || !connection.Live() || connection.revalidateProcess == nil {
		return fmt.Errorf("current direct App process verifier is unavailable")
	}
	launch, ok := connection.DirectLaunch()
	if !ok || launch.DesktopOwner == nil {
		return fmt.Errorf("direct App supervision is unavailable")
	}
	if err := RevalidateDesktopConnectionProcess(ctx, launch.DesktopOwner); err != nil {
		return err
	}
	return connection.revalidateProcess(ctx)
}

func RevalidateDesktopConnectionProcess(ctx context.Context, owner *Connection) error {
	if owner == nil || !owner.VerifiedDesktopTransport() || owner.revalidateProcess == nil {
		return fmt.Errorf("current Desktop process verifier is unavailable")
	}
	return owner.revalidateProcess(ctx)
}

func VerifyLocalAppProcessParent(ctx context.Context, pid uint32, owner *Connection) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if owner == nil || !owner.VerifiedDesktopTransport() {
		return fmt.Errorf("App supervisor is unavailable")
	}
	parent, ok := owner.ClientProcess()
	if !ok {
		return fmt.Errorf("App supervisor process is unavailable")
	}
	observed, err := inspectMacOSProcess(pid)
	if err != nil || observed.parentPID != parent.PID {
		return fmt.Errorf("App supervisor relation changed")
	}
	return nil
}
