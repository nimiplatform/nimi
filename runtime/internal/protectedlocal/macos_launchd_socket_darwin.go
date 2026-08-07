//go:build darwin && cgo && !nimi_macos_source_local_development

package protectedlocal

/*
#cgo CFLAGS: -mmacosx-version-min=13.0

#include <errno.h>
#include <fcntl.h>
#include <launch.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <unistd.h>

static int nimi_launch_activate_single_socket(const char *name, int *output) {
    if (name == NULL || output == NULL) return EINVAL;
    *output = -1;
    int *fds = NULL;
    size_t count = 0;
    int result = launch_activate_socket(name, &fds, &count);
    if (result != 0) return result;
    if (fds == NULL || count != 1 || fds[0] < 0) {
        if (fds != NULL) {
            for (size_t index = 0; index < count; index++) {
                if (fds[index] >= 0) close(fds[index]);
            }
            free(fds);
        }
        return EINVAL;
    }
    int fd = fds[0];
    free(fds);
    int descriptor_flags = fcntl(fd, F_GETFD);
    if (descriptor_flags < 0 || fcntl(fd, F_SETFD, descriptor_flags | FD_CLOEXEC) != 0) {
        int error = errno == 0 ? EIO : errno;
        close(fd);
        return error;
    }
    int socket_type = 0;
    socklen_t socket_type_length = sizeof(socket_type);
    if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &socket_type, &socket_type_length) != 0 ||
        socket_type != SOCK_STREAM) {
        int error = errno == 0 ? EPROTOTYPE : errno;
        close(fd);
        return error;
    }
    *output = fd;
    return 0;
}
*/
import "C"

import (
	"fmt"
	"net"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/unix"
)

const macOSRuntimeSocketMode = 0o660

func activateMacOSLaunchdSocket(name, expectedPath string, serviceUID uint32) (*net.UnixListener, error) {
	if name == "" || !filepath.IsAbs(expectedPath) || serviceUID == 0 {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("fixed launchd socket activation inputs are required"))
	}
	group, err := user.LookupGroup("staff")
	if err != nil || group == nil {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("resolve fixed macOS interactive socket group"))
	}
	staffGID, err := strconv.ParseUint(group.Gid, 10, 32)
	if err != nil {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("resolve fixed macOS interactive socket group id"))
	}
	parent := filepath.Dir(expectedPath)
	if err := validateMacOSSocketPathAncestors(parent); err != nil {
		return nil, err
	}
	parentInfo, err := os.Lstat(parent)
	parentStat, parentStatOK := parentInfoSys(parentInfo)
	if err != nil || parentInfo == nil || !parentInfo.IsDir() ||
		!parentStatOK || parentStat.Uid != 0 || parentInfo.Mode().Perm()&0o022 != 0 {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("launchd socket parent must be root-owned and non-writable"))
	}
	endpointInfo, err := os.Lstat(expectedPath)
	endpointStat, endpointStatOK := parentInfoSys(endpointInfo)
	if err != nil || endpointInfo == nil || endpointInfo.Mode()&os.ModeSocket == 0 || endpointInfo.Mode()&os.ModeSymlink != 0 ||
		!endpointStatOK || endpointStat.Uid != 0 || endpointStat.Gid != uint32(staffGID) || endpointInfo.Mode().Perm() != macOSRuntimeSocketMode {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("launchd socket vnode owner, group, or mode mismatch"))
	}
	nameCString := C.CString(name)
	defer C.free(unsafe.Pointer(nameCString))
	var fd C.int
	if result := C.nimi_launch_activate_single_socket(nameCString, &fd); result != 0 || fd < 0 {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("activate fixed launchd socket %s: native status %d", name, int(result)))
	}
	accepted := false
	defer func() {
		if !accepted {
			_ = unix.Close(int(fd))
		}
	}()
	if err := validateActivatedMacOSSocketFD(int(fd), expectedPath, endpointStat); err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), "launchd:"+name)
	if file == nil {
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("adopt launchd socket descriptor"))
	}
	listener, err := net.FileListener(file)
	fileCloseErr := file.Close()
	if err != nil || fileCloseErr != nil {
		if listener != nil {
			_ = listener.Close()
		}
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("adopt launchd Unix listener"))
	}
	unixListener, ok := listener.(*net.UnixListener)
	if !ok {
		_ = listener.Close()
		return nil, fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("launchd endpoint is not a Unix listener"))
	}
	accepted = true
	return unixListener, nil
}

func parentInfoSys(info os.FileInfo) (*syscall.Stat_t, bool) {
	if info == nil {
		return nil, false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	return stat, ok
}

func validateMacOSSocketPathAncestors(parent string) error {
	cleaned := filepath.Clean(strings.TrimSpace(parent))
	expected := filepath.Dir(MacOSDesktopSocketPath)
	if filepath.Dir(MacOSLocalAppSocketPath) != expected || cleaned != expected || !filepath.IsAbs(cleaned) {
		return fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("launchd socket directory is not the fixed canonical path"))
	}
	current := string(filepath.Separator)
	for _, component := range strings.Split(strings.TrimPrefix(cleaned, string(filepath.Separator)), string(filepath.Separator)) {
		current = filepath.Join(current, component)
		info, err := os.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("launchd socket directory contains a missing, non-directory, or symlinked ancestor"))
		}
	}
	return nil
}

func validateActivatedMacOSSocketFD(fd int, expectedPath string, endpointStat *syscall.Stat_t) error {
	if fd < 0 {
		return fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("launchd socket descriptor is invalid"))
	}
	if endpointStat == nil {
		return fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("launchd socket path identity is unavailable"))
	}
	var address unix.Sockaddr
	address, err := unix.Getsockname(fd)
	if err != nil {
		return fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("read launchd socket address: %w", err))
	}
	unixAddress, ok := address.(*unix.SockaddrUnix)
	if !ok || filepath.Clean(strings.TrimSpace(unixAddress.Name)) != expectedPath {
		return fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("launchd socket address mismatch"))
	}
	// A Darwin filesystem UDS has distinct socket-descriptor and filesystem-vnode
	// identities, so comparing fstat(fd) with lstat(path) is invalid and would
	// reject every real launchd socket. Bind the objects with the exact kernel
	// getsockname plus a stable, root-protected pathname vnode across activation.
	// The signed launchd job and launch_activate_socket are the descriptor owner;
	// the non-writable ancestor prevents an ordinary process from replacing the
	// pathname between these checks.
	currentInfo, err := os.Lstat(expectedPath)
	currentStat, currentStatOK := parentInfoSys(currentInfo)
	if err != nil || currentInfo == nil || currentInfo.Mode()&os.ModeSocket == 0 ||
		currentInfo.Mode()&os.ModeSymlink != 0 || !currentStatOK ||
		currentStat.Dev != endpointStat.Dev || currentStat.Ino != endpointStat.Ino {
		return fail(ReasonProtectedLocalTransportUnsupported, false, "repair_runtime_service", fmt.Errorf("launchd socket pathname was replaced during activation"))
	}
	return nil
}
