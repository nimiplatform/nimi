//go:build windows

package main

import (
	"crypto/sha256"
	"fmt"
	"io"
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

func acquireSourceRuntimeOwnerLock() (io.Closer, error) {
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return nil, err
	}
	defer func() { _ = token.Close() }()
	user, err := token.GetTokenUser()
	if err != nil || user == nil || user.User.Sid == nil {
		return nil, fmt.Errorf("resolve source Runtime owner SID: %w", err)
	}
	sid := user.User.Sid.String()
	digest := sha256.Sum256([]byte(sid))
	name := fmt.Sprintf(`\\.\pipe\nimi-source-runtime-supervisor-%x-v1`, digest)
	sddl := fmt.Sprintf("O:%sD:P(A;;GA;;;%s)", sid, sid)
	listener, err := winio.ListenPipe(name, &winio.PipeConfig{SecurityDescriptor: sddl})
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errSourceRuntimeAlreadyOwned, err)
	}
	return listener, nil
}

func requestRuntimeStop(process *os.Process) error {
	return windows.GenerateConsoleCtrlEvent(windows.CTRL_BREAK_EVENT, uint32(process.Pid))
}

func configureRuntimeCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP,
	}
}
