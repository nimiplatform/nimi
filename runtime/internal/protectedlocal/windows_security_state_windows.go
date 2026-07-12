//go:build windows

package protectedlocal

import (
	"context"
	"fmt"
)

// OpenWindowsRuntimeSecurityState is the production entry point. It accepts
// only capabilities minted by the exact NimiRuntime service validation path.
func OpenWindowsRuntimeSecurityState(
	ctx context.Context,
	principal WindowsServicePrincipal,
	process WindowsRuntimeProcess,
	root WindowsProtectedStateRoot,
) (*WindowsRuntimeSecurityState, error) {
	if principal.serviceSID != mustActiveWindowsRuntimeProfile().serviceSID || principal.tokenUserSID == "" {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStagePrincipalCapability, principalFailure("open Windows Runtime security state", fmt.Errorf("exact active service-principal capability required")))
	}
	if err := process.validate(); err != nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageProcessCapability, principalFailure("open Windows Runtime security state", err))
	}
	if process.principalSID != principal.serviceSID {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageProcessBinding, principalFailure("bind Windows Runtime security state to process", fmt.Errorf("service principal capability mismatch")))
	}
	if root.serviceSID != principal.serviceSID || root.path == "" {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageRootCapability, custodyFailure("open Windows Runtime security state", fmt.Errorf("validated protected state-root capability required")))
	}

	secrets, err := OpenWindowsProductionSecretStore(ctx, principal, root)
	if err != nil {
		return nil, err
	}
	state, err := assembleWindowsRuntimeSecurityState(ctx, root, secrets, func(ctx context.Context) (*WindowsDesktopPipeInstance, WindowsDesktopIdentity, error) {
		return OpenWindowsProductionDesktopPipe(ctx, principal, process)
	})
	if err != nil {
		return nil, err
	}
	state.principal = principal
	state.process = process
	return state, nil
}
