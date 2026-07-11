//go:build !windows

package protectedlocal

import (
	"context"
	"fmt"
)

type WindowsServiceSecretStore struct{}

func ValidateWindowsProductionPrincipal(context.Context) (WindowsServicePrincipal, error) {
	return WindowsServicePrincipal{}, windowsUnsupported("validate Windows Runtime principal")
}

func ValidateWindowsCurrentProcessIsolation(context.Context, WindowsServicePrincipal) error {
	return windowsUnsupported("validate Windows Runtime process isolation")
}

func HardenWindowsCurrentProcessIsolation(context.Context, WindowsServicePrincipal) error {
	return windowsUnsupported("harden Windows Runtime process isolation")
}

func ValidateWindowsProtectedStateRoot(context.Context, string, WindowsServicePrincipal) (WindowsProtectedStateRoot, error) {
	return WindowsProtectedStateRoot{}, windowsUnsupported("validate Windows protected state root")
}

func OpenWindowsProductionSecretStore(context.Context, WindowsServicePrincipal, WindowsProtectedStateRoot) (*WindowsServiceSecretStore, error) {
	return nil, windowsUnsupported("open Windows protected secret store")
}

func (*WindowsServiceSecretStore) Load(context.Context, string) ([]byte, error) {
	return nil, windowsUnsupported("load Windows protected secret")
}

func (*WindowsServiceSecretStore) Store(context.Context, string, []byte) error {
	return windowsUnsupported("store Windows protected secret")
}

func (*WindowsServiceSecretStore) Delete(context.Context, string) error {
	return windowsUnsupported("delete Windows protected secret")
}

func windowsUnsupported(operation string) error {
	return fail(
		ReasonProtectedLocalTransportUnsupported,
		false,
		"repair_runtime_service",
		fmt.Errorf("%s: Windows-only production primitive", operation),
	)
}
