//go:build windows

package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestWindowsRuntimeSecurityStateComposesPipeLedgerAnchorAndSessionManager(t *testing.T) {
	ctx := context.Background()
	root := WindowsProtectedStateRoot{path: t.TempDir(), serviceSID: WindowsProductionServiceSID}
	principal := WindowsServicePrincipal{serviceSID: WindowsProductionServiceSID, tokenUserSID: "S-1-5-18"}
	secrets := &memoryBinarySecrets{values: map[string][]byte{}}
	identity, err := inspectWindowsDesktopToken(windows.GetCurrentProcessToken(), nil)
	if err != nil {
		t.Fatal(err)
	}
	openPipe := func(ctx context.Context) (*WindowsDesktopPipeInstance, WindowsDesktopIdentity, error) {
		name := fmt.Sprintf(`\\.\pipe\nimi-runtime-e2e-state-%d-%d`, os.Getpid(), time.Now().UnixNano())
		pipe, err := createWindowsDesktopPipeInstance(ctx, name, principal, identity, true)
		return pipe, identity, err
	}

	first, err := assembleWindowsRuntimeSecurityState(ctx, root, secrets, openPipe)
	if err != nil {
		t.Fatalf("assemble first synthetic security state: %v", err)
	}
	firstEpoch := first.BootEpoch()
	if firstEpoch == (Identifier{}) || first.Ledger() == nil || first.DesktopSessions() == nil || first.LifecycleIntents() == nil || first.DesktopPipe() == nil {
		t.Fatalf("incomplete first security state: %#v", first)
	}
	if first.LifecycleIntents().ledger != first.Ledger() || first.LifecycleIntents().sessions != first.DesktopSessions() {
		t.Fatal("lifecycle intent authority does not share the security-state ledger and Desktop sessions")
	}
	if first.DesktopIdentity().AccountPartition() != identity.AccountPartition() {
		t.Fatal("security state lost verified account partition")
	}
	if err := first.Close(); err != nil {
		t.Fatalf("close first security state: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("close first security state twice: %v", err)
	}
	if first.ledger.macKey != nil {
		t.Fatal("closed security state retained record-MAC key custody")
	}

	second, err := assembleWindowsRuntimeSecurityState(ctx, root, secrets, openPipe)
	if err != nil {
		t.Fatalf("reopen synthetic security state: %v", err)
	}
	defer second.Close()
	if second.BootEpoch() == (Identifier{}) || second.BootEpoch() == firstEpoch {
		t.Fatal("restart did not mint a fresh anchored boot epoch")
	}
	if current := second.Ledger().currentBootEpoch(ctx); current != second.BootEpoch() {
		t.Fatal("session manager and ledger boot epochs diverged")
	}
	if _, present := secrets.values[WindowsLedgerRecordMACKeyName]; !present {
		t.Fatal("security state did not retain ledger MAC key in protected custody")
	}
}

func TestWindowsRuntimeSecurityStateClosesLedgerWhenPipeInitializationFails(t *testing.T) {
	ctx := context.Background()
	root := WindowsProtectedStateRoot{path: t.TempDir(), serviceSID: WindowsProductionServiceSID}
	secrets := &memoryBinarySecrets{values: map[string][]byte{}}
	pipeFailure := fmt.Errorf("synthetic pipe failure")
	identity, err := inspectWindowsDesktopToken(windows.GetCurrentProcessToken(), nil)
	if err != nil {
		t.Fatal(err)
	}
	principal := WindowsServicePrincipal{serviceSID: WindowsProductionServiceSID}
	var failedPipe *WindowsDesktopPipeInstance
	if _, err := assembleWindowsRuntimeSecurityState(ctx, root, secrets, func(ctx context.Context) (*WindowsDesktopPipeInstance, WindowsDesktopIdentity, error) {
		name := fmt.Sprintf(`\\.\pipe\nimi-runtime-e2e-state-failure-%d-%d`, os.Getpid(), time.Now().UnixNano())
		failedPipe, err = createWindowsDesktopPipeInstance(ctx, name, principal, identity, true)
		return failedPipe, identity, errors.Join(pipeFailure, err)
	}); !errors.Is(err, pipeFailure) {
		t.Fatalf("pipe initialization error = %v", err)
	}
	if failedPipe == nil {
		t.Fatal("synthetic failing opener did not create a listener")
	}
	failedPipe.mu.Lock()
	failedPipeClosed := failedPipe.closed
	failedPipe.mu.Unlock()
	if !failedPipeClosed {
		t.Fatal("pipe returned alongside initialization error remained open")
	}

	state, err := assembleWindowsRuntimeSecurityState(ctx, root, secrets, func(ctx context.Context) (*WindowsDesktopPipeInstance, WindowsDesktopIdentity, error) {
		name := fmt.Sprintf(`\\.\pipe\nimi-runtime-e2e-state-recovery-%d-%d`, os.Getpid(), time.Now().UnixNano())
		pipe, err := createWindowsDesktopPipeInstance(ctx, name, principal, identity, true)
		return pipe, identity, err
	})
	if err != nil {
		t.Fatalf("reopen after pipe initialization failure: %v", err)
	}
	defer state.Close()
}

func TestWindowsRuntimeSecurityStateRejectsMissingProductionCapabilities(t *testing.T) {
	if _, err := OpenWindowsRuntimeSecurityState(context.Background(), WindowsServicePrincipal{}, WindowsRuntimeProcess{}, WindowsProtectedStateRoot{}); !IsReason(err, ReasonProtectedLocalRuntimePrincipalRequired) {
		t.Fatalf("missing production capability error = %v", err)
	}
}
