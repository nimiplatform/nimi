//go:build darwin && cgo

package localappkernel

/*
#include <errno.h>
#include <membership.h>
#include <string.h>
#include <sys/acl.h>
#include <sys/stat.h>
#include <unistd.h>

// Work on the opened directory. Add one effective, non-inheriting search
// entry for the verified GUI uid. Preserve all existing ACL entries and order.
static int grantSearch(int fd, uid_t uid) {
	struct stat st;
	if (fstat(fd, &st) != 0) return errno;
	if (!S_ISDIR(st.st_mode)) return ENOTDIR;
	if (st.st_uid != geteuid() || st.st_uid == uid || (st.st_mode & S_IXOTH)) return 0;
	uuid_t user;
	int result = mbr_uid_to_uuid(uid, user);
	if (result != 0) return result;
	acl_t acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED);
	if (!acl) {
		if (errno != ENOENT && errno != ENOATTR) return errno;
		acl = acl_init(1);
		if (!acl) return errno;
	}
	acl_entry_t entry;
	int step = ACL_FIRST_ENTRY;
	while (acl_get_entry(acl, step, &entry) == 0) {
		step = ACL_NEXT_ENTRY;
		acl_tag_t tag;
		acl_permset_t perms;
		acl_flagset_t flags;
		if (acl_get_tag_type(entry, &tag) || acl_get_permset(entry, &perms) || acl_get_flagset_np(entry, &flags)) goto failed;
		if (tag != ACL_EXTENDED_ALLOW || acl_get_perm_np(perms, ACL_SEARCH) != 1 || acl_get_flag_np(flags, ACL_ENTRY_ONLY_INHERIT) == 1) continue;
		void *qualifier = acl_get_qualifier(entry);
		if (!qualifier) goto failed;
		int matches = memcmp(qualifier, user, sizeof(user)) == 0;
		acl_free(qualifier);
		if (matches) { acl_free(acl); return 0; }
	}
	if (errno != EINVAL) goto failed;
	acl_permset_t perms;
	if (acl_create_entry(&acl, &entry) || acl_set_tag_type(entry, ACL_EXTENDED_ALLOW) ||
	    acl_set_qualifier(entry, user) || acl_get_permset(entry, &perms) ||
	    acl_add_perm(perms, ACL_SEARCH) || acl_set_fd_np(fd, acl, ACL_TYPE_EXTENDED)) goto failed;
	acl_free(acl);
	return 0;
failed:
	result = errno ? errno : EINVAL;
	acl_free(acl);
	return result;
}
*/
import "C"

import (
	"fmt"
	"io"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

// A fixed service owns the private apps directory. Provision its one search
// right before creating any private state. Existing populated data roots
// retain their ACLs; legacy roots are repaired separately after inspection.
func prepareNewAppDirectory(dir string, user VerifiedLocalOSUserIdentity) error {
	uid, _, ok := user.MacOSInteractiveUser()
	if !ok || int(uid) == os.Geteuid() {
		return nil
	}
	fd, err := unix.Open(dir, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return fmt.Errorf("open installed App directory: %w", err)
	}
	f := os.NewFile(uintptr(fd), dir)
	defer func() { _ = f.Close() }()
	names, err := f.Readdirnames(1)
	if err != nil && err != io.EOF {
		return err
	}
	if len(names) != 0 {
		return nil
	}
	return grantAppDirectorySearch(fd, uid)
}

func grantAppDirectorySearch(fd int, uid uint32) error {
	if status := C.grantSearch(C.int(fd), C.uid_t(uid)); status != 0 {
		return fmt.Errorf("prepare GUI traversal of installed App directory: %w", syscall.Errno(status))
	}
	return nil
}
