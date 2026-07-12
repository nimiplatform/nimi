//go:build windows

package protectedlocal

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestWindowsPrincipalInputAdmitsOnlyExactCurrentProcessPseudoHandle(t *testing.T) {
	currentPID := uint32(os.Getpid())
	if err := validateWindowsPrincipalProcessInput(currentPID, windows.CurrentProcess()); err != nil {
		t.Fatalf("exact current-process pseudo-handle rejected: %v", err)
	}
	for name, input := range map[string]struct {
		pid     uint32
		process windows.Handle
	}{
		"zero PID":       {pid: 0, process: windows.CurrentProcess()},
		"zero handle":    {pid: currentPID, process: 0},
		"mismatched PID": {pid: currentPID + 1, process: windows.InvalidHandle},
	} {
		t.Run(name, func(t *testing.T) {
			err := validateWindowsPrincipalProcessInput(input.pid, input.process)
			stage, ok := WindowsPrincipalStageFromError(err)
			if !ok || stage != WindowsPrincipalStageInput {
				t.Fatalf("input failure stage = (%v, %v), want %v", stage, ok, WindowsPrincipalStageInput)
			}
		})
	}
}

func TestWindowsProductionPrincipalNeverAdmitsInteractiveProcess(t *testing.T) {
	principal, err := ValidateWindowsProductionPrincipal(context.Background())
	if err == nil {
		if principal.ServiceSID() != mustActiveWindowsRuntimeProfile().serviceSID {
			t.Fatalf("admitted SID = %q", principal.ServiceSID())
		}
		return
	}
	if !IsReason(err, ReasonProtectedLocalRuntimePrincipalRequired) {
		t.Fatalf("error = %v, want principal-required", err)
	}
}

func TestWindowsServiceOnlyFileACLValidationRejectsAdditionalPrincipal(t *testing.T) {
	serviceSID, err := windows.StringToSid(mustActiveWindowsRuntimeProfile().serviceSID)
	if err != nil {
		t.Fatal(err)
	}
	interactiveSID, err := windows.StringToSid(windowsInteractiveLogonSID)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "secret.dpapi-ng")
	if err := os.WriteFile(path, []byte("ciphertext"), 0o600); err != nil {
		t.Fatal(err)
	}
	handle, err := openWindowsFile(path, windows.READ_CONTROL|windows.WRITE_DAC, windows.FILE_SHARE_READ, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(handle)

	serviceEntry := windows.EXPLICIT_ACCESS{
		AccessPermissions: windows.GENERIC_ALL,
		AccessMode:        windows.SET_ACCESS,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeType:  windows.TRUSTEE_IS_USER,
			TrusteeValue: windows.TrusteeValueFromSID(serviceSID),
		},
	}
	acl, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{serviceEntry}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetSecurityInfo(handle, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil); err != nil {
		t.Fatal(err)
	}
	if err := validateWindowsServiceOnlyACL(handle, serviceSID, false, false); err != nil {
		t.Fatalf("exact service ACL rejected: %v", err)
	}

	interactiveEntry := windows.EXPLICIT_ACCESS{
		AccessPermissions: windows.GENERIC_READ,
		AccessMode:        windows.GRANT_ACCESS,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeType:  windows.TRUSTEE_IS_GROUP,
			TrusteeValue: windows.TrusteeValueFromSID(interactiveSID),
		},
	}
	acl, err = windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{serviceEntry, interactiveEntry}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetSecurityInfo(handle, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil); err != nil {
		t.Fatal(err)
	}
	if err := validateWindowsServiceOnlyACL(handle, serviceSID, false, false); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
		t.Fatalf("extra-principal ACL error = %v", err)
	}
}

func TestWindowsRuntimeProcessDACLNamesExactServiceAndDeniesInteractiveAccess(t *testing.T) {
	serviceSID, err := windows.StringToSid(mustActiveWindowsRuntimeProfile().serviceSID)
	if err != nil {
		t.Fatal(err)
	}
	interactiveSID, err := windows.StringToSid(windowsInteractiveLogonSID)
	if err != nil {
		t.Fatal(err)
	}
	remoteInteractiveSID, err := windows.StringToSid(windowsRemoteInteractiveLogonSID)
	if err != nil {
		t.Fatal(err)
	}
	acl, err := buildWindowsRuntimeProcessACL(serviceSID, interactiveSID, remoteInteractiveSID)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateWindowsProcessDACL(acl); err != nil {
		t.Fatalf("built process DACL rejected: %v", err)
	}

	incomplete, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{{
		AccessPermissions: windowsSensitiveProcessAccess,
		AccessMode:        windows.DENY_ACCESS,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeType:  windows.TRUSTEE_IS_GROUP,
			TrusteeValue: windows.TrusteeValueFromSID(interactiveSID),
		},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateWindowsProcessDACL(incomplete); !IsReason(err, ReasonProtectedLocalRuntimePrincipalRequired) {
		t.Fatalf("incomplete process DACL error = %v", err)
	}

	everyoneSID, err := windows.StringToSid("S-1-1-0")
	if err != nil {
		t.Fatal(err)
	}
	widened, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{
		{
			AccessPermissions: windowsSensitiveProcessAccess,
			AccessMode:        windows.DENY_ACCESS,
			Trustee: windows.TRUSTEE{
				TrusteeForm:  windows.TRUSTEE_IS_SID,
				TrusteeType:  windows.TRUSTEE_IS_GROUP,
				TrusteeValue: windows.TrusteeValueFromSID(interactiveSID),
			},
		},
		{
			AccessPermissions: windowsSensitiveProcessAccess,
			AccessMode:        windows.DENY_ACCESS,
			Trustee: windows.TRUSTEE{
				TrusteeForm:  windows.TRUSTEE_IS_SID,
				TrusteeType:  windows.TRUSTEE_IS_GROUP,
				TrusteeValue: windows.TrusteeValueFromSID(remoteInteractiveSID),
			},
		},
		{
			AccessPermissions: windows.PROCESS_ALL_ACCESS,
			AccessMode:        windows.SET_ACCESS,
			Trustee: windows.TRUSTEE{
				TrusteeForm:  windows.TRUSTEE_IS_SID,
				TrusteeType:  windows.TRUSTEE_IS_USER,
				TrusteeValue: windows.TrusteeValueFromSID(serviceSID),
			},
		},
		{
			AccessPermissions: windows.PROCESS_ALL_ACCESS,
			AccessMode:        windows.GRANT_ACCESS,
			Trustee: windows.TRUSTEE{
				TrusteeForm:  windows.TRUSTEE_IS_SID,
				TrusteeType:  windows.TRUSTEE_IS_WELL_KNOWN_GROUP,
				TrusteeValue: windows.TrusteeValueFromSID(everyoneSID),
			},
		},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateWindowsProcessDACL(widened); !IsReason(err, ReasonProtectedLocalRuntimePrincipalRequired) {
		t.Fatalf("widened process DACL error = %v", err)
	}
}

func TestWindowsDPAPINGExactServiceSIDDescriptorFailsClosedOutsideService(t *testing.T) {
	serviceSID := mustActiveWindowsRuntimeProfile().serviceSID
	protector, err := newWindowsDPAPINGProtector(serviceSID)
	if err != nil {
		if !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
			t.Fatalf("DPAPI-NG availability error = %v", err)
		}
		return
	}
	secret := []byte("synthetic-non-product-secret")
	protected, err := protector.Protect(secret)
	if err != nil {
		if !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
			t.Fatalf("protect exact service-SID secret: %v", err)
		}
		t.Logf("exact service-SID DPAPI-NG protection unavailable in this process: %v", errors.Unwrap(err))
		return
	}
	principal, principalErr := ValidateWindowsProductionPrincipal(context.Background())
	plaintext, unprotectErr := protector.Unprotect(protected)
	if principalErr == nil {
		if unprotectErr != nil {
			t.Fatalf("validated service principal could not unprotect: %v", unprotectErr)
		}
		if principal.ServiceSID() != serviceSID || !bytes.Equal(plaintext, secret) {
			t.Fatal("DPAPI-NG service-principal round trip mismatch")
		}
		zeroBytes(plaintext)
		return
	}
	if unprotectErr == nil {
		zeroBytes(plaintext)
		t.Fatal("interactive process unprotected exact service-SID secret")
	}
	if !IsReason(unprotectErr, ReasonProtectedLocalCustodyBoundaryUnavailable) {
		t.Fatalf("unprotect error = %v", unprotectErr)
	}
}

func TestWindowsDPAPINGRejectsBroaderEmbeddedDescriptorBeforeDecryption(t *testing.T) {
	serviceSID := mustActiveWindowsRuntimeProfile().serviceSID
	protector, err := newWindowsDPAPINGProtector(serviceSID)
	if err != nil {
		if !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
			t.Fatal(err)
		}
		return
	}
	protector.descriptor = "LOCAL=machine"
	protected, err := protector.Protect([]byte("must-not-be-admitted"))
	if err != nil {
		t.Fatalf("prepare broader DPAPI-NG blob: %v", err)
	}
	protector.descriptor = "SID=" + serviceSID
	if _, err := protector.Unprotect(protected); !IsReason(err, ReasonProtectedLocalLedgerRollbackDetected) {
		t.Fatalf("descriptor mismatch error = %v", err)
	}
}

func TestWindowsBinarySecretStoreAtomicLifecycleWithInjectedSyntheticProtector(t *testing.T) {
	root := t.TempDir()
	store := &WindowsServiceSecretStore{
		root: WindowsProtectedStateRoot{
			path:       root,
			serviceSID: mustActiveWindowsRuntimeProfile().serviceSID,
		},
		protector: syntheticWindowsProtector{},
		random:    rand.Reader,
		validateRoot: func(ctx context.Context) error {
			return ctx.Err()
		},
		secureFile: func(windows.Handle) error { return nil },
		validateFile: func(windows.Handle) error {
			return nil
		},
	}
	ctx := context.Background()
	if err := store.Store(ctx, "account.session-1", []byte("first")); err != nil {
		t.Fatal(err)
	}
	if err := store.Store(ctx, "account.session-1", []byte("second")); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Load(ctx, "account.session-1")
	if err != nil {
		t.Fatal(err)
	}
	if string(loaded) != "second" {
		t.Fatalf("loaded = %q", loaded)
	}
	zeroBytes(loaded)
	if err := os.WriteFile(store.secretPath("account.session-1"), []byte("corrupt"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load(ctx, "account.session-1"); !IsReason(err, ReasonProtectedLocalLedgerRollbackDetected) {
		t.Fatalf("corrupt secret error = %v", err)
	}
	if err := store.Delete(ctx, "account.session-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load(ctx, "account.session-1"); !errors.Is(err, ErrProtectedSecretNotFound) {
		t.Fatalf("load after delete error = %v", err)
	}
	if err := store.Delete(ctx, "account.session-1"); !errors.Is(err, ErrProtectedSecretNotFound) {
		t.Fatalf("second delete error = %v", err)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("secret artifacts remain after delete: %v", entries)
	}
}

type syntheticWindowsProtector struct{}

func (syntheticWindowsProtector) Protect(plaintext []byte) ([]byte, error) {
	protected := append([]byte("SYNTHETIC\x00"), plaintext...)
	for index := len("SYNTHETIC\x00"); index < len(protected); index++ {
		protected[index] ^= 0xa5
	}
	return protected, nil
}

func (syntheticWindowsProtector) Unprotect(protected []byte) ([]byte, error) {
	if !bytes.HasPrefix(protected, []byte("SYNTHETIC\x00")) {
		return nil, rollbackFailure("unprotect synthetic Windows fixture", errors.New("invalid fixture encoding"))
	}
	plaintext := append([]byte(nil), protected[len("SYNTHETIC\x00"):]...)
	for index := range plaintext {
		plaintext[index] ^= 0xa5
	}
	return plaintext, nil
}
