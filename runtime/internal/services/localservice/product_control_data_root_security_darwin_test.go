//go:build darwin && cgo

package localservice

import (
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestMacOSProductControlDataRootSecurityValidatesExactRuntimeACL(t *testing.T) {
	root := filepath.Join(t.TempDir(), "nimi-data")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	serviceName, serviceUID := macOSTestRuntimeServiceIdentity(t)
	entries := []macOSACLEntry{{
		identifier:     serviceUID,
		identifierType: macOSACLIdentityUser,
		tagType:        macOSACLAllow,
		permissions:    macOSProductControlModifyPermissions,
		flags:          macOSACLFileInherit | macOSACLDirectoryInherit,
	}}
	if err := validateMacOSRuntimeACLEntryState(
		entries,
		serviceUID,
		macOSProductControlModifyPermissions,
		macOSACLFileInherit|macOSACLDirectoryInherit,
	); err != nil {
		t.Fatalf("exact Runtime ACL state rejected: %v", err)
	}
	entries[0].flags |= macOSACLInherited
	if err := validateMacOSRuntimeACLEntryState(
		entries,
		serviceUID,
		macOSProductControlModifyPermissions,
		macOSACLFileInherit|macOSACLDirectoryInherit,
	); err != nil {
		t.Fatalf("semantically exact inherited Runtime ACL state rejected: %v", err)
	}

	binding := ProductControlDataRootSecurityBinding{
		InteractiveUserUID: uint32(os.Getuid()) + 1,
		RuntimeServiceUID:  serviceUID,
	}
	installMacOSTestACLEntry(t, root, "user:"+serviceName+" allow "+macOSTestModifyPermissions+",file_inherit,directory_inherit")
	if err := validateProductControlDataRootPlatform(root, binding); err != nil {
		t.Fatalf("user-selected data root was rejected because its owner differs: %v", err)
	}
}

func TestMacOSProductControlDataRootSecurityRejectsSymlinkAndWrongInheritance(t *testing.T) {
	serviceName, serviceUID := macOSTestRuntimeServiceIdentity(t)
	binding := ProductControlDataRootSecurityBinding{
		InteractiveUserUID: uint32(os.Getuid()),
		RuntimeServiceUID:  serviceUID,
	}

	t.Run("symlink ancestor", func(t *testing.T) {
		target := filepath.Join(t.TempDir(), "target")
		if err := os.MkdirAll(filepath.Join(target, "nested"), 0o700); err != nil {
			t.Fatal(err)
		}
		link := filepath.Join(t.TempDir(), "linked")
		if err := os.Symlink(target, link); err != nil {
			t.Fatal(err)
		}
		if err := validateProductControlDataRootPlatform(filepath.Join(link, "nested"), binding); err == nil ||
			!strings.Contains(err.Error(), "direct directory") {
			t.Fatalf("symlink ancestor error = %v", err)
		}
	})

	t.Run("file-only inheritance", func(t *testing.T) {
		root := filepath.Join(t.TempDir(), "nimi-data")
		if err := os.Mkdir(root, 0o700); err != nil {
			t.Fatal(err)
		}
		installMacOSTestACLEntry(t, root, "user:"+serviceName+" allow "+macOSTestModifyPermissions+",file_inherit")
		if err := validateProductControlDataRootPlatform(root, binding); err == nil ||
			!strings.Contains(err.Error(), "one exact fixed Runtime service UID") {
			t.Fatalf("wrong selected-root inheritance error = %v", err)
		}
	})
}

func TestMacOSProductControlDataRootSecurityAllowsUserSelectedBroadWritablePrincipal(t *testing.T) {
	root := filepath.Join(t.TempDir(), "nimi-data")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	serviceName, serviceUID := macOSTestRuntimeServiceIdentity(t)
	installMacOSTestACLEntry(t, root, "user:"+serviceName+" allow "+macOSTestModifyPermissions+",file_inherit,directory_inherit")
	installMacOSTestACLEntry(t, root, "group:everyone allow add_file")

	err := validateProductControlDataRootPlatform(root, ProductControlDataRootSecurityBinding{
		InteractiveUserUID: uint32(os.Getuid()),
		RuntimeServiceUID:  serviceUID,
	})
	if err != nil {
		t.Fatalf("user-selected sharing ACL was rejected: %v", err)
	}
}

func TestMacOSProductControlRootSecurityLimitsRuntimeToHomeSearchAndImmediateFiles(t *testing.T) {
	home := t.TempDir()
	root := filepath.Join(home, ".nimi")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	_, serviceUID := macOSTestRuntimeServiceIdentity(t)
	homeEntries := []macOSACLEntry{{
		identifier:     serviceUID,
		identifierType: macOSACLIdentityUser,
		tagType:        macOSACLAllow,
		permissions:    macOSProductControlHomeSearchPermissions,
	}}
	rootEntries := []macOSACLEntry{{
		identifier:     serviceUID,
		identifierType: macOSACLIdentityUser,
		tagType:        macOSACLAllow,
		permissions:    macOSProductControlModifyPermissions,
		flags:          macOSACLFileInherit,
	}}
	if err := validateMacOSDirectoryACLState(
		0o700,
		homeEntries,
		serviceUID,
		macOSProductControlHomeSearchPermissions,
		0,
	); err != nil {
		t.Fatalf("exact home search ACL rejected: %v", err)
	}
	if err := validateMacOSDirectoryACLState(
		0o700,
		rootEntries,
		serviceUID,
		macOSProductControlModifyPermissions,
		macOSACLFileInherit,
	); err != nil {
		t.Fatalf("exact Product Control immediate-file ACL rejected: %v", err)
	}

	rootEntries[0].flags |= macOSACLDirectoryInherit
	if err := validateMacOSDirectoryACLState(
		0o700,
		rootEntries,
		serviceUID,
		macOSProductControlModifyPermissions,
		macOSACLFileInherit,
	); err == nil || !strings.Contains(err.Error(), "one exact fixed Runtime service UID") {
		t.Fatalf("Product Control directory inheritance error = %v", err)
	}

	if err := os.WriteFile(filepath.Join(root, "nimi.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := LoadProductControlDataRootBinding(root, ProductControlDataRootSecurityBinding{
		InteractiveUserUID: uint32(os.Getuid()),
		RuntimeServiceUID:  serviceUID,
	})
	if err == nil || !strings.Contains(err.Error(), "security validation") {
		t.Fatalf("Product Control record was read before root security validation: %v", err)
	}
}

const macOSTestModifyPermissions = "list,add_file,search,delete,add_subdirectory,readattr,writeattr,readextattr,writeextattr,readsecurity"

func macOSTestRuntimeServiceIdentity(t *testing.T) (string, uint32) {
	t.Helper()
	for _, name := range []string{"_softwareupdate", "_guest"} {
		account, err := user.Lookup(name)
		if err != nil || account == nil {
			continue
		}
		identifier, err := strconv.ParseUint(account.Uid, 10, 32)
		if err == nil && identifier != 0 && uint32(identifier) != uint32(os.Getuid()) {
			return name, uint32(identifier)
		}
	}
	t.Fatal("a fixed built-in non-login macOS test identity is required")
	return "", 0
}

func installMacOSTestACLEntry(t *testing.T, path string, entry string) {
	t.Helper()
	output, err := exec.Command("/bin/chmod", "+a", entry, path).CombinedOutput()
	if err != nil {
		t.Fatalf("install macOS ACL entry %q: %v: %s", entry, err, strings.TrimSpace(string(output)))
	}
}
