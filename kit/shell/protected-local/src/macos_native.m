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
#include <pwd.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/event.h>
#include <sys/proc_info.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

typedef struct {
    uint32_t pid;
    uint32_t pidversion;
    uint32_t euid;
    uint32_t ruid;
    uint32_t ppid;
    uint64_t start_sec;
    uint64_t start_usec;
    int kqueue_fd;
} nimi_macos_verified_runtime_peer;

static int nimi_fixed_runtime_service_uid(uid_t *output) {
    if (output == NULL) return EINVAL;
    struct passwd *account = getpwnam(NIMI_MACOS_RUNTIME_ACCOUNT);
    if (account == NULL || account->pw_uid == 0 || account->pw_name == NULL ||
        strcmp(account->pw_name, NIMI_MACOS_RUNTIME_ACCOUNT) != 0) return ENOENT;
    *output = account->pw_uid;
    return 0;
}

static int nimi_process_snapshot(pid_t pid, struct proc_bsdinfo *output, char *path, size_t path_size) {
    if (pid <= 0 || output == NULL || path == NULL || path_size < 2) return EINVAL;
    memset(output, 0, sizeof(*output));
    memset(path, 0, path_size);
    int read = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, output, sizeof(*output));
    if (read != sizeof(*output) || output->pbi_pid != (uint32_t)pid || output->pbi_start_tvsec == 0) {
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
    SecCSFlags validation_flags = kSecCSStrictValidate | kSecCSCheckAllArchitectures;
    if (require_trusted_anchor) validation_flags |= kSecCSCheckTrustedAnchors;
    status = SecCodeCheckValidity(code, validation_flags, requirement);
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
                                   int require_ad_hoc,
                                   nimi_macos_verified_runtime_peer *output) {
    if (socket_fd < 0 || output == NULL || expected_executable == NULL ||
        strcmp(expected_executable, NIMI_MACOS_RUNTIME_EXECUTABLE) != 0) return EINVAL;
    memset(output, 0, sizeof(*output));
    output->kqueue_fd = -1;
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
    int queue = kqueue();
    if (queue < 0) {
        return errno == 0 ? EIO : errno;
    }
    struct kevent change;
    EV_SET(&change, (uintptr_t)peer_pid, EVFILT_PROC, EV_ADD | EV_ENABLE | EV_CLEAR,
        NOTE_EXIT | NOTE_EXEC, 0, NULL);
    if (kevent(queue, &change, 1, NULL, 0, NULL) != 0) {
        close(queue);
        return errno == 0 ? EIO : errno;
    }
    output->pid = (uint32_t)peer_pid;
    output->pidversion = (uint32_t)audit_token_to_pidversion(token);
    output->euid = (uint32_t)service_uid;
    output->ruid = (uint32_t)service_uid;
    output->ppid = before.pbi_ppid;
    output->start_sec = before.pbi_start_tvsec;
    output->start_usec = before.pbi_start_tvusec;
    output->kqueue_fd = queue;
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

int nimi_macos_runtime_peer_alive(uint32_t pid, uint32_t expected_ppid,
                                  uint32_t expected_euid, uint64_t start_sec,
                                  uint64_t start_usec, int kqueue_fd,
                                  const char *expected_executable) {
    if (pid == 0 || kqueue_fd < 0 || expected_executable == NULL) return -1;
    struct kevent event;
    struct timespec timeout = {0, 0};
    int count = kevent(kqueue_fd, NULL, 0, &event, 1, &timeout);
    if (count < 0) return -1;
    if (count > 0) {
        if (event.filter == EVFILT_PROC && (event.fflags & NOTE_EXEC) != 0) return 2;
        if (event.filter == EVFILT_PROC && (event.fflags & NOTE_EXIT) != 0) return 0;
        return -1;
    }
    struct proc_bsdinfo process;
    char path[PROC_PIDPATHINFO_MAXSIZE];
    int snapshot = nimi_process_snapshot((pid_t)pid, &process, path, sizeof(path));
    if (snapshot == ESRCH) return 0;
    if (snapshot != 0) return -1;
    if (process.pbi_ppid != expected_ppid || process.pbi_uid != expected_euid ||
        process.pbi_ruid != expected_euid || process.pbi_start_tvsec != start_sec ||
        process.pbi_start_tvusec != start_usec || strcmp(path, expected_executable) != 0) return 2;
    return 1;
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
