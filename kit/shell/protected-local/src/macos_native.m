#import <CoreFoundation/CoreFoundation.h>
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <Security/SecCode.h>
#import <Security/SecRequirement.h>
#import <ServiceManagement/ServiceManagement.h>

#include "macos_profile.h"

#include <bsm/libbsm.h>
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <libproc.h>
#include <limits.h>
#include <membership.h>
#include <pwd.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/acl.h>
#include <sys/event.h>
#include <sys/proc_info.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

enum {
    NIMI_MACOS_ACL_SEARCH_DIRECTORY = 1,
    NIMI_MACOS_ACL_PRODUCT_CONTROL_DIRECTORY = 2,
    NIMI_MACOS_ACL_DATA_DIRECTORY = 3,
    NIMI_MACOS_ACL_MODIFY_FILE = 4,
};

static const acl_permset_mask_t NIMI_MACOS_ACL_SEARCH_MASK = ACL_SEARCH;
static const acl_permset_mask_t NIMI_MACOS_ACL_MODIFY_MASK =
    ACL_READ_DATA | ACL_WRITE_DATA | ACL_EXECUTE | ACL_DELETE | ACL_APPEND_DATA |
    ACL_READ_ATTRIBUTES | ACL_WRITE_ATTRIBUTES | ACL_READ_EXTATTRIBUTES |
    ACL_WRITE_EXTATTRIBUTES | ACL_READ_SECURITY | ACL_SYNCHRONIZE;
static const acl_permset_mask_t NIMI_MACOS_ACL_BROAD_MUTATION_MASK =
    ACL_WRITE_DATA | ACL_DELETE | ACL_APPEND_DATA | ACL_DELETE_CHILD |
    ACL_WRITE_ATTRIBUTES | ACL_WRITE_EXTATTRIBUTES | ACL_WRITE_SECURITY |
    ACL_CHANGE_OWNER;

static int nimi_fixed_runtime_service_identity(uid_t *uid, gid_t *gid, uuid_t uuid) {
    if (uid == NULL || gid == NULL || uuid == NULL) return EINVAL;
    errno = 0;
    struct passwd *account = getpwnam(NIMI_MACOS_RUNTIME_ACCOUNT);
    int account_error = errno;
    if (account == NULL) return account_error != 0 ? account_error : ENOENT;
    if (account->pw_name == NULL || account->pw_dir == NULL || account->pw_shell == NULL ||
        strcmp(account->pw_name, NIMI_MACOS_RUNTIME_ACCOUNT) != 0 ||
        account->pw_uid != account->pw_gid || account->pw_uid < 450 || account->pw_uid > 499 ||
        strcmp(account->pw_dir, "/var/empty") != 0 ||
        strcmp(account->pw_shell, "/usr/bin/false") != 0) {
        return EACCES;
    }
    uid_t account_uid = account->pw_uid;
    gid_t account_gid = account->pw_gid;
    errno = 0;
    struct group *group = getgrnam(NIMI_MACOS_RUNTIME_ACCOUNT);
    int group_error = errno;
    if (group == NULL) return group_error != 0 ? group_error : ENOENT;
    if (group->gr_name == NULL ||
        strcmp(group->gr_name, NIMI_MACOS_RUNTIME_ACCOUNT) != 0 ||
        account_gid != group->gr_gid) {
        return EACCES;
    }
    int status = mbr_uid_to_uuid(account_uid, uuid);
    if (status != 0) return status;
    *uid = account_uid;
    *gid = account_gid;
    return 0;
}

static int nimi_fixed_runtime_service_uid(uid_t *output) {
    if (output == NULL) return EINVAL;
    gid_t ignored_gid = 0;
    uuid_t ignored_uuid;
    return nimi_fixed_runtime_service_identity(output, &ignored_gid, ignored_uuid);
}

static int nimi_acl_policy(int policy, mode_t file_mode,
                           acl_permset_mask_t *expected_permissions,
                           uint32_t *expected_flags) {
    if (expected_permissions == NULL || expected_flags == NULL) return EINVAL;
    switch (policy) {
        case NIMI_MACOS_ACL_SEARCH_DIRECTORY:
            if (!S_ISDIR(file_mode)) return ENOTDIR;
            *expected_permissions = NIMI_MACOS_ACL_SEARCH_MASK;
            *expected_flags = 0;
            return 0;
        case NIMI_MACOS_ACL_PRODUCT_CONTROL_DIRECTORY:
            if (!S_ISDIR(file_mode)) return ENOTDIR;
            *expected_permissions = NIMI_MACOS_ACL_MODIFY_MASK;
            *expected_flags = ACL_ENTRY_FILE_INHERIT;
            return 0;
        case NIMI_MACOS_ACL_DATA_DIRECTORY:
            if (!S_ISDIR(file_mode)) return ENOTDIR;
            *expected_permissions = NIMI_MACOS_ACL_MODIFY_MASK;
            *expected_flags = ACL_ENTRY_FILE_INHERIT | ACL_ENTRY_DIRECTORY_INHERIT;
            return 0;
        case NIMI_MACOS_ACL_MODIFY_FILE:
            if (!S_ISREG(file_mode)) return EINVAL;
            *expected_permissions = NIMI_MACOS_ACL_MODIFY_MASK;
            *expected_flags = 0;
            return 0;
        default:
            return EINVAL;
    }
}

static int nimi_acl_entry_flags(acl_entry_t entry, uint32_t *output) {
    if (entry == NULL || output == NULL) return EINVAL;
    acl_flagset_t flagset = NULL;
    if (acl_get_flagset_np(entry, &flagset) != 0 || flagset == NULL) {
        return errno == 0 ? EIO : errno;
    }
    const acl_flag_t flags[] = {
        ACL_ENTRY_INHERITED,
        ACL_ENTRY_FILE_INHERIT,
        ACL_ENTRY_DIRECTORY_INHERIT,
        ACL_ENTRY_LIMIT_INHERIT,
        ACL_ENTRY_ONLY_INHERIT,
    };
    uint32_t value = 0;
    for (size_t index = 0; index < sizeof(flags) / sizeof(flags[0]); index++) {
        int present = acl_get_flag_np(flagset, flags[index]);
        if (present < 0) return errno == 0 ? EIO : errno;
        if (present != 0) value |= (uint32_t)flags[index];
    }
    *output = value;
    return 0;
}

static int nimi_acl_entry_matches_uuid(acl_entry_t entry, const uuid_t expected, int *matches) {
    if (entry == NULL || expected == NULL || matches == NULL) return EINVAL;
    *matches = 0;
    acl_tag_t tag = ACL_UNDEFINED_TAG;
    if (acl_get_tag_type(entry, &tag) != 0) return errno == 0 ? EIO : errno;
    if (tag != ACL_EXTENDED_ALLOW && tag != ACL_EXTENDED_DENY) return 0;
    void *qualifier = acl_get_qualifier(entry);
    if (qualifier == NULL) return errno == 0 ? EIO : errno;
    *matches = uuid_compare((const unsigned char *)qualifier, expected) == 0;
    acl_free(qualifier);
    return 0;
}

static int nimi_acl_entry_is_broad_group(acl_entry_t entry, int *broad) {
    if (entry == NULL || broad == NULL) return EINVAL;
    *broad = 0;
    acl_tag_t tag = ACL_UNDEFINED_TAG;
    if (acl_get_tag_type(entry, &tag) != 0) return errno == 0 ? EIO : errno;
    if (tag != ACL_EXTENDED_ALLOW) return 0;
    void *qualifier = acl_get_qualifier(entry);
    if (qualifier == NULL) return errno == 0 ? EIO : errno;
    id_t identifier = 0;
    int identifier_type = -1;
    int status = mbr_uuid_to_id(
        (const unsigned char *)qualifier, &identifier, &identifier_type);
    acl_free(qualifier);
    if (status == ENOENT || status == ESRCH) {
        return 0;
    }
    if (status != 0) return status;
    if (identifier_type != ID_TYPE_GID) return 0;
    switch (identifier) {
        case 12: // everyone
        case 20: // staff
        case 50: // authedusers
        case 51: // interactusers
        case 52: // netusers
        case 53: // consoleusers
        case 61: // localaccounts
        case 62: // netaccounts
            *broad = 1;
            break;
        default:
            break;
    }
    return 0;
}

static int nimi_inspect_fixed_runtime_acl(const char *path, uid_t expected_owner,
                                          uid_t runtime_owner, int policy,
                                          const uuid_t runtime_uuid, int *exact) {
    if (path == NULL || path[0] != '/' || runtime_uuid == NULL || exact == NULL) return EINVAL;
    *exact = 0;
    struct stat info;
    if (lstat(path, &info) != 0) return errno == 0 ? EIO : errno;
    int owner_is_admitted = info.st_uid == expected_owner ||
        (policy == NIMI_MACOS_ACL_MODIFY_FILE && info.st_uid == runtime_owner);
    if (S_ISLNK(info.st_mode) || !owner_is_admitted ||
        (info.st_mode & (S_IWGRP | S_IWOTH)) != 0) {
        return EACCES;
    }
    acl_permset_mask_t expected_permissions = 0;
    uint32_t expected_flags = 0;
    int status = nimi_acl_policy(policy, info.st_mode, &expected_permissions, &expected_flags);
    if (status != 0) return status;
    errno = 0;
    acl_t acl = acl_get_file(path, ACL_TYPE_EXTENDED);
    if (acl == NULL) {
        if (errno == ENOENT || errno == ENOATTR) return 0;
        return errno == 0 ? EIO : errno;
    }
    int matching_entries = 0;
    int exact_entry = 0;
    acl_entry_t entry = NULL;
    int entry_status = acl_get_entry(acl, ACL_FIRST_ENTRY, &entry);
    while (entry_status == 0 && entry != NULL) {
        acl_tag_t tag = ACL_UNDEFINED_TAG;
        acl_permset_mask_t permissions = 0;
        uint32_t flags = 0;
        int matches_runtime = 0;
        int broad_group = 0;
        if (acl_get_tag_type(entry, &tag) != 0 ||
            acl_get_permset_mask_np(entry, &permissions) != 0) {
            status = errno == 0 ? EIO : errno;
            break;
        }
        status = nimi_acl_entry_flags(entry, &flags);
        if (status != 0) break;
        status = nimi_acl_entry_matches_uuid(entry, runtime_uuid, &matches_runtime);
        if (status != 0) break;
        status = nimi_acl_entry_is_broad_group(entry, &broad_group);
        if (status != 0) break;
        if (broad_group && (permissions & NIMI_MACOS_ACL_BROAD_MUTATION_MASK) != 0) {
            status = EACCES;
            break;
        }
        if (matches_runtime) {
            matching_entries++;
            uint32_t semantic_flags = flags & ~(uint32_t)ACL_ENTRY_INHERITED;
            if (tag == ACL_EXTENDED_ALLOW && permissions == expected_permissions &&
                semantic_flags == expected_flags) {
                exact_entry = 1;
            }
        }
        entry = NULL;
        errno = 0;
        entry_status = acl_get_entry(acl, ACL_NEXT_ENTRY, &entry);
    }
    if (status == 0 && entry_status < 0 && errno != EINVAL) {
        status = errno == 0 ? EIO : errno;
    }
    acl_free(acl);
    if (status != 0) return status;
    *exact = matching_entries == 1 && exact_entry;
    return 0;
}

static int nimi_acl_entry_is_stale_runtime(acl_entry_t entry,
                                           acl_permset_mask_t expected_permissions,
                                           uint32_t expected_flags,
                                           int *stale) {
    if (entry == NULL || stale == NULL) return EINVAL;
    *stale = 0;
    acl_tag_t tag = ACL_UNDEFINED_TAG;
    if (acl_get_tag_type(entry, &tag) != 0) return errno == 0 ? EIO : errno;
    if (tag != ACL_EXTENDED_ALLOW) return 0;
    void *qualifier = acl_get_qualifier(entry);
    if (qualifier == NULL) return errno == 0 ? EIO : errno;
    id_t identifier = 0;
    int identifier_type = -1;
    int status = mbr_uuid_to_id(
        (const unsigned char *)qualifier, &identifier, &identifier_type);
    acl_free(qualifier);
    if (status == 0) return 0;
    if (status != ENOENT && status != ESRCH) return status;

    acl_permset_mask_t permissions = 0;
    uint32_t flags = 0;
    if (acl_get_permset_mask_np(entry, &permissions) != 0) {
        return errno == 0 ? EIO : errno;
    }
    status = nimi_acl_entry_flags(entry, &flags);
    if (status != 0) return status;
    uint32_t semantic_flags = flags & ~(uint32_t)ACL_ENTRY_INHERITED;
    *stale = permissions == expected_permissions && semantic_flags == expected_flags;
    return 0;
}

static int nimi_copy_acl_without_runtime(acl_t source, const uuid_t runtime_uuid,
                                         acl_permset_mask_t expected_permissions,
                                         uint32_t expected_flags, acl_t *output) {
    if (source == NULL || runtime_uuid == NULL || output == NULL) return EINVAL;
    acl_t next = acl_init(0);
    if (next == NULL) return errno == 0 ? ENOMEM : errno;
    int status = 0;
    acl_entry_t entry = NULL;
    int entry_status = acl_get_entry(source, ACL_FIRST_ENTRY, &entry);
    while (entry_status == 0 && entry != NULL) {
        int matches_runtime = 0;
        int stale_runtime = 0;
        status = nimi_acl_entry_matches_uuid(entry, runtime_uuid, &matches_runtime);
        if (status != 0) break;
        status = nimi_acl_entry_is_stale_runtime(
            entry, expected_permissions, expected_flags, &stale_runtime);
        if (status != 0) break;
        if (!matches_runtime && !stale_runtime) {
            acl_entry_t copied = NULL;
            if (acl_create_entry(&next, &copied) != 0 || copied == NULL ||
                acl_copy_entry(copied, entry) != 0) {
                status = errno == 0 ? EIO : errno;
                break;
            }
        }
        entry = NULL;
        errno = 0;
        entry_status = acl_get_entry(source, ACL_NEXT_ENTRY, &entry);
    }
    if (status == 0 && entry_status < 0 && errno != EINVAL) {
        status = errno == 0 ? EIO : errno;
    }
    if (status != 0) {
        acl_free(next);
        return status;
    }
    *output = next;
    return 0;
}

static int nimi_append_fixed_runtime_acl_entry(acl_t *acl, const uuid_t runtime_uuid,
                                                acl_permset_mask_t permissions,
                                                uint32_t flags) {
    if (acl == NULL || *acl == NULL || runtime_uuid == NULL) return EINVAL;
    acl_entry_t entry = NULL;
    if (acl_create_entry(acl, &entry) != 0 || entry == NULL) {
        return errno == 0 ? EIO : errno;
    }
    if (acl_set_tag_type(entry, ACL_EXTENDED_ALLOW) != 0 ||
        acl_set_qualifier(entry, runtime_uuid) != 0 ||
        acl_set_permset_mask_np(entry, permissions) != 0) {
        return errno == 0 ? EIO : errno;
    }
    acl_flagset_t flagset = NULL;
    if (acl_get_flagset_np(entry, &flagset) != 0 || flagset == NULL ||
        acl_clear_flags_np(flagset) != 0) {
        return errno == 0 ? EIO : errno;
    }
    const acl_flag_t supported_flags[] = {
        ACL_ENTRY_FILE_INHERIT,
        ACL_ENTRY_DIRECTORY_INHERIT,
        ACL_ENTRY_LIMIT_INHERIT,
        ACL_ENTRY_ONLY_INHERIT,
    };
    for (size_t index = 0; index < sizeof(supported_flags) / sizeof(supported_flags[0]); index++) {
        if ((flags & (uint32_t)supported_flags[index]) != 0 &&
            acl_add_flag_np(flagset, supported_flags[index]) != 0) {
            return errno == 0 ? EIO : errno;
        }
    }
    if (acl_set_flagset_np(entry, flagset) != 0) return errno == 0 ? EIO : errno;
    return 0;
}

int nimi_macos_validate_fixed_runtime_path_acl(const char *path, int policy) {
    uid_t runtime_uid = 0;
    gid_t runtime_gid = 0;
    uuid_t runtime_uuid;
    int status = nimi_fixed_runtime_service_identity(&runtime_uid, &runtime_gid, runtime_uuid);
    if (status != 0) return status;
    (void)runtime_uid;
    (void)runtime_gid;
    uid_t owner = geteuid();
    if (owner == 0 || getuid() != owner) return EACCES;
    int exact = 0;
    status = nimi_inspect_fixed_runtime_acl(
        path, owner, runtime_uid, policy, runtime_uuid, &exact);
    if (status != 0) return status;
    return exact ? 0 : EACCES;
}

int nimi_macos_prepare_fixed_runtime_path_acl(const char *path, int policy) {
    uid_t runtime_uid = 0;
    gid_t runtime_gid = 0;
    uuid_t runtime_uuid;
    int status = nimi_fixed_runtime_service_identity(&runtime_uid, &runtime_gid, runtime_uuid);
    if (status != 0) return status;
    (void)runtime_uid;
    (void)runtime_gid;
    uid_t owner = geteuid();
    if (owner == 0 || getuid() != owner) return EACCES;
    int exact = 0;
    status = nimi_inspect_fixed_runtime_acl(
        path, owner, runtime_uid, policy, runtime_uuid, &exact);
    if (status != 0) return status;
    if (exact) return 0;

    struct stat info;
    if (lstat(path, &info) != 0) return errno == 0 ? EIO : errno;
    if (info.st_uid == runtime_uid) return EACCES;
    acl_permset_mask_t expected_permissions = 0;
    uint32_t expected_flags = 0;
    status = nimi_acl_policy(policy, info.st_mode, &expected_permissions, &expected_flags);
    if (status != 0) return status;
    errno = 0;
    acl_t current = acl_get_file(path, ACL_TYPE_EXTENDED);
    if (current == NULL && (errno == ENOENT || errno == ENOATTR)) current = acl_init(0);
    if (current == NULL) return errno == 0 ? EIO : errno;
    acl_t next = NULL;
    status = nimi_copy_acl_without_runtime(
        current, runtime_uuid, expected_permissions, expected_flags, &next);
    acl_free(current);
    if (status != 0) return status;
    status = nimi_append_fixed_runtime_acl_entry(
        &next, runtime_uuid, expected_permissions, expected_flags);
    if (status == 0 && acl_valid(next) != 0) status = errno == 0 ? EIO : errno;
    if (status == 0 && acl_set_file(path, ACL_TYPE_EXTENDED, next) != 0) {
        status = errno == 0 ? EIO : errno;
    }
    acl_free(next);
    if (status != 0) return status;
    return nimi_macos_validate_fixed_runtime_path_acl(path, policy);
}

int nimi_macos_copy_current_user_profile(char *output, size_t output_size) {
    if (output == NULL || output_size < 2) return EINVAL;
    uid_t owner = geteuid();
    if (owner == 0 || getuid() != owner) return EACCES;
    errno = 0;
    struct passwd *account = getpwuid(owner);
    if (account == NULL || account->pw_uid != owner || account->pw_dir == NULL) {
        return errno == 0 ? ENOENT : errno;
    }
    size_t length = strlen(account->pw_dir);
    if (length < 2 || account->pw_dir[0] != '/' || length >= output_size) return EINVAL;
    memcpy(output, account->pw_dir, length + 1);
    return 0;
}

static int nimi_process_snapshot(pid_t pid, struct proc_bsdinfo *output, char *path, size_t path_size) {
    if (pid <= 0 || output == NULL || path == NULL || path_size < 2) return EINVAL;
    memset(output, 0, sizeof(*output));
    memset(path, 0, path_size);
    struct kinfo_proc info;
    memset(&info, 0, sizeof(info));
    int selectors[4] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, (int)pid };
    size_t info_length = sizeof(info);
    if (sysctl(selectors, 4, &info, &info_length, NULL, 0) != 0) {
        return errno == 0 ? EIO : errno;
    }
    if (info_length != sizeof(info) || info.kp_proc.p_pid != pid ||
        info.kp_proc.p_starttime.tv_sec <= 0 ||
        info.kp_proc.p_starttime.tv_usec < 0 ||
        info.kp_proc.p_starttime.tv_usec >= 1000000) {
        return ESRCH;
    }
    output->pbi_pid = (uint32_t)info.kp_proc.p_pid;
    output->pbi_ppid = (uint32_t)info.kp_eproc.e_ppid;
    output->pbi_uid = (uint32_t)info.kp_eproc.e_ucred.cr_uid;
    output->pbi_ruid = (uint32_t)info.kp_eproc.e_pcred.p_ruid;
    output->pbi_start_tvsec = (uint64_t)info.kp_proc.p_starttime.tv_sec;
    output->pbi_start_tvusec = (uint64_t)info.kp_proc.p_starttime.tv_usec;
    if (output->pbi_pid != (uint32_t)pid) {
        return errno == 0 ? ESRCH : errno;
    }
    int path_length = proc_pidpath(pid, path, (uint32_t)path_size);
    if (path_length <= 0 || path[0] != '/') return errno == 0 ? ESRCH : errno;
    return 0;
}

static int nimi_same_process(const struct proc_bsdinfo *left, const struct proc_bsdinfo *right) {
    return left->pbi_pid == right->pbi_pid && left->pbi_ppid == right->pbi_ppid &&
        left->pbi_uid == right->pbi_uid && left->pbi_ruid == right->pbi_ruid &&
        left->pbi_start_tvsec == right->pbi_start_tvsec &&
        left->pbi_start_tvusec == right->pbi_start_tvusec;
}

static int nimi_verify_runtime_code(pid_t pid, const audit_token_t *token,
                                    const char *expected_requirement,
                                    const char *expected_team,
                                    const char *expected_identifier,
                                    int require_trusted_anchor,
                                    int require_ad_hoc) {
    if (pid <= 0 || token == NULL || expected_requirement == NULL || expected_team == NULL ||
        expected_identifier == NULL || expected_requirement[0] == '\0' ||
        expected_identifier[0] == '\0' ||
        (require_trusted_anchor != 0 && require_trusted_anchor != 1) ||
        (require_ad_hoc != 0 && require_ad_hoc != 1) ||
        (require_ad_hoc && (expected_team[0] != '\0' || require_trusted_anchor)) ||
        (!require_ad_hoc && (expected_team[0] == '\0' || !require_trusted_anchor))) return EINVAL;

    CFDataRef audit_data = CFDataCreate(kCFAllocatorDefault, (const UInt8 *)token, sizeof(*token));
    if (audit_data == NULL) return ENOMEM;
    const void *keys[] = { kSecGuestAttributeAudit };
    const void *values[] = { audit_data };
    CFDictionaryRef attributes = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 1,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFRelease(audit_data);
    if (attributes == NULL) return ENOMEM;
    SecCodeRef code = NULL;
    OSStatus status = SecCodeCopyGuestWithAttributes(NULL, attributes, kSecCSDefaultFlags, &code);
    CFRelease(attributes);
    if (status != errSecSuccess || code == NULL) return status == errSecSuccess ? EACCES : (int)status;

    int result = 0;
    CFStringRef requirement_string = CFStringCreateWithCString(kCFAllocatorDefault,
        expected_requirement, kCFStringEncodingUTF8);
    CFStringRef team_string = expected_team[0] == '\0' ? NULL :
        CFStringCreateWithCString(kCFAllocatorDefault, expected_team, kCFStringEncodingUTF8);
    CFStringRef identifier_string = CFStringCreateWithCString(kCFAllocatorDefault,
        expected_identifier, kCFStringEncodingUTF8);
    if (requirement_string == NULL ||
        (expected_team[0] != '\0' && team_string == NULL) ||
        identifier_string == NULL) {
        result = ENOMEM;
        goto cleanup_strings;
    }
    SecRequirementRef requirement = NULL;
    status = SecRequirementCreateWithString(requirement_string, kSecCSDefaultFlags, &requirement);
    if (status != errSecSuccess || requirement == NULL) {
        result = status == errSecSuccess ? EACCES : (int)status;
        goto cleanup_strings;
    }
    // Static validation owns architecture, trust-anchor, and notarization checks.
    status = SecCodeCheckValidity(code, kSecCSDefaultFlags, requirement);
    if (status != errSecSuccess) {
        result = (int)status;
        CFRelease(requirement);
        goto cleanup_strings;
    }
    CFDictionaryRef signing = NULL;
    status = SecCodeCopySigningInformation(code, kSecCSSigningInformation, &signing);
    if (status != errSecSuccess || signing == NULL) {
        result = status == errSecSuccess ? EACCES : (int)status;
        CFRelease(requirement);
        goto cleanup_strings;
    }
    CFStringRef team = (CFStringRef)CFDictionaryGetValue(signing, kSecCodeInfoTeamIdentifier);
    CFStringRef identifier = (CFStringRef)CFDictionaryGetValue(signing, kSecCodeInfoIdentifier);
    CFNumberRef flags = (CFNumberRef)CFDictionaryGetValue(signing, kSecCodeInfoFlags);
    int32_t code_flags = 0;
    if (identifier == NULL || flags == NULL ||
        CFGetTypeID(identifier) != CFStringGetTypeID() ||
        CFGetTypeID(flags) != CFNumberGetTypeID() ||
        !CFEqual(identifier, identifier_string) ||
        !CFNumberGetValue(flags, kCFNumberSInt32Type, &code_flags) ||
        (((uint32_t)code_flags) & kSecCodeSignatureRuntime) == 0 ||
        (require_ad_hoc && ((((uint32_t)code_flags) & kSecCodeSignatureAdhoc) == 0 ||
            team != NULL)) ||
        (!require_ad_hoc && ((((uint32_t)code_flags) & kSecCodeSignatureAdhoc) != 0 ||
            team == NULL || CFGetTypeID(team) != CFStringGetTypeID() ||
            !CFEqual(team, team_string)))) {
        result = EACCES;
        CFRelease(signing);
        CFRelease(requirement);
        goto cleanup_strings;
    }
    CFRelease(signing);
    CFRelease(requirement);

cleanup_strings:
    if (identifier_string != NULL) CFRelease(identifier_string);
    if (team_string != NULL) CFRelease(team_string);
    if (requirement_string != NULL) CFRelease(requirement_string);
    CFRelease(code);
    return result;
}

static int nimi_validate_runtime_socket_path(const char *expected_path) {
    if (expected_path == NULL ||
        (strcmp(expected_path, NIMI_MACOS_RUNTIME_SOCKET) != 0 &&
         strcmp(expected_path, NIMI_MACOS_LOCAL_APP_SOCKET) != 0)) return EINVAL;
    const char *ancestors[] = { "/private", "/private/var", "/private/var/run",
        NIMI_MACOS_RUNTIME_SOCKET_DIRECTORY };
    for (size_t index = 0; index < sizeof(ancestors) / sizeof(ancestors[0]); index++) {
        struct stat info;
        if (lstat(ancestors[index], &info) != 0 || !S_ISDIR(info.st_mode) || S_ISLNK(info.st_mode)) {
            return EACCES;
        }
        if (index == 3 && (info.st_uid != 0 || (info.st_mode & 0022) != 0)) return EACCES;
    }
    struct group *staff = getgrnam("staff");
    struct stat endpoint;
    if (staff == NULL || lstat(expected_path, &endpoint) != 0 || !S_ISSOCK(endpoint.st_mode) ||
        endpoint.st_uid != 0 || endpoint.st_gid != staff->gr_gid ||
        (endpoint.st_mode & 0777) != 0660) return EACCES;
    return 0;
}

int nimi_macos_verify_runtime_peer(int socket_fd, const char *expected_path,
                                   const char *expected_executable,
                                   const char *expected_requirement,
                                   const char *expected_team,
                                   const char *expected_identifier,
                                   int require_trusted_anchor,
                                   int require_ad_hoc) {
    if (socket_fd < 0 || expected_executable == NULL ||
        strcmp(expected_executable, NIMI_MACOS_RUNTIME_EXECUTABLE) != 0) return EINVAL;
    uid_t service_uid = 0;
    int result = nimi_fixed_runtime_service_uid(&service_uid);
    if (result != 0) return result;
    result = nimi_validate_runtime_socket_path(expected_path);
    if (result != 0) return result;

    struct sockaddr_un peer_address;
    memset(&peer_address, 0, sizeof(peer_address));
    socklen_t peer_address_length = sizeof(peer_address);
    if (getpeername(socket_fd, (struct sockaddr *)&peer_address, &peer_address_length) != 0 ||
        peer_address.sun_family != AF_UNIX || strcmp(peer_address.sun_path, expected_path) != 0) {
        return EACCES;
    }
    audit_token_t token;
    memset(&token, 0, sizeof(token));
    socklen_t token_length = sizeof(token);
    pid_t peer_pid = 0;
    socklen_t pid_length = sizeof(peer_pid);
    if (getsockopt(socket_fd, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &token_length) != 0 ||
        token_length != sizeof(token) ||
        getsockopt(socket_fd, SOL_LOCAL, LOCAL_PEERPID, &peer_pid, &pid_length) != 0 ||
        pid_length != sizeof(peer_pid) || peer_pid <= 0 ||
        audit_token_to_pid(token) != peer_pid || audit_token_to_pidversion(token) == 0 ||
        audit_token_to_euid(token) != service_uid || audit_token_to_ruid(token) != service_uid) {
        return EACCES;
    }
    struct proc_bsdinfo before;
    char process_path[PROC_PIDPATHINFO_MAXSIZE];
    result = nimi_process_snapshot(peer_pid, &before, process_path, sizeof(process_path));
    if (result != 0 || before.pbi_ppid != 1 || before.pbi_uid != service_uid ||
        before.pbi_ruid != service_uid || strcmp(process_path, expected_executable) != 0) return EACCES;

    char canonical[PATH_MAX];
    if (realpath(expected_executable, canonical) == NULL || strcmp(canonical, expected_executable) != 0) {
        return EACCES;
    }
    struct stat executable_info;
    if (lstat(expected_executable, &executable_info) != 0 ||
        !S_ISREG(executable_info.st_mode) || S_ISLNK(executable_info.st_mode) ||
        executable_info.st_uid != 0 || (executable_info.st_mode & 0022) != 0) return EACCES;
    result = nimi_verify_runtime_code(peer_pid, &token, expected_requirement, expected_team,
        expected_identifier, require_trusted_anchor, require_ad_hoc);
    if (result != 0) return result;
    struct proc_bsdinfo after;
    char after_path[PROC_PIDPATHINFO_MAXSIZE];
    result = nimi_process_snapshot(peer_pid, &after, after_path, sizeof(after_path));
    if (result != 0 || !nimi_same_process(&before, &after) || strcmp(process_path, after_path) != 0) {
        return EACCES;
    }
    return 0;
}

int nimi_macos_runtime_service_status(void) {
    @autoreleasepool {
        if (![NSBundle.mainBundle.bundlePath isEqualToString:@NIMI_MACOS_DESKTOP_APPLICATION]) {
            return -2;
        }
#ifdef NIMI_MACOS_LOCAL_DEVELOPMENT
        struct stat definition;
        if (lstat(NIMI_MACOS_LAUNCHD_PLIST, &definition) != 0) return 0;
        if (!S_ISREG(definition.st_mode) || S_ISLNK(definition.st_mode) ||
            definition.st_uid != 0 || definition.st_gid != 0 ||
            (definition.st_mode & 0777) != 0644 || definition.st_nlink != 1) return -2;
        return 1;
#else
        SMAppService *service = [SMAppService daemonServiceWithPlistName:@"ai.nimi.runtime.plist"];
        return (int)service.status;
#endif
    }
}

#ifndef NIMI_MACOS_LOCAL_DEVELOPMENT
static int nimi_macos_register_service(SMAppService *service) {
    NSError *error = nil;
    if ([service registerAndReturnError:&error]) return (int)service.status;
    if (service.status == SMAppServiceStatusRequiresApproval) {
        return (int)SMAppServiceStatusRequiresApproval;
    }
    return -3;
}
#endif

int nimi_macos_verify_outer_bundle(const char *expected_path,
                                   const char *expected_requirement,
                                   const char *expected_team,
                                   const char *expected_identifier,
                                   int require_trusted_anchor,
                                   int require_notarization,
                                   int require_ad_hoc) {
    if (expected_path == NULL || expected_requirement == NULL || expected_team == NULL ||
        expected_identifier == NULL ||
        strcmp(expected_path, NIMI_MACOS_DESKTOP_APPLICATION) != 0 ||
        expected_requirement[0] == '\0' || expected_identifier[0] == '\0' ||
        (require_trusted_anchor != 0 && require_trusted_anchor != 1) ||
        (require_notarization != 0 && require_notarization != 1) ||
        (require_ad_hoc != 0 && require_ad_hoc != 1) ||
        (require_notarization && (!require_trusted_anchor || require_ad_hoc)) ||
        (require_ad_hoc && (expected_team[0] != '\0' || require_trusted_anchor)) ||
        (!require_ad_hoc && (expected_team[0] == '\0' || !require_trusted_anchor))) return EINVAL;
    CFURLRef url = CFURLCreateFromFileSystemRepresentation(
        kCFAllocatorDefault, (const UInt8 *)expected_path, (CFIndex)strlen(expected_path), true);
    if (url == NULL) return ENOMEM;
    SecStaticCodeRef code = NULL;
    OSStatus status = SecStaticCodeCreateWithPath(url, kSecCSDefaultFlags, &code);
    CFRelease(url);
    if (status != errSecSuccess || code == NULL) {
        return status == errSecSuccess ? EACCES : (int)status;
    }
    CFStringRef requirement_string = CFStringCreateWithCString(
        kCFAllocatorDefault, expected_requirement, kCFStringEncodingUTF8);
    CFStringRef team_string = expected_team[0] == '\0' ? NULL :
        CFStringCreateWithCString(kCFAllocatorDefault, expected_team, kCFStringEncodingUTF8);
    CFStringRef identifier_string = CFStringCreateWithCString(
        kCFAllocatorDefault, expected_identifier, kCFStringEncodingUTF8);
    if (requirement_string == NULL ||
        (expected_team[0] != '\0' && team_string == NULL) ||
        identifier_string == NULL) {
        if (identifier_string != NULL) CFRelease(identifier_string);
        if (team_string != NULL) CFRelease(team_string);
        if (requirement_string != NULL) CFRelease(requirement_string);
        CFRelease(code);
        return ENOMEM;
    }
    SecRequirementRef requirement = NULL;
    status = SecRequirementCreateWithString(
        requirement_string, kSecCSDefaultFlags, &requirement);
    if (status != errSecSuccess || requirement == NULL) {
        CFRelease(identifier_string);
        if (team_string != NULL) CFRelease(team_string);
        CFRelease(requirement_string);
        CFRelease(code);
        return status == errSecSuccess ? EACCES : (int)status;
    }
    CFErrorRef error = NULL;
    SecCSFlags validation_flags = kSecCSStrictValidate | kSecCSCheckGatekeeperArchitectures |
        kSecCSCheckNestedCode | kSecCSRestrictSymlinks | kSecCSRestrictToAppLike |
        kSecCSConsiderExpiration;
    if (require_trusted_anchor) validation_flags |= kSecCSCheckTrustedAnchors;
    status = SecStaticCodeCheckValidityWithErrors(code, validation_flags, requirement, &error);
    if (error != NULL) CFRelease(error);
    if (status == errSecSuccess) {
        CFDictionaryRef signing = NULL;
        status = SecCodeCopySigningInformation(
            code, kSecCSSigningInformation | kSecCSContentInformation, &signing);
        if (status == errSecSuccess && signing != NULL) {
            CFStringRef team = (CFStringRef)CFDictionaryGetValue(signing, kSecCodeInfoTeamIdentifier);
            CFStringRef identifier = (CFStringRef)CFDictionaryGetValue(signing, kSecCodeInfoIdentifier);
            CFDataRef ticket = (CFDataRef)CFDictionaryGetValue(signing, kSecCodeInfoStapledNotarizationTicket);
            CFNumberRef flags = (CFNumberRef)CFDictionaryGetValue(signing, kSecCodeInfoFlags);
            int32_t code_flags = 0;
            if (identifier == NULL || flags == NULL ||
                CFGetTypeID(identifier) != CFStringGetTypeID() ||
                CFGetTypeID(flags) != CFNumberGetTypeID() ||
                (require_notarization && (ticket == NULL || CFGetTypeID(ticket) != CFDataGetTypeID() ||
                    CFDataGetLength(ticket) <= 0)) ||
                !CFNumberGetValue(flags, kCFNumberSInt32Type, &code_flags) ||
                (((uint32_t)code_flags) & kSecCodeSignatureRuntime) == 0 ||
                (require_ad_hoc && ((((uint32_t)code_flags) & kSecCodeSignatureAdhoc) == 0 ||
                    team != NULL)) ||
                (!require_ad_hoc && ((((uint32_t)code_flags) & kSecCodeSignatureAdhoc) != 0 ||
                    team == NULL || CFGetTypeID(team) != CFStringGetTypeID() ||
                    !CFEqual(team, team_string))) ||
                !CFEqual(identifier, identifier_string)) {
                status = errSecCSReqFailed;
            }
            CFRelease(signing);
        } else if (status == errSecSuccess) {
            status = errSecCSReqFailed;
        }
    }
    CFRelease(requirement);
    CFRelease(identifier_string);
    if (team_string != NULL) CFRelease(team_string);
    CFRelease(requirement_string);
    CFRelease(code);
    return status == errSecSuccess ? 0 : (int)status;
}

int nimi_macos_register_runtime_service(void) {
    @autoreleasepool {
        if (![NSBundle.mainBundle.bundlePath isEqualToString:@NIMI_MACOS_DESKTOP_APPLICATION]) {
            return -2;
        }
#ifdef NIMI_MACOS_LOCAL_DEVELOPMENT
        return -3;
#else
        SMAppService *service = [SMAppService daemonServiceWithPlistName:@"ai.nimi.runtime.plist"];
        return nimi_macos_register_service(service);
#endif
    }
}

int nimi_macos_reregister_runtime_service(void) {
    @autoreleasepool {
        if (![NSBundle.mainBundle.bundlePath isEqualToString:@NIMI_MACOS_DESKTOP_APPLICATION]) {
            return -2;
        }
#ifdef NIMI_MACOS_LOCAL_DEVELOPMENT
        return -3;
#else
        SMAppService *service = [SMAppService daemonServiceWithPlistName:@"ai.nimi.runtime.plist"];
        if (service.status != SMAppServiceStatusEnabled) return -3;
        dispatch_semaphore_t completion = dispatch_semaphore_create(0);
        __block BOOL unregister_failed = NO;
        [service unregisterWithCompletionHandler:^(NSError *error) {
            unregister_failed = error != nil;
            dispatch_semaphore_signal(completion);
        }];
        const dispatch_time_t deadline = dispatch_time(DISPATCH_TIME_NOW, 30LL * NSEC_PER_SEC);
        if (dispatch_semaphore_wait(completion, deadline) != 0 || unregister_failed ||
            service.status != SMAppServiceStatusNotRegistered) {
            return -3;
        }
        return nimi_macos_register_service(service);
#endif
    }
}

int nimi_macos_open_url(const char *raw_url) {
    if (raw_url == NULL || raw_url[0] == '\0' || strlen(raw_url) > 4096) return EINVAL;
    @autoreleasepool {
        NSString *value = [[NSString alloc] initWithBytes:raw_url
            length:strlen(raw_url) encoding:NSUTF8StringEncoding];
        if (value == nil) return EINVAL;
        NSURL *url = [NSURL URLWithString:value];
        if (url == nil) return EINVAL;
        return [[NSWorkspace sharedWorkspace] openURL:url] ? 0 : EIO;
    }
}

int nimi_macos_spawn_suspended(const char *executable, char *const argv[], char *const envp[],
                               const char *working_directory, uint32_t *pid_output) {
    if (executable == NULL || argv == NULL || argv[0] == NULL || envp == NULL ||
        working_directory == NULL || pid_output == NULL ||
        strcmp(executable, NIMI_MACOS_LOCAL_APP_HOST) != 0 ||
        executable[0] != '/' || working_directory[0] != '/') return EINVAL;
    posix_spawnattr_t attributes;
    posix_spawn_file_actions_t actions;
    int result = posix_spawnattr_init(&attributes);
    if (result != 0) return result;
    result = posix_spawn_file_actions_init(&actions);
    if (result != 0) {
        posix_spawnattr_destroy(&attributes);
        return result;
    }
    short flags = POSIX_SPAWN_START_SUSPENDED | POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT;
    if ((result = posix_spawnattr_setflags(&attributes, flags)) == 0) {
        result = posix_spawnattr_setpgroup(&attributes, 0);
    }
    if (result == 0) result = posix_spawn_file_actions_addchdir_np(&actions, working_directory);
    pid_t pid = 0;
    if (result == 0) result = posix_spawn(&pid, executable, &actions, &attributes, argv, envp);
    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attributes);
    if (result != 0 || pid <= 0) return result == 0 ? EIO : result;
    *pid_output = (uint32_t)pid;
    return 0;
}

int nimi_macos_watch_child(uint32_t pid) {
    if (pid == 0) return -1;
    int queue = kqueue();
    if (queue < 0) return -1;
    struct kevent change;
    EV_SET(&change, (uintptr_t)pid, EVFILT_PROC, EV_ADD | EV_ENABLE | EV_CLEAR,
        NOTE_EXIT | NOTE_EXEC, 0, NULL);
    if (kevent(queue, &change, 1, NULL, 0, NULL) != 0) {
        close(queue);
        return -1;
    }
    return queue;
}

int nimi_macos_child_running(uint32_t pid, int kqueue_fd) {
    if (pid == 0 || kqueue_fd < 0) return 0;
    struct kevent event;
    struct timespec timeout = {0, 0};
    int count = kevent(kqueue_fd, NULL, 0, &event, 1, &timeout);
    if (count != 0) return 0;
    struct proc_bsdinfo process;
    char path[PROC_PIDPATHINFO_MAXSIZE];
    return nimi_process_snapshot((pid_t)pid, &process, path, sizeof(path)) == 0 ? 1 : 0;
}

int nimi_macos_terminate_child_group(uint32_t pid) {
    if (pid == 0) return EINVAL;
    pid_t child = (pid_t)pid;
    int status = 0;
    pid_t observed = waitpid(child, &status, WNOHANG);
    if (observed == child || (observed < 0 && errno == ECHILD)) return 0;
    if (kill(-child, SIGTERM) != 0 && errno != ESRCH) return errno;
    for (int index = 0; index < 40; index++) {
        observed = waitpid(child, &status, WNOHANG);
        if (observed == child || (observed < 0 && errno == ECHILD)) return 0;
        usleep(50000);
    }
    if (kill(-child, SIGKILL) != 0 && errno != ESRCH) return errno;
    do {
        observed = waitpid(child, &status, 0);
    } while (observed < 0 && errno == EINTR);
    return observed == child || (observed < 0 && errno == ECHILD) ? 0 : EIO;
}
