//go:build darwin && cgo

package appstorage

/*

#include <errno.h>
#include <limits.h>
#include <membership.h>
#include <string.h>
#include <sys/acl.h>
#include <sys/attr.h>
#include <sys/fsgetpath.h>
#include <sys/mount.h>
#include <unistd.h>

static int finder_volume(int fd, unsigned char *uuid) {
    struct attrlist a = {.bitmapcount = ATTR_BIT_MAP_COUNT,
                         .volattr = ATTR_VOL_INFO | ATTR_VOL_UUID};
    struct {
        uint32_t length;
        uuid_t uuid;
    } result;
    if (fgetattrlist(fd, &a, &result, sizeof(result), 0))
        return errno;
    if (result.length != sizeof(result))
        return EIO;
    memcpy(uuid, result.uuid, sizeof(result.uuid));
    return 0;
}

// Resolve only a recorded directory on a volume already matched by UUID.
// This tolerates a user moving the selected data root between daemon runs.
static int finder_path(int volume_fd, uint64_t ino, char *buf) {
    struct statfs st;
    if (fstatfs(volume_fd, &st))
        return errno;
    return fsgetpath(buf, PATH_MAX, &st.f_fsid, ino) < 0 ? errno : 0;
}

static int finder_add_entry(acl_t *acl, uid_t uid, acl_permset_mask_t mask) {
    uuid_t u;
    int e = mbr_uid_to_uuid(uid, u);
    if (e)
        return e;
    acl_entry_t entry;
    if (acl_create_entry(acl, &entry) || acl_set_tag_type(entry, ACL_EXTENDED_ALLOW) ||
        acl_set_qualifier(entry, u) || acl_set_permset_mask_np(entry, mask))
        return errno;
    return 0;
}

// Only newly created view directories use an entirely new ACL. They never
// inherit permissions from the selected data root. The owner retains mode 0700.
static int finder_directory(int fd, uid_t uid) {
    acl_t acl = acl_init(1);
    if (!acl)
        return errno;
    int e = uid ? finder_add_entry(&acl, uid, ACL_LIST_DIRECTORY | ACL_SEARCH | ACL_READ_ATTRIBUTES)
                : 0;
    if (!e && acl_set_fd_np(fd, acl, ACL_TYPE_EXTENDED))
        e = errno;
    acl_free(acl);
    return e;
}

// A read-only handoff cannot publish a file on which its recipient has
// mutation rights. For directory anchors, only the daemon may have them.
static int finder_mutation_acl(int fd, uid_t uid) {
    uuid_t viewer, owner;
    int err = mbr_uid_to_uuid(geteuid(), owner);
    if (err)
        return err;
    if (uid && (err = mbr_uid_to_uuid(uid, viewer)))
        return err;
    acl_t acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED);
    if (!acl)
        return (errno == ENOATTR || errno == ENOENT) ? 0 : errno;
    acl_entry_t entry;
    int step = ACL_FIRST_ENTRY;
    while (!acl_get_entry(acl, step, &entry)) {
        step = ACL_NEXT_ENTRY;
        acl_tag_t tag;
        acl_permset_mask_t mask;
        if (acl_get_tag_type(entry, &tag) || acl_get_permset_mask_np(entry, &mask)) {
            err = errno;
            break;
        }
        if (tag != ACL_EXTENDED_ALLOW ||
            !(mask & (ACL_WRITE_DATA | ACL_APPEND_DATA | ACL_DELETE | ACL_DELETE_CHILD |
                      ACL_WRITE_ATTRIBUTES | ACL_WRITE_EXTATTRIBUTES | ACL_WRITE_SECURITY |
                      ACL_CHANGE_OWNER)))
            continue;
        void *who = acl_get_qualifier(entry);
        if (!who) {
            err = errno;
            break;
        }
        if (memcmp(who, owner, sizeof(owner))) {
            if (!uid || !memcmp(who, viewer, sizeof(viewer))) {
                err = EACCES;
            } else {
                id_t id = 0;
                int type = 0, member = 0;
                if (mbr_uuid_to_id(who, &id, &type) != 0 || type != ID_TYPE_UID) {
                    err = mbr_check_membership(viewer, who, &member);
                    if (!err && member)
                        err = EACCES;
                }
            }
        }
        acl_free(who);
        if (err)
            break;
    }
    if (!err && errno != EINVAL)
        err = errno;
    acl_free(acl);
    return err;
}

// Inspect, add, or remove precisely our non-inherited read ACE. The private
// recovery record says whether the identical entry already existed.
static int finder_file(int fd, uid_t uid, int action, int *present) {
    const acl_permset_mask_t mask = ACL_READ_DATA | ACL_READ_ATTRIBUTES;
    uuid_t u;
    int e = mbr_uid_to_uuid(uid, u);
    if (e)
        return e;
    acl_t acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED);
    if (!acl) {
        if (errno != ENOATTR && errno != ENOENT)
            return errno;
        if (!(acl = acl_init(1)))
            return errno;
    }
    acl_entry_t entry;
    int step = ACL_FIRST_ENTRY;
    *present = 0;
    while (!acl_get_entry(acl, step, &entry)) {
        step = ACL_NEXT_ENTRY;
        acl_tag_t tag;
        acl_permset_mask_t perms;
        acl_flagset_t flags;
        if (acl_get_tag_type(entry, &tag) || acl_get_permset_mask_np(entry, &perms) ||
            acl_get_flagset_np(entry, &flags)) {
            e = errno;
            goto out;
        }
        if (tag != ACL_EXTENDED_ALLOW || perms != mask ||
            acl_get_flag_np(flags, ACL_ENTRY_INHERITED) ||
            acl_get_flag_np(flags, ACL_ENTRY_ONLY_INHERIT) ||
            acl_get_flag_np(flags, ACL_ENTRY_FILE_INHERIT) ||
            acl_get_flag_np(flags, ACL_ENTRY_DIRECTORY_INHERIT) ||
            acl_get_flag_np(flags, ACL_ENTRY_LIMIT_INHERIT))
            continue;
        void *who = acl_get_qualifier(entry);
        if (!who) {
            e = errno;
            goto out;
        }
        int match = !memcmp(who, u, sizeof(u));
        acl_free(who);
        if (!match)
            continue;
        *present = 1;
        if (action < 0 &&
            (acl_delete_entry(acl, entry) || acl_set_fd_np(fd, acl, ACL_TYPE_EXTENDED)))
            e = errno;
        goto out;
    }
    if (errno != EINVAL) {
        e = errno;
        goto out;
    }
    if (action > 0) {
        e = finder_add_entry(&acl, uid, mask);
        if (!e && acl_set_fd_np(fd, acl, ACL_TYPE_EXTENDED))
            e = errno;
    }
out:
    acl_free(acl);
    return e;
}
*/
import "C"

import (
	"os"
	"syscall"
	"unsafe"

	"golang.org/x/sys/unix"
)

type finderIdentity struct {
	Volume [16]byte
	Inode  uint64
	Birth  unix.Timespec
}

func finderStat(f *os.File) (finderIdentity, unix.Stat_t, error) {
	var id finderIdentity
	var st unix.Stat_t
	err := unix.Fstat(int(f.Fd()), &st)
	if err == nil {
		if e := C.finder_volume(C.int(f.Fd()), (*C.uchar)(unsafe.Pointer(&id.Volume[0]))); e != 0 {
			err = syscall.Errno(e)
		}
	}
	id.Inode, id.Birth = st.Ino, st.Btim
	return id, st, err
}

func setFinderDirectory(f *os.File, uid uint32) error {
	if e := C.finder_directory(C.int(f.Fd()), C.uid_t(uid)); e != 0 {
		return syscall.Errno(e)
	}
	return nil
}

func finderReadACE(f *os.File, uid uint32, action int) (bool, error) {
	var present C.int
	if e := C.finder_file(C.int(f.Fd()), C.uid_t(uid), C.int(action), &present); e != 0 {
		return false, syscall.Errno(e)
	}
	return present != 0, nil
}

func checkFinderMutationACL(f *os.File, uid uint32) error {
	if e := C.finder_mutation_acl(C.int(f.Fd()), C.uid_t(uid)); e != 0 {
		return syscall.Errno(e)
	}
	return nil
}

func recordedFinderPath(volume *os.File, id finderIdentity) (string, error) {
	var buf [C.PATH_MAX]C.char
	if e := C.finder_path(C.int(volume.Fd()), C.uint64_t(id.Inode), &buf[0]); e != 0 {
		return "", syscall.Errno(e)
	}
	return C.GoString(&buf[0]), nil
}
