//go:build !darwin && !windows

package protectedlocal

import (
	"fmt"
	"time"
)

func BindPlatformDirectLocalAppLaunch(
	*DirectLocalAppLaunches,
	Identifier,
	uint32,
	DesktopPeerIdentity,
	time.Time,
) (time.Time, error) {
	return time.Time{}, fmt.Errorf("direct local-app binding is unavailable on this platform")
}

func RebindPlatformDirectLocalAppLaunch(
	*DirectLocalAppLaunches,
	Identifier,
	uint32,
	DesktopPeerIdentity,
	time.Time,
) (time.Time, error) {
	return time.Time{}, fmt.Errorf("direct local-app rebinding is unavailable on this platform")
}
