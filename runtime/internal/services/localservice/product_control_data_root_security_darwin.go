//go:build darwin && cgo

package localservice

/*
#include <errno.h>
#include <membership.h>
#include <stdint.h>
#include <stdlib.h>
#include <sys/acl.h>

typedef struct {
	uint32_t identifier;
	int32_t identifier_type;
	int32_t tag_type;
	uint64_t permissions;
	uint32_t flags;
} nimi_macos_acl_entry;

static int nimi_macos_read_acl(
	const char *path,
	nimi_macos_acl_entry *entries,
	uint32_t capacity,
	uint32_t *count,
	int *failure_errno
) {
	if (path == NULL || entries == NULL || count == NULL || failure_errno == NULL) {
		return -1;
	}
	*count = 0;
	*failure_errno = 0;
	errno = 0;
	acl_t acl = acl_get_file(path, ACL_TYPE_EXTENDED);
	if (acl == NULL) {
		if (errno == ENOATTR) {
			return 0;
		}
		*failure_errno = errno == 0 ? EIO : errno;
		return -1;
	}

	for (uint32_t index = 0; index < capacity; index++) {
		acl_entry_t entry = NULL;
		errno = 0;
		int result = acl_get_entry(acl, (int)index, &entry);
		if (result < 0) {
			if (errno == EINVAL) {
				break;
			}
			*failure_errno = errno == 0 ? EIO : errno;
			acl_free(acl);
			return -1;
		}

		acl_tag_t tag = ACL_UNDEFINED_TAG;
		acl_permset_mask_t permissions = 0;
		acl_flagset_t flagset = NULL;
		void *qualifier = NULL;
		id_t identifier = 0;
		int identifier_type = -1;
		if (acl_get_tag_type(entry, &tag) != 0 ||
			acl_get_permset_mask_np(entry, &permissions) != 0 ||
			acl_get_flagset_np(entry, &flagset) != 0 ||
			(qualifier = acl_get_qualifier(entry)) == NULL ||
			mbr_uuid_to_id((const unsigned char *)qualifier, &identifier, &identifier_type) != 0) {
			*failure_errno = errno == 0 ? EIO : errno;
			if (qualifier != NULL) {
				acl_free(qualifier);
			}
			acl_free(acl);
			return -1;
		}

		uint32_t flags = 0;
		if (acl_get_flag_np(flagset, ACL_ENTRY_INHERITED) == 1) {
			flags |= ACL_ENTRY_INHERITED;
		}
		if (acl_get_flag_np(flagset, ACL_ENTRY_FILE_INHERIT) == 1) {
			flags |= ACL_ENTRY_FILE_INHERIT;
		}
		if (acl_get_flag_np(flagset, ACL_ENTRY_DIRECTORY_INHERIT) == 1) {
			flags |= ACL_ENTRY_DIRECTORY_INHERIT;
		}
		if (acl_get_flag_np(flagset, ACL_ENTRY_LIMIT_INHERIT) == 1) {
			flags |= ACL_ENTRY_LIMIT_INHERIT;
		}
		if (acl_get_flag_np(flagset, ACL_ENTRY_ONLY_INHERIT) == 1) {
			flags |= ACL_ENTRY_ONLY_INHERIT;
		}
		acl_free(qualifier);

		entries[*count].identifier = (uint32_t)identifier;
		entries[*count].identifier_type = identifier_type;
		entries[*count].tag_type = (int32_t)tag;
		entries[*count].permissions = (uint64_t)permissions;
		entries[*count].flags = flags;
		(*count)++;
	}
	acl_free(acl);
	return 0;
}
*/
import "C"

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const (
	macOSACLIdentityUser  = int32(C.ID_TYPE_UID)
	macOSACLIdentityGroup = int32(C.ID_TYPE_GID)
	macOSACLAllow         = int32(C.ACL_EXTENDED_ALLOW)

	macOSACLFileInherit      = uint32(C.ACL_ENTRY_FILE_INHERIT)
	macOSACLDirectoryInherit = uint32(C.ACL_ENTRY_DIRECTORY_INHERIT)
	macOSACLInherited        = uint32(C.ACL_ENTRY_INHERITED)

	macOSProductControlHomeSearchPermissions = uint64(C.ACL_EXECUTE)

	macOSProductControlModifyPermissions = uint64(C.ACL_READ_DATA) |
		uint64(C.ACL_WRITE_DATA) |
		uint64(C.ACL_EXECUTE) |
		uint64(C.ACL_DELETE) |
		uint64(C.ACL_APPEND_DATA) |
		uint64(C.ACL_READ_ATTRIBUTES) |
		uint64(C.ACL_WRITE_ATTRIBUTES) |
		uint64(C.ACL_READ_EXTATTRIBUTES) |
		uint64(C.ACL_WRITE_EXTATTRIBUTES) |
		uint64(C.ACL_READ_SECURITY) |
		uint64(C.ACL_SYNCHRONIZE)

	macOSProductControlBroadMutationPermissions = uint64(C.ACL_WRITE_DATA) |
		uint64(C.ACL_DELETE) |
		uint64(C.ACL_APPEND_DATA) |
		uint64(C.ACL_DELETE_CHILD) |
		uint64(C.ACL_WRITE_ATTRIBUTES) |
		uint64(C.ACL_WRITE_EXTATTRIBUTES) |
		uint64(C.ACL_WRITE_SECURITY) |
		uint64(C.ACL_CHANGE_OWNER)
)

type macOSACLEntry struct {
	identifier     uint32
	identifierType int32
	tagType        int32
	permissions    uint64
	flags          uint32
}

func validateProductControlRootPlatform(root string, security ProductControlDataRootSecurityBinding) error {
	interactiveUserUID := security.InteractiveUserUID
	runtimeServiceUID := security.RuntimeServiceUID
	if interactiveUserUID == 0 && runtimeServiceUID == 0 {
		if _, err := os.Lstat(root); os.IsNotExist(err) {
			return nil
		}
		_, err := validateMacOSDirectDirectoryChain(root)
		return err
	}
	if interactiveUserUID == 0 || runtimeServiceUID == 0 || interactiveUserUID == runtimeServiceUID {
		return fmt.Errorf("Product Control root security validation requires distinct interactive-user and Runtime service UIDs")
	}
	if _, err := os.Lstat(root); os.IsNotExist(err) {
		return nil
	}

	home := filepath.Dir(root)
	homeInfo, err := validateMacOSDirectDirectoryChain(home)
	if err != nil {
		return fmt.Errorf("interactive-user home path validation failed: %w", err)
	}
	if err := validateMacOSDirectoryOwner(homeInfo, interactiveUserUID); err != nil {
		return fmt.Errorf("interactive-user home %w", err)
	}
	if err := validateMacOSDirectoryACL(
		home,
		homeInfo,
		runtimeServiceUID,
		macOSProductControlHomeSearchPermissions,
		0,
	); err != nil {
		return fmt.Errorf("interactive-user home ACL validation failed: %w", err)
	}

	rootInfo, err := validateMacOSDirectDirectoryChain(root)
	if err != nil {
		return fmt.Errorf("Product Control root path validation failed: %w", err)
	}
	if err := validateMacOSDirectoryOwner(rootInfo, interactiveUserUID); err != nil {
		return fmt.Errorf("Product Control root %w", err)
	}
	return validateMacOSDirectoryACL(
		root,
		rootInfo,
		runtimeServiceUID,
		macOSProductControlModifyPermissions,
		macOSACLFileInherit,
	)
}

func validateProductControlDataRootPlatform(root string, security ProductControlDataRootSecurityBinding) error {
	info, err := validateMacOSDirectDirectoryChain(root)
	if err != nil {
		return err
	}
	interactiveUserUID := security.InteractiveUserUID
	runtimeServiceUID := security.RuntimeServiceUID
	if interactiveUserUID == 0 && runtimeServiceUID == 0 {
		return nil
	}
	if interactiveUserUID == 0 || runtimeServiceUID == 0 || interactiveUserUID == runtimeServiceUID {
		return fmt.Errorf("data root security validation requires distinct interactive-user and Runtime service UIDs")
	}
	if err := validateMacOSDirectoryOwner(info, interactiveUserUID); err != nil {
		return fmt.Errorf("data root %w", err)
	}
	return validateMacOSDirectoryACL(
		root,
		info,
		runtimeServiceUID,
		macOSProductControlModifyPermissions,
		macOSACLFileInherit|macOSACLDirectoryInherit,
	)
}

func validateMacOSDirectDirectoryChain(root string) (os.FileInfo, error) {
	cleaned := filepath.Clean(strings.TrimSpace(root))
	if cleaned == "." || !filepath.IsAbs(cleaned) || cleaned == string(filepath.Separator) {
		return nil, fmt.Errorf("path must be an absolute non-root directory")
	}
	// Darwin exposes these fixed, root-owned compatibility aliases even for
	// paths returned by the system temporary-directory APIs. Normalize only
	// those OS aliases; every remaining component is still inspected with
	// lstat and arbitrary symlink traversal remains forbidden.
	for alias, canonical := range map[string]string{
		"/etc": "/private/etc",
		"/tmp": "/private/tmp",
		"/var": "/private/var",
	} {
		if cleaned == alias || strings.HasPrefix(cleaned, alias+string(filepath.Separator)) {
			cleaned = canonical + strings.TrimPrefix(cleaned, alias)
			break
		}
	}
	current := string(filepath.Separator)
	var last os.FileInfo
	for _, component := range strings.Split(strings.TrimPrefix(cleaned, string(filepath.Separator)), string(filepath.Separator)) {
		if component == "" {
			continue
		}
		current = filepath.Join(current, component)
		info, err := os.Lstat(current)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("path component is not a direct directory (%s)", current)
		}
		last = info
	}
	if last == nil {
		return nil, fmt.Errorf("path directory is unavailable")
	}
	return last, nil
}

func validateMacOSDirectoryOwner(info os.FileInfo, interactiveUserUID uint32) error {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != interactiveUserUID {
		return fmt.Errorf("owner does not match the verified interactive user")
	}
	return nil
}

func validateMacOSDirectoryACL(
	path string,
	info os.FileInfo,
	runtimeServiceUID uint32,
	expectedPermissions uint64,
	expectedFlags uint32,
) error {
	entries, err := readMacOSACLEntries(path)
	if err != nil {
		return fmt.Errorf("read directory ACL: %w", err)
	}
	return validateMacOSDirectoryACLState(
		info.Mode(),
		entries,
		runtimeServiceUID,
		expectedPermissions,
		expectedFlags,
	)
}

func validateMacOSDirectoryACLState(
	mode os.FileMode,
	entries []macOSACLEntry,
	runtimeServiceUID uint32,
	expectedPermissions uint64,
	expectedFlags uint32,
) error {
	if mode.Perm()&0o022 != 0 {
		return fmt.Errorf("directory grants write authority through broad POSIX mode bits")
	}
	matchingRuntimeEntries := 0
	exactRuntimeEntry := false
	for _, entry := range entries {
		if entry.tagType == macOSACLAllow &&
			entry.identifierType == macOSACLIdentityGroup &&
			isMacOSProductControlBroadGroup(entry.identifier) &&
			entry.permissions&macOSProductControlBroadMutationPermissions != 0 {
			return fmt.Errorf("directory ACL grants write authority to a broad principal")
		}
		if entry.identifierType != macOSACLIdentityUser || entry.identifier != runtimeServiceUID {
			continue
		}
		matchingRuntimeEntries++
		if entry.tagType == macOSACLAllow &&
			entry.permissions == expectedPermissions &&
			entry.flags&^macOSACLInherited == expectedFlags {
			exactRuntimeEntry = true
		}
	}
	if matchingRuntimeEntries != 1 || !exactRuntimeEntry {
		return fmt.Errorf("directory ACL lacks the one exact fixed Runtime service UID entry")
	}
	return nil
}

func isMacOSProductControlBroadGroup(gid uint32) bool {
	switch gid {
	case 12, // everyone
		20, // staff
		50, // authedusers
		51, // interactusers
		52, // netusers
		53, // consoleusers
		61, // localaccounts
		62: // netaccounts
		return true
	default:
		return false
	}
}

func readMacOSACLEntries(path string) ([]macOSACLEntry, error) {
	nativePath := C.CString(path)
	defer C.free(unsafe.Pointer(nativePath))
	nativeEntries := make([]C.nimi_macos_acl_entry, C.ACL_MAX_ENTRIES)
	var count C.uint32_t
	var failureErrno C.int
	if result := C.nimi_macos_read_acl(
		nativePath,
		&nativeEntries[0],
		C.uint32_t(len(nativeEntries)),
		&count,
		&failureErrno,
	); result != 0 {
		return nil, syscall.Errno(failureErrno)
	}
	entries := make([]macOSACLEntry, int(count))
	for index := range entries {
		entries[index] = macOSACLEntry{
			identifier:     uint32(nativeEntries[index].identifier),
			identifierType: int32(nativeEntries[index].identifier_type),
			tagType:        int32(nativeEntries[index].tag_type),
			permissions:    uint64(nativeEntries[index].permissions),
			flags:          uint32(nativeEntries[index].flags),
		}
	}
	return entries, nil
}
