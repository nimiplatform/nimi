//go:build windows

package main

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"syscall"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

func validateSourceSupervisorPrincipal() error {
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return err
	}
	defer func() { _ = token.Close() }()
	if token.IsElevated() {
		return fmt.Errorf("Windows source Runtime supervisor must be non-elevated")
	}
	user, err := token.GetTokenUser()
	if err != nil || user == nil || user.User.Sid == nil {
		return fmt.Errorf("resolve Windows source Runtime supervisor user SID: %w", err)
	}
	return nil
}

func sourceRuntimePipe(lockPath string) (string, string, error) {
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return "", "", err
	}
	defer func() { _ = token.Close() }()
	user, err := token.GetTokenUser()
	if err != nil || user == nil || user.User.Sid == nil {
		return "", "", fmt.Errorf("resolve source Runtime owner SID: %w", err)
	}
	sid := user.User.Sid.String()
	lockIdentity := sid
	if lockPath != "" {
		lockIdentity = sid + "\x00" + lockPath
	}
	digest := sha256.Sum256([]byte(lockIdentity))
	name := fmt.Sprintf(`\\.\pipe\nimi-source-runtime-supervisor-%x-v1`, digest)
	sddl := fmt.Sprintf("O:%sD:P(A;;GA;;;%s)", sid, sid)
	return name, sddl, nil
}

func acquireSourceRuntimeOwnerLock(lockPath string) (net.Listener, error) {
	name, sddl, err := sourceRuntimePipe(lockPath)
	if err != nil {
		return nil, err
	}
	listener, err := winio.ListenPipe(name, &winio.PipeConfig{SecurityDescriptor: sddl})
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errSourceRuntimeAlreadyOwned, err)
	}
	return listener, nil
}

func dialSourceRuntimeOwner(ctx context.Context, lockPath string) (net.Conn, error) {
	name, _, err := sourceRuntimePipe(lockPath)
	if err != nil {
		return nil, err
	}
	conn, err := winio.DialPipeContext(ctx, name)
	if errors.Is(err, windows.ERROR_FILE_NOT_FOUND) {
		return nil, errSourceRuntimeNotRunning
	}
	return conn, err
}

func requestRuntimeStop(process *os.Process) error {
	return windows.GenerateConsoleCtrlEvent(windows.CTRL_BREAK_EVENT, uint32(process.Pid))
}

func configureRuntimeCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP,
	}
}
