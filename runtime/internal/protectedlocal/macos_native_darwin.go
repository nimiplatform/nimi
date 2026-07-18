//go:build darwin && cgo

package protectedlocal

/*
#cgo CFLAGS: -mmacosx-version-min=13.0
#cgo LDFLAGS: -framework CoreFoundation -framework Security -framework SystemConfiguration -lbsm

#include <CoreFoundation/CoreFoundation.h>
#include <Security/AuthSession.h>
#include <Security/SecCode.h>
#include <Security/SecRequirement.h>
#include <SystemConfiguration/SystemConfiguration.h>
#include <bsm/libbsm.h>
#include <errno.h>
#include <limits.h>
#include <libproc.h>
#include <pwd.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc.h>
#include <sys/proc_info.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

typedef struct {
    audit_token_t token;
    uint32_t euid;
    uint32_t ruid;
    uint32_t auid;
    uint32_t audit_session;
    uint32_t pid;
    uint32_t pidversion;
    uint32_t console_uid;
    uint32_t session_attributes;
} nimi_macos_audit_identity;

typedef struct {
    uint32_t pid;
    uint32_t ppid;
    uint32_t euid;
    uint32_t ruid;
    uint32_t status;
    uint64_t start_sec;
    uint64_t start_usec;
    char executable_path[PROC_PIDPATHINFO_MAXSIZE];
} nimi_macos_process_snapshot;

typedef struct {
    char team_id[128];
    char signing_identifier[256];
    char designated_requirement[2048];
    unsigned char cdhash[64];
    size_t cdhash_len;
    uint32_t code_flags;
} nimi_macos_code_identity;

typedef struct {
    uint32_t uid;
    uint32_t gid;
    char home[PATH_MAX];
    char shell[PATH_MAX];
} nimi_macos_runtime_account;

static int nimi_macos_lookup_runtime_account(const char *name,
                                             nimi_macos_runtime_account *output) {
    if (name == NULL || output == NULL) return EINVAL;
    memset(output, 0, sizeof(*output));
    struct passwd entry;
    struct passwd *resolved = NULL;
    char buffer[16384];
    int status = getpwnam_r(name, &entry, buffer, sizeof(buffer), &resolved);
    if (status != 0) return status;
    if (resolved == NULL || resolved->pw_name == NULL || strcmp(resolved->pw_name, name) != 0 ||
        resolved->pw_dir == NULL || resolved->pw_shell == NULL ||
        strlcpy(output->home, resolved->pw_dir, sizeof(output->home)) >= sizeof(output->home) ||
        strlcpy(output->shell, resolved->pw_shell, sizeof(output->shell)) >= sizeof(output->shell)) {
        return EACCES;
    }
    output->uid = (uint32_t)resolved->pw_uid;
    output->gid = (uint32_t)resolved->pw_gid;
    return 0;
}

static int nimi_copy_cf_string(CFStringRef value, char *output, size_t capacity) {
    if (value == NULL || output == NULL || capacity < 2) {
        return EINVAL;
    }
    if (!CFStringGetCString(value, output, (CFIndex)capacity, kCFStringEncodingUTF8)) {
        return EOVERFLOW;
    }
    return 0;
}

static int nimi_macos_validate_graphic_session(uint32_t audit_session, uint32_t euid,
                                               uint32_t *console_uid,
                                               uint32_t *session_attributes) {
    SecuritySessionId actual = noSecuritySession;
    SessionAttributeBits attributes = 0;
    OSStatus session_status = SessionGetInfo((SecuritySessionId)audit_session, &actual, &attributes);
    if (session_status != errSessionSuccess || actual != audit_session ||
        (attributes & sessionHasGraphicAccess) == 0 ||
        (attributes & sessionIsRoot) != 0 || (attributes & sessionIsRemote) != 0) {
        return EACCES;
    }

    uid_t active_uid = (uid_t)-1;
    gid_t active_gid = (gid_t)-1;
    CFStringRef console_user = SCDynamicStoreCopyConsoleUser(NULL, &active_uid, &active_gid);
    if (console_user == NULL) {
        return ENOENT;
    }
    Boolean loginwindow = CFStringCompare(console_user, CFSTR("loginwindow"), 0) == kCFCompareEqualTo;
    CFRelease(console_user);
    if (loginwindow || active_uid == 0 || active_uid == (uid_t)-1 || active_uid != (uid_t)euid) {
        return EACCES;
    }
    if (console_uid != NULL) {
        *console_uid = (uint32_t)active_uid;
    }
    if (session_attributes != NULL) {
        *session_attributes = (uint32_t)attributes;
    }
    return 0;
}

static int nimi_macos_socket_peer(int fd, nimi_macos_audit_identity *output) {
    if (fd < 0 || output == NULL) {
        return EINVAL;
    }
    memset(output, 0, sizeof(*output));
    socklen_t token_len = sizeof(output->token);
    if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, &output->token, &token_len) != 0 ||
        token_len != sizeof(output->token)) {
        return errno == 0 ? EIO : errno;
    }
    pid_t peer_pid = 0;
    socklen_t pid_len = sizeof(peer_pid);
    if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &peer_pid, &pid_len) != 0 ||
        pid_len != sizeof(peer_pid) || peer_pid <= 0) {
        return errno == 0 ? EIO : errno;
    }
    output->euid = (uint32_t)audit_token_to_euid(output->token);
    output->ruid = (uint32_t)audit_token_to_ruid(output->token);
    output->auid = (uint32_t)audit_token_to_auid(output->token);
    output->audit_session = (uint32_t)audit_token_to_asid(output->token);
    output->pid = (uint32_t)audit_token_to_pid(output->token);
    output->pidversion = (uint32_t)audit_token_to_pidversion(output->token);
    if (output->pid == 0 || output->pid != (uint32_t)peer_pid || output->pidversion == 0 ||
        output->euid == 0 || output->ruid != output->euid || output->auid != output->euid ||
        output->audit_session == 0 || output->audit_session == UINT32_MAX) {
        return EACCES;
    }
    return nimi_macos_validate_graphic_session(output->audit_session, output->euid,
                                                &output->console_uid,
                                                &output->session_attributes);
}

static int nimi_macos_revalidate_graphic_session(uint32_t audit_session, uint32_t euid) {
    return nimi_macos_validate_graphic_session(audit_session, euid, NULL, NULL);
}

static int nimi_macos_process_info(uint32_t pid, nimi_macos_process_snapshot *output) {
    if (pid == 0 || output == NULL) {
        return EINVAL;
    }
    memset(output, 0, sizeof(*output));
    struct proc_bsdinfo info;
    memset(&info, 0, sizeof(info));
    int read = proc_pidinfo((int)pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info));
    if (read != sizeof(info) || info.pbi_pid != pid || info.pbi_start_tvsec == 0) {
        return errno == 0 ? ESRCH : errno;
    }
    int path_len = proc_pidpath((int)pid, output->executable_path, sizeof(output->executable_path));
    if (path_len <= 0 || output->executable_path[0] != '/') {
        return errno == 0 ? ESRCH : errno;
    }
    output->pid = info.pbi_pid;
    output->ppid = info.pbi_ppid;
    output->euid = info.pbi_uid;
    output->ruid = info.pbi_ruid;
    output->status = info.pbi_status;
    output->start_sec = info.pbi_start_tvsec;
    output->start_usec = info.pbi_start_tvusec;
    return 0;
}

static int nimi_macos_code_for_process(uint32_t pid, const audit_token_t *token, SecCodeRef *output) {
    const void *key = NULL;
    const void *value = NULL;
    CFTypeRef attribute = NULL;
    if (token != NULL) {
        key = kSecGuestAttributeAudit;
        attribute = CFDataCreate(kCFAllocatorDefault, (const UInt8 *)token, sizeof(*token));
    } else {
        key = kSecGuestAttributePid;
        int32_t signed_pid = (int32_t)pid;
        attribute = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &signed_pid);
    }
    if (attribute == NULL) {
        return ENOMEM;
    }
    value = attribute;
    CFDictionaryRef attributes = CFDictionaryCreate(kCFAllocatorDefault, &key, &value, 1,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFRelease(attribute);
    if (attributes == NULL) {
        return ENOMEM;
    }
    OSStatus status = SecCodeCopyGuestWithAttributes(NULL, attributes, kSecCSDefaultFlags, output);
    CFRelease(attributes);
    return status == errSecSuccess && *output != NULL ? 0 : (int)status;
}

static int nimi_macos_verify_code(uint32_t pid, const nimi_macos_audit_identity *audit,
                                  const char *expected_requirement,
                                  const char *expected_team,
                                  const char *expected_identifier,
                                  nimi_macos_code_identity *output) {
    if (pid == 0 || expected_requirement == NULL || expected_team == NULL ||
        expected_identifier == NULL || output == NULL || expected_requirement[0] == '\0' ||
        expected_team[0] == '\0' || expected_identifier[0] == '\0') {
        return EINVAL;
    }
    memset(output, 0, sizeof(*output));
    if (audit != NULL && audit->pid != pid) {
        return EINVAL;
    }

    SecCodeRef code = NULL;
    int result = nimi_macos_code_for_process(pid, audit == NULL ? NULL : &audit->token, &code);
    if (result != 0) {
        return result;
    }
    CFStringRef expected_requirement_string = CFStringCreateWithCString(
        kCFAllocatorDefault, expected_requirement, kCFStringEncodingUTF8);
    CFStringRef expected_team_string = CFStringCreateWithCString(
        kCFAllocatorDefault, expected_team, kCFStringEncodingUTF8);
    CFStringRef expected_identifier_string = CFStringCreateWithCString(
        kCFAllocatorDefault, expected_identifier, kCFStringEncodingUTF8);
    if (expected_requirement_string == NULL || expected_team_string == NULL || expected_identifier_string == NULL) {
        result = ENOMEM;
        goto cleanup_strings;
    }

    SecRequirementRef requirement = NULL;
    OSStatus status = SecRequirementCreateWithString(expected_requirement_string, kSecCSDefaultFlags, &requirement);
    if (status != errSecSuccess || requirement == NULL) {
        result = (int)status;
        goto cleanup_strings;
    }
    status = SecCodeCheckValidity(code, kSecCSStrictValidate | kSecCSCheckAllArchitectures, requirement);
    if (status != errSecSuccess) {
        result = (int)status;
        CFRelease(requirement);
        goto cleanup_strings;
    }

    CFDictionaryRef signing = NULL;
    status = SecCodeCopySigningInformation(code, kSecCSSigningInformation, &signing);
    if (status != errSecSuccess || signing == NULL) {
        result = (int)status;
        CFRelease(requirement);
        goto cleanup_strings;
    }
    CFStringRef team = (CFStringRef)CFDictionaryGetValue(signing, kSecCodeInfoTeamIdentifier);
    CFStringRef identifier = (CFStringRef)CFDictionaryGetValue(signing, kSecCodeInfoIdentifier);
    CFDataRef cdhash = (CFDataRef)CFDictionaryGetValue(signing, kSecCodeInfoUnique);
    CFNumberRef flags = (CFNumberRef)CFDictionaryGetValue(signing, kSecCodeInfoFlags);
    if (team == NULL || identifier == NULL || cdhash == NULL || flags == NULL ||
        CFGetTypeID(team) != CFStringGetTypeID() || CFGetTypeID(identifier) != CFStringGetTypeID() ||
        CFGetTypeID(cdhash) != CFDataGetTypeID() || CFGetTypeID(flags) != CFNumberGetTypeID() ||
        !CFEqual(team, expected_team_string) || !CFEqual(identifier, expected_identifier_string)) {
        result = EACCES;
        CFRelease(signing);
        CFRelease(requirement);
        goto cleanup_strings;
    }
    int32_t code_flags = 0;
    if (!CFNumberGetValue(flags, kCFNumberSInt32Type, &code_flags) ||
        (((uint32_t)code_flags) & kSecCodeSignatureRuntime) == 0) {
        result = EACCES;
        CFRelease(signing);
        CFRelease(requirement);
        goto cleanup_strings;
    }
    CFIndex cdhash_len = CFDataGetLength(cdhash);
    if (cdhash_len <= 0 || cdhash_len > (CFIndex)sizeof(output->cdhash)) {
        result = EOVERFLOW;
        CFRelease(signing);
        CFRelease(requirement);
        goto cleanup_strings;
    }

    SecRequirementRef actual_requirement = NULL;
    CFStringRef actual_requirement_string = NULL;
    status = SecCodeCopyDesignatedRequirement((SecStaticCodeRef)code, kSecCSDefaultFlags, &actual_requirement);
    if (status != errSecSuccess || actual_requirement == NULL) {
        result = (int)status;
        CFRelease(signing);
        CFRelease(requirement);
        goto cleanup_strings;
    }
    status = SecRequirementCopyString(actual_requirement, kSecCSDefaultFlags, &actual_requirement_string);
    if (status != errSecSuccess || actual_requirement_string == NULL ||
        !CFEqual(actual_requirement_string, expected_requirement_string)) {
        result = status == errSecSuccess ? EACCES : (int)status;
        if (actual_requirement_string != NULL) CFRelease(actual_requirement_string);
        CFRelease(actual_requirement);
        CFRelease(signing);
        CFRelease(requirement);
        goto cleanup_strings;
    }

    result = nimi_copy_cf_string(team, output->team_id, sizeof(output->team_id));
    if (result == 0) result = nimi_copy_cf_string(identifier, output->signing_identifier, sizeof(output->signing_identifier));
    if (result == 0) result = nimi_copy_cf_string(actual_requirement_string, output->designated_requirement, sizeof(output->designated_requirement));
    if (result == 0) {
        memcpy(output->cdhash, CFDataGetBytePtr(cdhash), (size_t)cdhash_len);
        output->cdhash_len = (size_t)cdhash_len;
        output->code_flags = (uint32_t)code_flags;
    }
    CFRelease(actual_requirement_string);
    CFRelease(actual_requirement);
    CFRelease(signing);
    CFRelease(requirement);

cleanup_strings:
    if (expected_identifier_string != NULL) CFRelease(expected_identifier_string);
    if (expected_team_string != NULL) CFRelease(expected_team_string);
    if (expected_requirement_string != NULL) CFRelease(expected_requirement_string);
    CFRelease(code);
    return result;
}

static int nimi_macos_verify_outer_bundle(const char *expected_requirement,
                                          const char *expected_team,
                                          const char *expected_identifier) {
    if (expected_requirement == NULL || expected_team == NULL || expected_identifier == NULL ||
        expected_requirement[0] == '\0' || expected_team[0] == '\0' ||
        expected_identifier[0] == '\0') {
        return EINVAL;
    }
    const char *path = "/Applications/Nimi.app";
    CFURLRef url = CFURLCreateFromFileSystemRepresentation(
        kCFAllocatorDefault, (const UInt8 *)path, (CFIndex)strlen(path), true);
    if (url == NULL) {
        return ENOMEM;
    }
    SecStaticCodeRef code = NULL;
    OSStatus status = SecStaticCodeCreateWithPath(url, kSecCSDefaultFlags, &code);
    CFRelease(url);
    if (status != errSecSuccess || code == NULL) {
        return status == errSecSuccess ? EACCES : (int)status;
    }
    CFStringRef requirement_string = CFStringCreateWithCString(
        kCFAllocatorDefault, expected_requirement, kCFStringEncodingUTF8);
    CFStringRef team_string = CFStringCreateWithCString(
        kCFAllocatorDefault, expected_team, kCFStringEncodingUTF8);
    CFStringRef identifier_string = CFStringCreateWithCString(
        kCFAllocatorDefault, expected_identifier, kCFStringEncodingUTF8);
    if (requirement_string == NULL || team_string == NULL || identifier_string == NULL) {
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
        CFRelease(team_string);
        CFRelease(requirement_string);
        CFRelease(code);
        return status == errSecSuccess ? EACCES : (int)status;
    }
    CFErrorRef error = NULL;
    status = SecStaticCodeCheckValidityWithErrors(
        code,
        kSecCSStrictValidate | kSecCSCheckGatekeeperArchitectures |
            kSecCSCheckNestedCode | kSecCSRestrictSymlinks |
            kSecCSRestrictToAppLike | kSecCSConsiderExpiration |
            kSecCSCheckTrustedAnchors,
        requirement,
        &error);
    if (error != NULL) {
        CFRelease(error);
    }
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
            if (team == NULL || identifier == NULL || ticket == NULL || flags == NULL ||
                CFGetTypeID(team) != CFStringGetTypeID() ||
                CFGetTypeID(identifier) != CFStringGetTypeID() ||
                CFGetTypeID(ticket) != CFDataGetTypeID() ||
                CFGetTypeID(flags) != CFNumberGetTypeID() ||
                CFDataGetLength(ticket) <= 0 ||
                !CFNumberGetValue(flags, kCFNumberSInt32Type, &code_flags) ||
                (((uint32_t)code_flags) & kSecCodeSignatureRuntime) == 0 ||
                !CFEqual(team, team_string) || !CFEqual(identifier, identifier_string)) {
                status = errSecCSReqFailed;
            }
            CFRelease(signing);
        } else if (status == errSecSuccess) {
            status = errSecCSReqFailed;
        }
    }
    if (status == errSecSuccess) {
        SecRequirementRef actual_requirement = NULL;
        CFStringRef actual_requirement_string = NULL;
        status = SecCodeCopyDesignatedRequirement(code, kSecCSDefaultFlags, &actual_requirement);
        if (status == errSecSuccess && actual_requirement != NULL) {
            status = SecRequirementCopyString(
                actual_requirement, kSecCSDefaultFlags, &actual_requirement_string);
        }
        if (status != errSecSuccess || actual_requirement_string == NULL ||
            !CFEqual(actual_requirement_string, requirement_string)) {
            status = status == errSecSuccess ? errSecCSReqFailed : status;
        }
        if (actual_requirement_string != NULL) CFRelease(actual_requirement_string);
        if (actual_requirement != NULL) CFRelease(actual_requirement);
    }
    CFRelease(requirement);
    CFRelease(identifier_string);
    CFRelease(team_string);
    CFRelease(requirement_string);
    CFRelease(code);
    return status == errSecSuccess ? 0 : (int)status;
}
*/
import "C"

import (
	"encoding/hex"
	"fmt"
	"strings"
	"unsafe"
)

type macOSAuditIdentity struct {
	euid              uint32
	ruid              uint32
	auid              uint32
	auditSession      uint32
	pid               uint32
	pidVersion        uint32
	consoleUID        uint32
	sessionAttributes uint32
	native            C.nimi_macos_audit_identity
}

type macOSProcessSnapshot struct {
	pid            uint32
	parentPID      uint32
	euid           uint32
	ruid           uint32
	status         uint32
	startSeconds   uint64
	startMicros    uint64
	executablePath string
}

type macOSCodeIdentity struct {
	teamID                string
	signingIdentifier     string
	designatedRequirement string
	cdhash                string
	codeFlags             uint32
}

type macOSRuntimeAccountRecord struct {
	uid   uint32
	gid   uint32
	home  string
	shell string
}

func lookupMacOSRuntimeAccount(name string) (macOSRuntimeAccountRecord, error) {
	accountName := C.CString(name)
	defer C.free(unsafe.Pointer(accountName))
	var native C.nimi_macos_runtime_account
	if result := C.nimi_macos_lookup_runtime_account(accountName, &native); result != 0 {
		return macOSRuntimeAccountRecord{}, fmt.Errorf("resolve macOS Runtime account: native status %d", int(result))
	}
	return macOSRuntimeAccountRecord{
		uid:   uint32(native.uid),
		gid:   uint32(native.gid),
		home:  C.GoString(&native.home[0]),
		shell: C.GoString(&native.shell[0]),
	}, nil
}

func verifyMacOSOuterBundleSeal(designatedRequirement, teamID, signingIdentifier string) error {
	requirement := C.CString(designatedRequirement)
	team := C.CString(teamID)
	identifier := C.CString(signingIdentifier)
	defer C.free(unsafe.Pointer(requirement))
	defer C.free(unsafe.Pointer(team))
	defer C.free(unsafe.Pointer(identifier))
	if result := C.nimi_macos_verify_outer_bundle(requirement, team, identifier); result != 0 {
		return fmt.Errorf("verify macOS outer application signature and resource seal: native status %d", int(result))
	}
	return nil
}

func macOSSocketPeerIdentity(fd uintptr) (macOSAuditIdentity, error) {
	var native C.nimi_macos_audit_identity
	result := C.nimi_macos_socket_peer(C.int(fd), &native)
	if result != 0 {
		return macOSAuditIdentity{}, fmt.Errorf("read macOS connected peer audit token: native status %d", int(result))
	}
	return macOSAuditIdentity{
		euid:              uint32(native.euid),
		ruid:              uint32(native.ruid),
		auid:              uint32(native.auid),
		auditSession:      uint32(native.audit_session),
		pid:               uint32(native.pid),
		pidVersion:        uint32(native.pidversion),
		consoleUID:        uint32(native.console_uid),
		sessionAttributes: uint32(native.session_attributes),
		native:            native,
	}, nil
}

func revalidateMacOSGraphicSession(euid, auditSession uint32) error {
	if result := C.nimi_macos_revalidate_graphic_session(C.uint32_t(auditSession), C.uint32_t(euid)); result != 0 {
		return fmt.Errorf("revalidate macOS graphic login session: native status %d", int(result))
	}
	return nil
}

func inspectMacOSProcess(pid uint32) (macOSProcessSnapshot, error) {
	var native C.nimi_macos_process_snapshot
	if result := C.nimi_macos_process_info(C.uint32_t(pid), &native); result != 0 {
		return macOSProcessSnapshot{}, fmt.Errorf("inspect macOS process: native status %d", int(result))
	}
	path := C.GoString((*C.char)(unsafe.Pointer(&native.executable_path[0])))
	if !strings.HasPrefix(path, "/") {
		return macOSProcessSnapshot{}, fmt.Errorf("inspect macOS process: absolute executable path required")
	}
	return macOSProcessSnapshot{
		pid:            uint32(native.pid),
		parentPID:      uint32(native.ppid),
		euid:           uint32(native.euid),
		ruid:           uint32(native.ruid),
		status:         uint32(native.status),
		startSeconds:   uint64(native.start_sec),
		startMicros:    uint64(native.start_usec),
		executablePath: path,
	}, nil
}

func verifyMacOSDynamicCode(pid uint32, audit *macOSAuditIdentity, policy macOSCodePolicy) (macOSCodeIdentity, error) {
	if err := policy.validate(); err != nil {
		return macOSCodeIdentity{}, err
	}
	requirement := C.CString(policy.designatedRequirement)
	team := C.CString(policy.teamID)
	identifier := C.CString(policy.signingIdentifier)
	defer C.free(unsafe.Pointer(requirement))
	defer C.free(unsafe.Pointer(team))
	defer C.free(unsafe.Pointer(identifier))
	var native C.nimi_macos_code_identity
	var nativeAudit *C.nimi_macos_audit_identity
	if audit != nil {
		nativeAudit = &audit.native
	}
	result := C.nimi_macos_verify_code(C.uint32_t(pid), nativeAudit, requirement, team, identifier, &native)
	if result != 0 {
		return macOSCodeIdentity{}, fmt.Errorf("verify macOS dynamic code: native status %d", int(result))
	}
	cdhashLength := int(native.cdhash_len)
	if cdhashLength <= 0 || cdhashLength > len(native.cdhash) {
		return macOSCodeIdentity{}, fmt.Errorf("verify macOS dynamic code: invalid cdhash")
	}
	cdhashBytes := C.GoBytes(unsafe.Pointer(&native.cdhash[0]), C.int(cdhashLength))
	identity := macOSCodeIdentity{
		teamID:                C.GoString(&native.team_id[0]),
		signingIdentifier:     C.GoString(&native.signing_identifier[0]),
		designatedRequirement: C.GoString(&native.designated_requirement[0]),
		cdhash:                hex.EncodeToString(cdhashBytes),
		codeFlags:             uint32(native.code_flags),
	}
	if identity.teamID != policy.teamID || identity.signingIdentifier != policy.signingIdentifier || identity.designatedRequirement != policy.designatedRequirement || identity.cdhash == "" {
		return macOSCodeIdentity{}, fmt.Errorf("verify macOS dynamic code: release identity mismatch")
	}
	return identity, nil
}
