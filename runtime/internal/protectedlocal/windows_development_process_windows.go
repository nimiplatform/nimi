//go:build windows

package protectedlocal

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

type windowsLocalDevelopmentProcessVerifier struct {
	identity WindowsDesktopIdentity
}

type windowsLocalDevelopmentExecutableVerifier struct {
	projectRoot string
	hostPath    string
}

func NewWindowsLocalDevelopmentProcessVerifier(identity WindowsDesktopIdentity) (LocalDevelopmentProcessVerifier, error) {
	if err := identity.validate(); err != nil {
		return nil, windowsPipeFailure("create Windows local-development process verifier", fmt.Errorf("active Desktop identity is required: %w", err))
	}
	return &windowsLocalDevelopmentProcessVerifier{identity: identity}, nil
}

func (verifier *windowsLocalDevelopmentProcessVerifier) VerifyLocalDevelopmentProcess(ctx context.Context, pid uint32, policy LocalDevelopmentProcessPolicy) (ProcessTuple, DesktopProcessLiveness, error) {
	if verifier == nil {
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows local-development process", fmt.Errorf("local-development verifier is required"))
	}
	canonicalPolicy, err := canonicalWindowsLocalDevelopmentPolicy(policy)
	if err != nil {
		return ProcessTuple{}, nil, windowsExecutableTrustFailure("verify Windows local-development project policy", err)
	}
	return verifyWindowsLocalDevelopmentProcess(ctx, pid, verifier.identity, canonicalPolicy)
}

func verifyWindowsLocalDevelopmentProcess(ctx context.Context, pid uint32, identity WindowsDesktopIdentity, policy LocalDevelopmentProcessPolicy) (ProcessTuple, DesktopProcessLiveness, error) {
	if err := ctx.Err(); err != nil || pid == 0 {
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows local-development process", fmt.Errorf("live process and context are required: %w", err))
	}
	if err := identity.validate(); err != nil {
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows local-development identity", err)
	}
	if err := revalidateWindowsActiveSessionIdentity(ctx, identity); err != nil {
		return ProcessTuple{}, nil, err
	}
	process, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return ProcessTuple{}, nil, windowsPipeOperationFailure(WindowsPipeStageClientProcessOpen, "retain Windows local-development process", err)
	}
	accepted := false
	defer func() {
		if !accepted {
			_ = windows.CloseHandle(process)
		}
	}()
	var token windows.Token
	if err := windows.OpenProcessToken(process, windows.TOKEN_QUERY, &token); err != nil {
		return ProcessTuple{}, nil, windowsPipeOperationFailure(WindowsPipeStageClientTokenOpen, "open Windows local-development process token", err)
	}
	observed, err := inspectWindowsDesktopToken(token, identity)
	_ = token.Close()
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	creationMarker, err := windowsProcessCreationMarker(process)
	if err != nil {
		return ProcessTuple{}, nil, windowsPipeFailure("read Windows local-development process creation marker", err)
	}
	executableVerifier := windowsLocalDevelopmentExecutableVerifier{projectRoot: policy.ProjectRoot, hostPath: policy.HostExecutablePath}
	evidence, trustSetID, err := verifyWindowsLockedExecutable(ctx, process, pid, creationMarker, WindowsExecutableRoleInstalled, executableVerifier, WindowsLocalDevelopmentTrustSetID)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	liveness, err := newWindowsProcessLiveness(process, identity, observed)
	if err != nil {
		return ProcessTuple{}, nil, windowsPipeOperationFailure(WindowsPipeStageClientLiveness, "retain Windows local-development process liveness", err)
	}
	accepted = true
	tuple := ProcessTuple{
		OS:                          OSWindows,
		PID:                         pid,
		CreationMarker:              creationMarker,
		OSLoginSession:              observed.logonLUID,
		SecurityPrincipal:           observed.userSID,
		CanonicalExecutableIdentity: evidence.CanonicalFileIdentity,
		CanonicalExecutablePath:     policy.HostExecutablePath,
		ExecutableDigest:            evidence.Digest,
		ExecutableTrustSetID:        trustSetID,
	}
	if err := tuple.validate(); err != nil {
		_ = liveness.Close()
		return ProcessTuple{}, nil, windowsPipeFailure("validate Windows local-development process tuple", err)
	}
	return tuple, liveness, nil
}

func (verifier windowsLocalDevelopmentExecutableVerifier) VerifyWindowsExecutable(_ context.Context, role WindowsExecutableRole, locked WindowsLockedExecutable) (string, error) {
	if role != WindowsExecutableRoleInstalled || locked == nil {
		return "", fmt.Errorf("local-development host requires installed-app executable role")
	}
	evidence := locked.Evidence()
	observed, err := filepath.EvalSymlinks(filepath.Clean(evidence.Path))
	if err != nil {
		return "", fmt.Errorf("canonicalize local-development process executable: %w", err)
	}
	observed = filepath.Clean(observed)
	if !strings.EqualFold(observed, verifier.hostPath) || !windowsPathWithinRoot(verifier.projectRoot, observed) {
		return "", fmt.Errorf("local-development executable escaped the approved project or expected host path")
	}
	return WindowsLocalDevelopmentTrustSetID, nil
}

func canonicalWindowsLocalDevelopmentPolicy(policy LocalDevelopmentProcessPolicy) (LocalDevelopmentProcessPolicy, error) {
	root := filepath.Clean(strings.TrimSpace(policy.ProjectRoot))
	host := filepath.Clean(strings.TrimSpace(policy.HostExecutablePath))
	if !filepath.IsAbs(root) || !filepath.IsAbs(host) {
		return LocalDevelopmentProcessPolicy{}, fmt.Errorf("absolute project root and host executable are required")
	}
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return LocalDevelopmentProcessPolicy{}, fmt.Errorf("canonicalize project root: %w", err)
	}
	canonicalHost, err := filepath.EvalSymlinks(host)
	if err != nil {
		return LocalDevelopmentProcessPolicy{}, fmt.Errorf("canonicalize host executable: %w", err)
	}
	canonicalRoot = filepath.Clean(canonicalRoot)
	canonicalHost = filepath.Clean(canonicalHost)
	if !windowsPathWithinRoot(canonicalRoot, canonicalHost) {
		return LocalDevelopmentProcessPolicy{}, fmt.Errorf("host executable must remain inside the approved project root")
	}
	info, err := os.Stat(canonicalHost)
	if err != nil || !info.Mode().IsRegular() {
		return LocalDevelopmentProcessPolicy{}, fmt.Errorf("host executable must be a readable regular file")
	}
	return LocalDevelopmentProcessPolicy{ProjectRoot: canonicalRoot, HostExecutablePath: canonicalHost}, nil
}

func windowsPathWithinRoot(root string, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}

func (connection *WindowsDesktopPipeConnection) verifyAndBindLocalDevelopmentClientProcess(ctx context.Context, verifier LocalDevelopmentProcessVerifier, policy LocalDevelopmentProcessPolicy, expected ProcessTuple) (ProcessTuple, DesktopProcessLiveness, error) {
	if connection == nil || connection.instance == nil || connection.clientPID == 0 || verifier == nil {
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows local-development pipe client", fmt.Errorf("connected pipe and verifier are required"))
	}
	connection.verificationMu.Lock()
	defer connection.verificationMu.Unlock()
	if connection.verifiedClientHealth != nil || connection.verifiedClient != (ProcessTuple{}) {
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows local-development pipe client", fmt.Errorf("client process capability is already bound"))
	}
	process, liveness, err := verifier.VerifyLocalDevelopmentProcess(ctx, connection.clientPID, policy)
	if err != nil {
		return ProcessTuple{}, nil, err
	}
	if process != expected {
		_ = liveness.Close()
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows local-development pipe client", fmt.Errorf("pipe peer does not match the Desktop-bound host process"))
	}
	connection.instance.mu.Lock()
	closed := connection.instance.closed
	connection.instance.mu.Unlock()
	if closed {
		_ = liveness.Close()
		return ProcessTuple{}, nil, windowsPipeFailure("verify Windows local-development pipe client", fmt.Errorf("pipe connection closed during verification"))
	}
	connection.verifiedClient = process
	connection.verifiedClientHealth = liveness
	return process, liveness, nil
}

var _ LocalDevelopmentProcessVerifier = (*windowsLocalDevelopmentProcessVerifier)(nil)
var _ WindowsExecutableTrustVerifier = windowsLocalDevelopmentExecutableVerifier{}
