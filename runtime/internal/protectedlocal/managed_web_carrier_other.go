//go:build (!windows && !darwin) || (darwin && !cgo && !nimi_macos_source_local_development)

package protectedlocal

import (
	"context"
	"fmt"
)

func ResolveManagedWebCarrier(context.Context) (ManagedWebCarrier, error) {
	return ManagedWebCarrier{}, fmt.Errorf("managed-web shared carrier is unsupported on this platform")
}
