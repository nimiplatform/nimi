package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

// WindowsRuntimeSecurityState owns the service-private security state that must
// exist before the protected Desktop transport starts accepting connections.
// Its capabilities are intentionally opaque outside this package.
type WindowsRuntimeSecurityState struct {
	root              WindowsProtectedStateRoot
	principal         WindowsServicePrincipal
	process           WindowsRuntimeProcess
	secrets           BinarySecretStore
	ledger            *Ledger
	bootEpoch         Identifier
	desktopSessions   *DesktopSessionManager
	lifecycleIntents  *LifecycleIntentManager
	installedLaunches *InstalledLaunchRegistry
	desktopPipe       *WindowsDesktopPipeInstance
	desktopIdentity   WindowsDesktopIdentity

	transportMu        sync.Mutex
	desktopTransport   interface{ Close() error }
	installedTransport interface{ Close() error }
	closed             bool

	closeOnce sync.Once
	closeErr  error
}

type WindowsSecurityStateFailureStage uint32

const WindowsSecurityStateStartupExitCodeBase uint32 = 0xA800

const (
	WindowsSecurityStateStageContext WindowsSecurityStateFailureStage = iota + 1
	WindowsSecurityStateStagePrincipalCapability
	WindowsSecurityStateStageProcessCapability
	WindowsSecurityStateStageProcessBinding
	WindowsSecurityStateStageRootCapability
	WindowsSecurityStateStageSecretRoot
	WindowsSecurityStateStageDPAPIProtector
	WindowsSecurityStateStageServiceSID
	WindowsSecurityStateStageLedgerPath
	WindowsSecurityStateStageSecretStore
	WindowsSecurityStateStagePipeOpener
	WindowsSecurityStateStageAnchorStore
	WindowsSecurityStateStageRecordMACKey
	WindowsSecurityStateStageLedgerOpen
	WindowsSecurityStateStageBootEpoch
	WindowsSecurityStateStageDesktopSessions
	WindowsSecurityStateStageLifecycleIntents
	WindowsSecurityStateStageInstalledLaunches
	WindowsSecurityStateStageDesktopPipeOpen
	WindowsSecurityStateStageDesktopPipeMissing
	WindowsSecurityStateStageDesktopIdentity
)

type windowsSecurityStateStageError struct {
	stage WindowsSecurityStateFailureStage
	cause error
}

func (failure *windowsSecurityStateStageError) Error() string { return failure.cause.Error() }
func (failure *windowsSecurityStateStageError) Unwrap() error { return failure.cause }

func windowsSecurityStateStageFailure(stage WindowsSecurityStateFailureStage, cause error) error {
	if cause == nil {
		cause = errors.New("Windows security state initialization failed")
	}
	return &windowsSecurityStateStageError{stage: stage, cause: cause}
}

func WindowsSecurityStateStageFromError(err error) (WindowsSecurityStateFailureStage, bool) {
	var failure *windowsSecurityStateStageError
	if !errors.As(err, &failure) || failure.stage < WindowsSecurityStateStageContext || failure.stage > WindowsSecurityStateStageDesktopIdentity {
		return 0, false
	}
	return failure.stage, true
}

func WindowsSecurityStateStartupExitCode(err error) (uint32, bool) {
	stage, ok := WindowsSecurityStateStageFromError(err)
	if !ok {
		return 0, false
	}
	return WindowsSecurityStateStartupExitCodeBase + uint32(stage), true
}

func (state *WindowsRuntimeSecurityState) ServiceStateRoot() WindowsProtectedStateRoot {
	if state == nil {
		return WindowsProtectedStateRoot{}
	}
	return state.root
}

// ServiceStatePath exposes the already-validated service-owned root only to
// Runtime bootstrap code that is constructing protected service bindings. It
// must not be copied into process environment, argv, or user configuration.
func (state *WindowsRuntimeSecurityState) ServiceStatePath() string {
	if state == nil {
		return ""
	}
	return state.root.path
}

func (state *WindowsRuntimeSecurityState) RuntimeProcess() WindowsRuntimeProcess {
	if state == nil {
		return WindowsRuntimeProcess{}
	}
	return state.process
}

func (state *WindowsRuntimeSecurityState) BinarySecrets() BinarySecretStore {
	if state == nil {
		return nil
	}
	return state.secrets
}

func (state *WindowsRuntimeSecurityState) Ledger() *Ledger {
	if state == nil {
		return nil
	}
	return state.ledger
}

func (state *WindowsRuntimeSecurityState) BootEpoch() Identifier {
	if state == nil {
		return Identifier{}
	}
	return state.bootEpoch
}

func (state *WindowsRuntimeSecurityState) DesktopSessions() *DesktopSessionManager {
	if state == nil {
		return nil
	}
	return state.desktopSessions
}

func (state *WindowsRuntimeSecurityState) LifecycleIntents() *LifecycleIntentManager {
	if state == nil {
		return nil
	}
	return state.lifecycleIntents
}

func (state *WindowsRuntimeSecurityState) InstalledLaunches() *InstalledLaunchRegistry {
	if state == nil {
		return nil
	}
	return state.installedLaunches
}

func (state *WindowsRuntimeSecurityState) DesktopPipe() *WindowsDesktopPipeInstance {
	if state == nil {
		return nil
	}
	return state.desktopPipe
}

func (state *WindowsRuntimeSecurityState) DesktopIdentity() WindowsDesktopIdentity {
	if state == nil {
		return WindowsDesktopIdentity{}
	}
	return state.desktopIdentity
}

// Close revokes the transport before releasing the anchored ledger. The
// operation is idempotent because daemon shutdown paths may converge here.
func (state *WindowsRuntimeSecurityState) Close() error {
	if state == nil {
		return nil
	}
	state.closeOnce.Do(func() {
		state.transportMu.Lock()
		state.closed = true
		transport := state.desktopTransport
		installedTransport := state.installedTransport
		pipe := state.desktopPipe
		state.transportMu.Unlock()
		var pipeErr, installedErr, ledgerErr error
		if transport != nil {
			pipeErr = transport.Close()
		} else if pipe != nil {
			pipeErr = pipe.Close()
		}
		if installedTransport != nil {
			installedErr = installedTransport.Close()
		}
		if state.ledger != nil {
			ledgerErr = state.ledger.Close()
		}
		state.closeErr = errors.Join(pipeErr, installedErr, ledgerErr)
	})
	return state.closeErr
}

type windowsDesktopPipeOpener func(context.Context) (*WindowsDesktopPipeInstance, WindowsDesktopIdentity, error)

// assembleWindowsRuntimeSecurityState is shared by the production constructor
// and non-product tests. Production callers must enter through
// OpenWindowsRuntimeSecurityState so the principal, state root, DPAPI-NG store,
// executable, and fixed pipe endpoint are validated first.
func assembleWindowsRuntimeSecurityState(
	ctx context.Context,
	root WindowsProtectedStateRoot,
	secrets BinarySecretStore,
	openPipe windowsDesktopPipeOpener,
) (*WindowsRuntimeSecurityState, error) {
	if err := ctx.Err(); err != nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageContext, fmt.Errorf("assemble Windows Runtime security state: %w", err))
	}
	ledgerPath, err := WindowsProtectedLedgerPath(root)
	if err != nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageLedgerPath, err)
	}
	if secrets == nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageSecretStore, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("assemble Windows Runtime security state: protected secret custody is required")))
	}
	if openPipe == nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStagePipeOpener, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("assemble Windows Runtime security state: protected Desktop pipe opener is required")))
	}

	anchorStore, err := NewWindowsServiceAnchorStore(secrets)
	if err != nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageAnchorStore, err)
	}
	recordMACKey, err := LoadOrCreateWindowsLedgerRecordMACKey(ctx, secrets)
	if err != nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageRecordMACKey, err)
	}
	defer zeroBytes(recordMACKey)

	ledger, err := OpenLedger(ctx, LedgerOptions{
		Path:         ledgerPath,
		AnchorStore:  anchorStore,
		RecordMACKey: recordMACKey,
	})
	if err != nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageLedgerOpen, err)
	}
	cleanupLedger := true
	defer func() {
		if cleanupLedger {
			_ = ledger.Close()
		}
	}()

	// Boot epochs are process-lifetime freshness, not rollback-resistant state.
	// Mint them from OS randomness without advancing the durable anchor.
	bootEpoch, err := NewBootEpoch(nil)
	if err != nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageBootEpoch, err)
	}
	desktopSessions, err := NewDesktopSessionManager(bootEpoch, nil)
	if err != nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageDesktopSessions, err)
	}
	lifecycleIntents, err := NewLifecycleIntentManager(LifecycleIntentManagerOptions{
		Sessions: desktopSessions,
	})
	if err != nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageLifecycleIntents, err)
	}
	installedLaunches, err := NewInstalledLaunchRegistry(bootEpoch)
	if err != nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageInstalledLaunches, err)
	}

	// The listener is created last: no Desktop client can arrive before the
	// durable boot epoch and its session authority are ready.
	desktopPipe, desktopIdentity, err := openPipe(ctx)
	if err != nil {
		if desktopPipe != nil {
			_ = desktopPipe.Close()
		}
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageDesktopPipeOpen, err)
	}
	if desktopPipe == nil {
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageDesktopPipeMissing, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("assemble Windows Runtime security state: pipe opener returned no listener")))
	}
	if err := desktopIdentity.validate(); err != nil {
		_ = desktopPipe.Close()
		return nil, windowsSecurityStateStageFailure(WindowsSecurityStateStageDesktopIdentity, fail(ReasonDesktopProcessVerificationUnavailable, true, "reconnect_desktop", fmt.Errorf("assemble Windows Runtime security state: %w", err)))
	}

	cleanupLedger = false
	return &WindowsRuntimeSecurityState{
		root:              root,
		secrets:           secrets,
		ledger:            ledger,
		bootEpoch:         bootEpoch,
		desktopSessions:   desktopSessions,
		lifecycleIntents:  lifecycleIntents,
		installedLaunches: installedLaunches,
		desktopPipe:       desktopPipe,
		desktopIdentity:   desktopIdentity,
	}, nil
}
