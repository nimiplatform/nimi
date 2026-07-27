//go:build windows

package localservice

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

const windowsTestFileAllAccess = 0x001f01ff
const windowsTestRuntimeServiceSID = "S-1-5-80-1-2-3-4-5"

func TestProductControlDataRootSecurityRejectsReparseAncestor(t *testing.T) {
	directRoot := filepath.Join(t.TempDir(), "direct", "nimi-data")
	if err := os.MkdirAll(directRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := validateProductControlDataRootPlatform(directRoot, ProductControlDataRootSecurityBinding{}); err != nil {
		t.Fatalf("direct Product Control data root rejected: %v", err)
	}

	targetRoot := filepath.Join(t.TempDir(), "target")
	if err := os.MkdirAll(filepath.Join(targetRoot, "nested"), 0o700); err != nil {
		t.Fatal(err)
	}
	linkRoot := filepath.Join(t.TempDir(), "linked")
	if err := os.Symlink(targetRoot, linkRoot); err != nil {
		t.Skipf("Windows symlink privilege unavailable: %v", err)
	}
	if err := validateProductControlDataRootPlatform(filepath.Join(linkRoot, "nested"), ProductControlDataRootSecurityBinding{}); err == nil {
		t.Fatal("Product Control data root with a reparse-point ancestor was accepted")
	}
}

func TestProductControlDataRootSecurityValidatesOwnerAndExactServiceSID(t *testing.T) {
	root := filepath.Join(t.TempDir(), "nimi-data")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	tokenUser, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || tokenUser == nil || tokenUser.User.Sid == nil {
		t.Fatalf("resolve current user SID: %v", err)
	}
	serviceSID, err := windows.StringToSid(windowsTestRuntimeServiceSID)
	if err != nil {
		t.Fatal(err)
	}
	descriptor, err := windows.GetNamedSecurityInfo(root, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil || descriptor == nil {
		t.Fatalf("read original DACL: %v", err)
	}
	currentDACL, _, err := descriptor.DACL()
	if err != nil || currentDACL == nil {
		t.Fatalf("read original DACL entries: %v", err)
	}
	nextDACL, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{{
		AccessPermissions: windows.ACCESS_MASK(
			windows.FILE_GENERIC_READ |
				windows.FILE_GENERIC_WRITE |
				windows.FILE_GENERIC_EXECUTE |
				windows.DELETE,
		),
		AccessMode:  windows.SET_ACCESS,
		Inheritance: windows.SUB_CONTAINERS_AND_OBJECTS_INHERIT,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeType:  windows.TRUSTEE_IS_UNKNOWN,
			TrusteeValue: windows.TrusteeValueFromSID(serviceSID),
		},
	}}, currentDACL)
	if err != nil {
		t.Fatalf("build fixed-service DACL entry: %v", err)
	}
	if err := windows.SetNamedSecurityInfo(
		root,
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION,
		nil,
		nil,
		nextDACL,
		nil,
	); err != nil {
		t.Fatalf("install fixed-service DACL entry: %v", err)
	}

	binding := ProductControlDataRootSecurityBinding{
		InteractiveUserSID: tokenUser.User.Sid.String(),
		RuntimeServiceSID:  windowsTestRuntimeServiceSID,
	}
	if err := validateProductControlDataRootPlatform(root, binding); err != nil {
		t.Fatalf("valid Product Control data-root security rejected: %v", err)
	}
	binding.RuntimeServiceSID = "S-1-5-80-1-2-3-4-6"
	if err := ensureNimiDataRootLayout(root, binding); err == nil ||
		!strings.Contains(err.Error(), "fixed Runtime service SID") {
		t.Fatalf("wrong Runtime service SID error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "models")); !os.IsNotExist(err) {
		t.Fatalf("layout mutation occurred before fixed-service ACL rejection: %v", err)
	}
	binding.RuntimeServiceSID = windowsTestRuntimeServiceSID
	binding.InteractiveUserSID = "S-1-5-18"
	if err := validateProductControlDataRootPlatform(root, binding); err == nil ||
		!strings.Contains(err.Error(), "verified interactive user") {
		t.Fatalf("wrong owner SID error = %v", err)
	}
}

func TestProductControlDataRootSecurityRejectsServiceFullControl(t *testing.T) {
	root := filepath.Join(t.TempDir(), "nimi-data")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	tokenUser, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || tokenUser == nil || tokenUser.User.Sid == nil {
		t.Fatalf("resolve current user SID: %v", err)
	}
	serviceSID, err := windows.StringToSid(windowsTestRuntimeServiceSID)
	if err != nil {
		t.Fatal(err)
	}
	installWindowsTestAccess(t, root, []windows.EXPLICIT_ACCESS{{
		AccessPermissions: windows.ACCESS_MASK(windowsTestFileAllAccess),
		AccessMode:        windows.SET_ACCESS,
		Inheritance:       windows.SUB_CONTAINERS_AND_OBJECTS_INHERIT,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeType:  windows.TRUSTEE_IS_UNKNOWN,
			TrusteeValue: windows.TrusteeValueFromSID(serviceSID),
		},
	}})
	binding := ProductControlDataRootSecurityBinding{
		InteractiveUserSID: tokenUser.User.Sid.String(),
		RuntimeServiceSID:  windowsTestRuntimeServiceSID,
	}
	if err := validateProductControlDataRootPlatform(root, binding); err == nil ||
		!strings.Contains(err.Error(), "fixed Runtime service SID") {
		t.Fatalf("service Full Control was not rejected: %v", err)
	}
}

func TestProductControlDataRootSecurityRejectsBroadWritablePrincipals(t *testing.T) {
	tests := []struct {
		name       string
		sid        string
		permission windows.ACCESS_MASK
	}{
		{name: "Everyone write", sid: "S-1-1-0", permission: windows.FILE_GENERIC_WRITE},
		{name: "Authenticated Users Full Control", sid: "S-1-5-11", permission: windowsTestFileAllAccess},
		{name: "BUILTIN Users write data", sid: "S-1-5-32-545", permission: windows.FILE_WRITE_DATA},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "nimi-data")
			if err := os.MkdirAll(root, 0o700); err != nil {
				t.Fatal(err)
			}
			tokenUser, err := windows.GetCurrentProcessToken().GetTokenUser()
			if err != nil || tokenUser == nil || tokenUser.User.Sid == nil {
				t.Fatalf("resolve current user SID: %v", err)
			}
			serviceSID, err := windows.StringToSid(windowsTestRuntimeServiceSID)
			if err != nil {
				t.Fatal(err)
			}
			broadSID, err := windows.StringToSid(test.sid)
			if err != nil {
				t.Fatal(err)
			}
			installWindowsTestAccess(t, root, []windows.EXPLICIT_ACCESS{
				{
					AccessPermissions: windows.ACCESS_MASK(windowsProductControlFileModifyAccess),
					AccessMode:        windows.SET_ACCESS,
					Inheritance:       windows.SUB_CONTAINERS_AND_OBJECTS_INHERIT,
					Trustee: windows.TRUSTEE{
						TrusteeForm:  windows.TRUSTEE_IS_SID,
						TrusteeType:  windows.TRUSTEE_IS_UNKNOWN,
						TrusteeValue: windows.TrusteeValueFromSID(serviceSID),
					},
				},
				{
					AccessPermissions: test.permission,
					AccessMode:        windows.SET_ACCESS,
					Inheritance:       windows.SUB_CONTAINERS_AND_OBJECTS_INHERIT,
					Trustee: windows.TRUSTEE{
						TrusteeForm:  windows.TRUSTEE_IS_SID,
						TrusteeType:  windows.TRUSTEE_IS_UNKNOWN,
						TrusteeValue: windows.TrusteeValueFromSID(broadSID),
					},
				},
			})
			binding := ProductControlDataRootSecurityBinding{
				InteractiveUserSID: tokenUser.User.Sid.String(),
				RuntimeServiceSID:  windowsTestRuntimeServiceSID,
			}
			if err := validateProductControlDataRootPlatform(root, binding); err == nil ||
				!strings.Contains(err.Error(), "broad principal") {
				t.Fatalf("broad writable principal was not rejected: %v", err)
			}
		})
	}
}

func TestProductControlDataRootSecurityAllowsPrivilegedAndReadOnlyEntries(t *testing.T) {
	root := filepath.Join(t.TempDir(), "nimi-data")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	tokenUser, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || tokenUser == nil || tokenUser.User.Sid == nil {
		t.Fatalf("resolve current user SID: %v", err)
	}
	serviceSID, err := windows.StringToSid(windowsTestRuntimeServiceSID)
	if err != nil {
		t.Fatal(err)
	}
	systemSID, err := windows.StringToSid("S-1-5-18")
	if err != nil {
		t.Fatal(err)
	}
	administratorsSID, err := windows.StringToSid("S-1-5-32-544")
	if err != nil {
		t.Fatal(err)
	}
	everyoneSID, err := windows.StringToSid("S-1-1-0")
	if err != nil {
		t.Fatal(err)
	}
	authenticatedUsersSID, err := windows.StringToSid("S-1-5-11")
	if err != nil {
		t.Fatal(err)
	}
	usersSID, err := windows.StringToSid("S-1-5-32-545")
	if err != nil {
		t.Fatal(err)
	}
	entries := []windows.EXPLICIT_ACCESS{
		windowsTestAllowEntry(serviceSID, windowsProductControlFileModifyAccess),
		windowsTestAllowEntry(systemSID, windowsTestFileAllAccess),
		windowsTestAllowEntry(administratorsSID, windowsTestFileAllAccess),
		windowsTestAllowEntry(tokenUser.User.Sid, windowsTestFileAllAccess),
		windowsTestAllowEntry(everyoneSID, windows.FILE_GENERIC_READ),
		windowsTestAllowEntry(authenticatedUsersSID, windows.FILE_GENERIC_READ),
		windowsTestAllowEntry(usersSID, windows.FILE_GENERIC_READ),
	}
	installWindowsTestAccess(t, root, entries)
	binding := ProductControlDataRootSecurityBinding{
		InteractiveUserSID: tokenUser.User.Sid.String(),
		RuntimeServiceSID:  windowsTestRuntimeServiceSID,
	}
	if err := validateProductControlDataRootPlatform(root, binding); err != nil {
		t.Fatalf("privileged or read-only DACL entry was rejected: %v", err)
	}
}

func windowsTestAllowEntry(sid *windows.SID, permission uint32) windows.EXPLICIT_ACCESS {
	return windows.EXPLICIT_ACCESS{
		AccessPermissions: windows.ACCESS_MASK(permission),
		AccessMode:        windows.SET_ACCESS,
		Inheritance:       windows.SUB_CONTAINERS_AND_OBJECTS_INHERIT,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeType:  windows.TRUSTEE_IS_UNKNOWN,
			TrusteeValue: windows.TrusteeValueFromSID(sid),
		},
	}
}

func installWindowsTestAccess(t *testing.T, root string, entries []windows.EXPLICIT_ACCESS) {
	t.Helper()
	descriptor, err := windows.GetNamedSecurityInfo(
		root,
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION,
	)
	if err != nil || descriptor == nil {
		t.Fatalf("read original DACL: %v", err)
	}
	currentDACL, _, err := descriptor.DACL()
	if err != nil || currentDACL == nil {
		t.Fatalf("read original DACL entries: %v", err)
	}
	nextDACL, err := windows.ACLFromEntries(entries, currentDACL)
	if err != nil {
		t.Fatalf("build test DACL entries: %v", err)
	}
	if err := windows.SetNamedSecurityInfo(
		root,
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION,
		nil,
		nil,
		nextDACL,
		nil,
	); err != nil {
		t.Fatalf("install test DACL entries: %v", err)
	}
}
