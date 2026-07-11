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
	root             WindowsProtectedStateRoot
	principal        WindowsServicePrincipal
	process          WindowsRuntimeProcess
	secrets          BinarySecretStore
	ledger           *Ledger
	bootEpoch        Identifier
	desktopSessions  *DesktopSessionManager
	lifecycleIntents *LifecycleIntentManager
	desktopPipe      *WindowsDesktopPipeInstance
	desktopIdentity  WindowsDesktopIdentity

	transportMu      sync.Mutex
	desktopTransport interface{ Close() error }
	closed           bool

	closeOnce sync.Once
	closeErr  error
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
		pipe := state.desktopPipe
		state.transportMu.Unlock()
		var pipeErr, ledgerErr error
		if transport != nil {
			pipeErr = transport.Close()
		} else if pipe != nil {
			pipeErr = pipe.Close()
		}
		if state.ledger != nil {
			ledgerErr = state.ledger.Close()
		}
		state.closeErr = errors.Join(pipeErr, ledgerErr)
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
		return nil, fmt.Errorf("assemble Windows Runtime security state: %w", err)
	}
	ledgerPath, err := WindowsProtectedLedgerPath(root)
	if err != nil {
		return nil, err
	}
	if secrets == nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("assemble Windows Runtime security state: protected secret custody is required"))
	}
	if openPipe == nil {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("assemble Windows Runtime security state: protected Desktop pipe opener is required"))
	}

	anchorStore, err := NewWindowsServiceAnchorStore(secrets)
	if err != nil {
		return nil, err
	}
	recordMACKey, err := LoadOrCreateWindowsLedgerRecordMACKey(ctx, secrets)
	if err != nil {
		return nil, err
	}
	defer zeroBytes(recordMACKey)

	ledger, err := OpenLedger(ctx, LedgerOptions{
		Path:         ledgerPath,
		AnchorStore:  anchorStore,
		RecordMACKey: recordMACKey,
	})
	if err != nil {
		return nil, err
	}
	cleanupLedger := true
	defer func() {
		if cleanupLedger {
			_ = ledger.Close()
		}
	}()

	bootEpoch, err := ledger.StartRuntime(ctx)
	if err != nil {
		return nil, err
	}
	desktopSessions, err := NewDesktopSessionManager(bootEpoch, nil, ledger)
	if err != nil {
		return nil, err
	}
	lifecycleIntents, err := NewLifecycleIntentManager(LifecycleIntentManagerOptions{
		Sessions: desktopSessions,
		Ledger:   ledger,
	})
	if err != nil {
		return nil, err
	}

	// The listener is created last: no Desktop client can arrive before the
	// durable boot epoch and its session authority are ready.
	desktopPipe, desktopIdentity, err := openPipe(ctx)
	if err != nil {
		if desktopPipe != nil {
			_ = desktopPipe.Close()
		}
		return nil, err
	}
	if desktopPipe == nil {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("assemble Windows Runtime security state: pipe opener returned no listener"))
	}
	if err := desktopIdentity.validate(); err != nil {
		_ = desktopPipe.Close()
		return nil, fail(ReasonDesktopProcessVerificationUnavailable, true, "reconnect_desktop", fmt.Errorf("assemble Windows Runtime security state: %w", err))
	}

	cleanupLedger = false
	return &WindowsRuntimeSecurityState{
		root:             root,
		secrets:          secrets,
		ledger:           ledger,
		bootEpoch:        bootEpoch,
		desktopSessions:  desktopSessions,
		lifecycleIntents: lifecycleIntents,
		desktopPipe:      desktopPipe,
		desktopIdentity:  desktopIdentity,
	}, nil
}
