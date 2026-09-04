//go:build !windows

package nimiappnative

import (
	"context"
	"crypto/sha256"
)

func verifyWindowsRuntimeEntry(context.Context, string, [sha256.Size]byte) (WindowsObservation, error) {
	return WindowsObservation{}, ErrUnsupportedPlatform
}
