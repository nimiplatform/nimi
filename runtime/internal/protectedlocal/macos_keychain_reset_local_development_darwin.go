//go:build darwin && cgo && nimi_macos_local_development

package protectedlocal

import (
	"context"
	"errors"
)

func resetMacOSDevelopmentKeychainNamespace(ctx context.Context) (resultErr error) {
	// An ad-hoc rebuild has a new code identity, so the installed Runtime must
	// remove its exact development service namespace before it is replaced.
	store, err := OpenMacOSSystemKeychainSecretStore()
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, store.Close()) }()
	return store.resetServiceNamespace(ctx)
}
