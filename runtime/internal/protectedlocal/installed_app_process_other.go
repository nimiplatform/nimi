//go:build !windows

package protectedlocal

import (
	"context"
	"fmt"
)

func VerifyInstalledAppProcess(context.Context, uint32, InstalledAppProcessPolicy) (ProcessTuple, DesktopProcessLiveness, error) {
	return ProcessTuple{}, nil, fmt.Errorf("installed App process verification is unavailable on this platform")
}
