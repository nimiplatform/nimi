//go:build windows && !nimi_windows_source_local_development

package protectedlocal

import (
	"fmt"
	"time"
)

// Production Windows retains its independently admitted session-scoped
// process verifier. The direct adapter is source-D2 only.
func BindPlatformDirectLocalAppLaunch(
	*DirectLocalAppLaunches,
	Identifier,
	uint32,
	DesktopPeerIdentity,
	time.Time,
) (time.Time, error) {
	return time.Time{}, fmt.Errorf("direct local-app binding is unavailable in the Windows production profile")
}

func RebindPlatformDirectLocalAppLaunch(
	*DirectLocalAppLaunches,
	Identifier,
	uint32,
	DesktopPeerIdentity,
	time.Time,
) (time.Time, error) {
	return time.Time{}, fmt.Errorf("direct local-app rebinding is unavailable in the Windows production profile")
}
