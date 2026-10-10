//go:build windows

package productrelease

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

func ProductRoot() (string, error) {
	programFiles, err := windows.KnownFolderPath(windows.FOLDERID_ProgramFiles, windows.KF_FLAG_DEFAULT)
	if err != nil {
		return "", fmt.Errorf("resolve product root: %w", err)
	}
	return filepath.Join(programFiles, "Nimi", "Product"), nil
}

// ValidateProductPath requires an actual administrative, read-only product
// tree, not an arbitrary unsigned file with matching basename or PE resource.
func ValidateProductPath(file string) (string, error) {
	root, err := ProductRoot()
	if err != nil {
		return "", err
	}
	releaseRoot, paths, err := productPathChain(root,file)
	if err != nil { return "", err }
	for _, current := range paths {
		if err := ValidateAdministrativePath(current); err != nil {
			return "", err
		}
	}
	return releaseRoot, nil
}

func ValidateAdministrativePath(file string) error {
	encoded, err := windows.UTF16PtrFromString(file)
	if err != nil {
		return err
	}
	attributes, err := windows.GetFileAttributes(encoded)
	if err != nil || attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return fmt.Errorf("untrusted product path")
	}
	descriptor, err := windows.GetNamedSecurityInfo(file, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return fmt.Errorf("read product ACL: %w", err)
	}
	owner, _, err := descriptor.Owner()
	if err != nil || owner == nil || (owner.String() != "S-1-5-18" && owner.String() != "S-1-5-32-544") {
		return fmt.Errorf("non-administrative product owner")
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil || dacl.AceCount == 0 {
		return fmt.Errorf("product DACL unavailable")
	}
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil {
			return fmt.Errorf("read product ACE: %w", err)
		}
		if ace.Header.AceType == windows.ACCESS_DENIED_ACE_TYPE {
			continue
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE {
			return fmt.Errorf("unsupported product ACE")
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart)).String()
		if sid == "S-1-5-18" || sid == "S-1-5-32-544" {
			continue
		}
		const mutable = windows.GENERIC_ALL | windows.GENERIC_WRITE | windows.DELETE | windows.WRITE_DAC | windows.WRITE_OWNER | windows.FILE_WRITE_DATA | windows.FILE_APPEND_DATA | windows.FILE_WRITE_EA | windows.FILE_WRITE_ATTRIBUTES | 0x40
		if ace.Mask&mutable != 0 {
			return fmt.Errorf("non-administrative product write authority")
		}
	}
	return nil
}

func VerifyInstalledExecutable(file, lockedDigest, role string, publicKey string) (Identity, error) {
	root, err := ValidateProductPath(file)
	if err != nil {
		return Identity{}, err
	}
	identityFile := filepath.Join(root, IdentityFile)
	if err := ValidateAdministrativePath(identityFile); err != nil {
		return Identity{}, err
	}
	raw, err := os.ReadFile(identityFile)
	if err != nil {
		return Identity{}, fmt.Errorf("read installed identity: %w", err)
	}
	identity, err := VerifyIdentity(raw, publicKey)
	if err != nil {
		return Identity{}, err
	}
	if filepath.Base(root) != identity.Version || !strings.EqualFold(filepath.Clean(file), filepath.Join(root, filepath.FromSlash(role))) || identity.Files[role] != lockedDigest {
		return Identity{}, fmt.Errorf("installed role identity mismatch")
	}
	if err := filepath.WalkDir(root, func(file string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		return ValidateAdministrativePath(file)
	}); err != nil {
		return Identity{}, err
	}
	if err := VerifyInventory(root, identity); err != nil {
		return Identity{}, err
	}
	return identity, nil
}

// An elevated formal forward-repair installer may stop an already owned fixed
// service whose code is damaged or missing. It authenticates the old admitted
// service definition without executing or admitting those broken bytes. Normal
// Runtime/Home caller admission above still requires the entire actual cohort.
func ReadServiceDefinitionForForwardRepair(file, publicKey string) (Identity, error) {
	root := filepath.Dir(filepath.Dir(file))
	identityFile := filepath.Join(root, IdentityFile)
	actualRoot, err := ValidateProductPath(identityFile)
	if err != nil || !strings.EqualFold(root, actualRoot) {
		return Identity{}, fmt.Errorf("unadmitted prior service root")
	}
	if !strings.EqualFold(file, filepath.Join(root, "runtime", "nimi.exe")) {
		return Identity{}, fmt.Errorf("unadmitted prior service role")
	}
	raw, err := os.ReadFile(identityFile)
	if err != nil {
		return Identity{}, err
	}
	identity, err := VerifyIdentity(raw, publicKey)
	if err != nil {
		return Identity{}, err
	}
	if filepath.Base(root) != identity.Version {
		return Identity{}, fmt.Errorf("prior service identity mismatch")
	}
	return identity, nil
}
