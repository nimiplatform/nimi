//go:build windows

package protectedlocal

import (
	"fmt"
	"golang.org/x/sys/windows"
	"os"
	"path/filepath"
)

// @nimi-authority: rule.nimi.runtime.service-operations.r054
// ProvisionWindowsProductCustody is the formal elevated installer entry. It
// selects the fixed production root, preserves existing valid custody and
// creates only the missing root. It never takes caller-selected paths or
// rewrites, migrates or restores protected Runtime data.
func ProvisionWindowsProductCustody() error {
	var token windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_QUERY|windows.TOKEN_ADJUST_PRIVILEGES, &token); err != nil {
		return fmt.Errorf("open installer token: %w", err)
	}
	defer token.Close()
	if !token.IsElevated() {
		return fmt.Errorf("elevated formal installer required")
	}
	for _, name := range []string{"SeRestorePrivilege", "SeBackupPrivilege"} {
		wide, _ := windows.UTF16PtrFromString(name)
		var luid windows.LUID
		if err := windows.LookupPrivilegeValue(nil, wide, &luid); err != nil {
			return fmt.Errorf("lookup installer privilege: %w", err)
		}
		privileges := windows.Tokenprivileges{PrivilegeCount: 1}
		privileges.Privileges[0] = windows.LUIDAndAttributes{Luid: luid, Attributes: windows.SE_PRIVILEGE_ENABLED}
		if err := windows.AdjustTokenPrivileges(token, false, &privileges, 0, nil, nil); err != nil {
			return fmt.Errorf("enable installer privilege: %w", err)
		}
	}
	programData, err := windows.KnownFolderPath(windows.FOLDERID_ProgramData, windows.KF_FLAG_DEFAULT)
	if err != nil {
		return err
	}
	root := filepath.Join(programData, WindowsRuntimeStateRelativePath())
	if _, err := os.Stat(root); err == nil {
		_, err = inspectWindowsStateRoot(root, WindowsProductionServiceSID, nil)
		return err
	} else if !os.IsNotExist(err) {
		return err
	}
	parent := filepath.Dir(root)
	if err := os.MkdirAll(parent, 0700); err != nil {
		return err
	}
	if _, err := validateWindowsStateRootPath(parent); err != nil {
		return err
	}
	if err := os.Mkdir(root, 0700); err != nil {
		return err
	}
	descriptor, err := windows.SecurityDescriptorFromString("O:" + WindowsProductionServiceSID + "D:P(A;OICI;FA;;;" + WindowsProductionServiceSID + ")")
	if err != nil {
		return err
	}
	owner, _, err := descriptor.Owner()
	if err != nil {
		return err
	}
	acl, _, err := descriptor.DACL()
	if err != nil {
		return err
	}
	if err := windows.SetNamedSecurityInfo(root, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, owner, nil, acl, nil); err != nil {
		return fmt.Errorf("provision product custody: %w", err)
	}
	_, err = inspectWindowsStateRoot(root, WindowsProductionServiceSID, nil)
	return err
}
