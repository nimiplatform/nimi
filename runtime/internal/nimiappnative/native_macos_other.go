//go:build !darwin

package nimiappnative

import (
	"context"
	"crypto/sha256"
)

func verifyMacOSRuntimeEntry(context.Context, string, [sha256.Size]byte) (MacOSObservation, error) {
	return MacOSObservation{}, ErrUnsupportedPlatform
}
