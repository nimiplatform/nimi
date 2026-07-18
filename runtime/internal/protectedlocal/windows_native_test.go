//go:build windows

package protectedlocal

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"unsafe"

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
	defer func() { _ = windows.CloseHandle(handle) }()

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

func TestWindowsRuntimeProcessDACLNamesExactServiceAndLimitsInteractiveAccessToVerification(t *testing.T) {
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

	widenedInteractive, err := buildWindowsRuntimeProcessACL(serviceSID, interactiveSID, remoteInteractiveSID)
	if err != nil {
		t.Fatal(err)
	}
	var interactiveACE *windows.ACCESS_ALLOWED_ACE
	for index := uint32(0); index < uint32(widenedInteractive.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(widenedInteractive, index, &ace); err != nil {
			t.Fatal(err)
		}
		if ace.Header.AceType == windows.ACCESS_ALLOWED_ACE_TYPE && (*windows.SID)(unsafe.Pointer(&ace.SidStart)).String() == windowsInteractiveLogonSID {
			interactiveACE = ace
			break
		}
	}
	if interactiveACE == nil {
		t.Fatal("built process DACL omitted interactive verification ACE")
	}
	interactiveACE.Mask |= windows.PROCESS_VM_READ
	if err := validateWindowsProcessDACL(widenedInteractive); !IsReason(err, ReasonProtectedLocalRuntimePrincipalRequired) {
		t.Fatalf("widened interactive verification error = %v", err)
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
			AccessPermissions: windowsRuntimeProcessVerificationAccess,
			AccessMode:        windows.SET_ACCESS,
			Trustee: windows.TRUSTEE{
				TrusteeForm:  windows.TRUSTEE_IS_SID,
				TrusteeType:  windows.TRUSTEE_IS_WELL_KNOWN_GROUP,
				TrusteeValue: windows.TrusteeValueFromSID(interactiveSID),
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

func TestWindowsRuntimeProcessMandatoryLabelAllowsReadOnlyMutualVerification(t *testing.T) {
	descriptor, label, err := buildWindowsRuntimeMandatoryLabel()
	if err != nil {
		t.Fatal(err)
	}
	if err := validateWindowsRuntimeMandatoryLabel(label); err != nil {
		t.Fatalf("built mandatory label rejected: %v", err)
	}
	runtime.KeepAlive(descriptor)

	noReadDescriptor, err := windows.SecurityDescriptorFromString("S:(ML;;NWNR;;;SI)")
	if err != nil {
		t.Fatal(err)
	}
	noReadLabel, _, err := noReadDescriptor.SACL()
	if err != nil {
		t.Fatal(err)
	}
	if err := validateWindowsRuntimeMandatoryLabel(noReadLabel); !IsReason(err, ReasonProtectedLocalRuntimePrincipalRequired) {
		t.Fatalf("no-read-up mandatory label error = %v", err)
	}
	runtime.KeepAlive(noReadDescriptor)
}

func TestWindowsRuntimeTokenDACLNamesExactServiceAndLimitsInteractiveAccessToQuery(t *testing.T) {
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
	acl, err := buildWindowsRuntimeTokenACL(serviceSID, interactiveSID, remoteInteractiveSID)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateWindowsRuntimeTokenDACL(acl); err != nil {
		t.Fatalf("built token DACL rejected: %v", err)
	}

	var interactiveACE *windows.ACCESS_ALLOWED_ACE
	for index := uint32(0); index < uint32(acl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(acl, index, &ace); err != nil {
			t.Fatal(err)
		}
		if ace.Header.AceType == windows.ACCESS_ALLOWED_ACE_TYPE && (*windows.SID)(unsafe.Pointer(&ace.SidStart)).String() == windowsInteractiveLogonSID {
			interactiveACE = ace
			break
		}
	}
	if interactiveACE == nil {
		t.Fatal("built token DACL omitted interactive verification ACE")
	}
	interactiveACE.Mask |= windows.TOKEN_DUPLICATE
	if err := validateWindowsRuntimeTokenDACL(acl); !IsReason(err, ReasonProtectedLocalRuntimePrincipalRequired) {
		t.Fatalf("widened interactive token access error = %v", err)
	}
}

func TestWindowsDPAPINGLocalUserDescriptorRoundTripsOnlyUnderTheCurrentFixedHostUser(t *testing.T) {
	profile := mustActiveWindowsRuntimeProfile()
	principal := WindowsServicePrincipal{serviceSID: profile.serviceSID, tokenUserSID: profile.serviceHostSID}
	protector, err := newWindowsDPAPINGProtector(principal)
	if err != nil {
		t.Fatalf("create local-user DPAPI-NG protector: %v", err)
	}
	if protector.descriptor != windowsDPAPINGLocalUserDescriptor {
		t.Fatalf("DPAPI-NG descriptor = %q", protector.descriptor)
	}
	secret := []byte("synthetic-non-product-secret")
	protected, err := protector.Protect(secret)
	if err != nil {
		t.Fatalf("protect local-user secret: %v", err)
	}
	plaintext, unprotectErr := protector.Unprotect(protected)
	if unprotectErr != nil {
		t.Fatalf("unprotect local-user secret: %v", unprotectErr)
	}
	if !bytes.Equal(plaintext, secret) {
		t.Fatal("DPAPI-NG local-user round trip mismatch")
	}
	zeroBytes(plaintext)

	for name, invalid := range map[string]WindowsServicePrincipal{
		"wrong service SID": {serviceSID: "S-1-5-80-1-2-3-4-5", tokenUserSID: profile.serviceHostSID},
		"wrong host user":   {serviceSID: profile.serviceSID, tokenUserSID: "S-1-5-19"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := newWindowsDPAPINGProtector(invalid); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
				t.Fatalf("invalid protector principal error = %v", err)
			}
		})
	}
}

func TestWindowsDPAPINGRejectsBroaderEmbeddedDescriptorBeforeDecryption(t *testing.T) {
	profile := mustActiveWindowsRuntimeProfile()
	protector, err := newWindowsDPAPINGProtector(WindowsServicePrincipal{serviceSID: profile.serviceSID, tokenUserSID: profile.serviceHostSID})
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
	protector.descriptor = windowsDPAPINGLocalUserDescriptor
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
