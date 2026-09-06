package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

type LocalDevelopmentProcessPolicy struct {
	ProjectRoot          string
	HostExecutablePath   string
	ProjectHostAliasPath string
	// SupervisorProcess is injected from the verified Desktop connection by
	// Runtime service code on Windows. SupervisorPID carries the directly
	// verified macOS Desktop PID. Neither is persisted or request-supplied.
	SupervisorProcess ProcessTuple
	SupervisorPID     uint32
}

func (policy LocalDevelopmentProcessPolicy) supervisorPID() uint32 {
	if policy.SupervisorPID != 0 {
		return policy.SupervisorPID
	}
	return policy.SupervisorProcess.PID
}

type LocalDevelopmentProcessVerifier interface {
	VerifyLocalDevelopmentProcess(context.Context, uint32, LocalDevelopmentProcessPolicy) (ProcessTuple, DesktopProcessLiveness, error)
}

type LocalDevelopmentBindFailureStage string

const (
	LocalDevelopmentBindStageInput     LocalDevelopmentBindFailureStage = "input"
	LocalDevelopmentBindStageVerify    LocalDevelopmentBindFailureStage = "verify"
	LocalDevelopmentBindStageWitness   LocalDevelopmentBindFailureStage = "witness"
	LocalDevelopmentBindStageLiveness  LocalDevelopmentBindFailureStage = "liveness"
	LocalDevelopmentBindStageDuplicate LocalDevelopmentBindFailureStage = "duplicate"
	LocalDevelopmentBindStageCommit    LocalDevelopmentBindFailureStage = "commit"
)

type localDevelopmentBindStageError struct {
	stage LocalDevelopmentBindFailureStage
	cause error
}

func (failure *localDevelopmentBindStageError) Error() string { return failure.cause.Error() }
func (failure *localDevelopmentBindStageError) Unwrap() error { return failure.cause }

func localDevelopmentBindStageFailure(stage LocalDevelopmentBindFailureStage, cause error) error {
	if cause == nil {
		cause = fmt.Errorf("local-development process binding failed")
	}
	return &localDevelopmentBindStageError{stage: stage, cause: cause}
}

func LocalDevelopmentBindStageFromError(err error) (LocalDevelopmentBindFailureStage, bool) {
	var failure *localDevelopmentBindStageError
	if !errors.As(err, &failure) || failure.stage == "" {
		return "", false
	}
	return failure.stage, true
}

func BindLocalDevelopmentProcess(registry *LocalAppLaunchRegistry, ctx context.Context, launchID Identifier, pid uint32, verifier LocalDevelopmentProcessVerifier, policy LocalDevelopmentProcessPolicy, commit func(ProcessTuple) (time.Time, error), revoke func()) (time.Time, error) {
	if registry == nil {
		return time.Time{}, fmt.Errorf("local-development launch registry is required")
	}
	return registry.bind(ctx, launchID, pid, verifier, policy, commit, revoke)
}

type localAppLaunchBinding struct {
	launchID  Identifier
	process   ProcessTuple
	liveness  DesktopProcessLiveness
	done      chan struct{}
	revoke    func()
	policy    LocalDevelopmentProcessPolicy
	installed *InstalledAppProcessPolicy
}

type LocalAppLaunchRegistry struct {
	bootEpoch Identifier
	mu        sync.Mutex
	byLaunch  map[Identifier]*localAppLaunchBinding
	byPID     map[uint32]*localAppLaunchBinding
}

func NewLocalAppLaunchRegistry(bootEpoch Identifier) (*LocalAppLaunchRegistry, error) {
	if bootEpoch == (Identifier{}) {
		return nil, fmt.Errorf("local-app launch registry requires Runtime boot epoch")
	}
	return &LocalAppLaunchRegistry{bootEpoch: bootEpoch, byLaunch: make(map[Identifier]*localAppLaunchBinding), byPID: make(map[uint32]*localAppLaunchBinding)}, nil
}

func (registry *LocalAppLaunchRegistry) bind(ctx context.Context, launchID Identifier, pid uint32, verifier LocalDevelopmentProcessVerifier, policy LocalDevelopmentProcessPolicy, commit func(ProcessTuple) (time.Time, error), revoke func()) (time.Time, error) {
	if registry == nil || launchID == (Identifier{}) || pid == 0 || verifier == nil || commit == nil || revoke == nil {
		return time.Time{}, localDevelopmentBindStageFailure(LocalDevelopmentBindStageInput, fmt.Errorf("complete local-app process binding authority is required"))
	}
	process, liveness, err := verifier.VerifyLocalDevelopmentProcess(ctx, pid, policy)
	if err != nil {
		return time.Time{}, localDevelopmentBindStageFailure(LocalDevelopmentBindStageVerify, err)
	}
	accepted := false
	defer func() {
		if !accepted && liveness != nil {
			_ = liveness.Close()
		}
	}()
	if liveness == nil || liveness.Revoked() == nil || process.PID != pid {
		return time.Time{}, localDevelopmentBindStageFailure(LocalDevelopmentBindStageWitness, fmt.Errorf("verified local-app process witness is incomplete"))
	}
	if err := process.validate(); err != nil {
		return time.Time{}, localDevelopmentBindStageFailure(LocalDevelopmentBindStageWitness, fmt.Errorf("validate local-app process: %w", err))
	}
	select {
	case <-liveness.Revoked():
		return time.Time{}, localDevelopmentBindStageFailure(LocalDevelopmentBindStageLiveness, fmt.Errorf("local-app process exited before binding"))
	default:
	}

	registry.mu.Lock()
	defer registry.mu.Unlock()
	if registry.byLaunch[launchID] != nil || registry.byPID[pid] != nil {
		return time.Time{}, localDevelopmentBindStageFailure(LocalDevelopmentBindStageDuplicate, fmt.Errorf("local-app launch or process is already bound"))
	}
	deadline, err := commit(process)
	if err != nil {
		return time.Time{}, localDevelopmentBindStageFailure(LocalDevelopmentBindStageCommit, err)
	}
	binding := &localAppLaunchBinding{launchID: launchID, process: process, liveness: liveness, done: make(chan struct{}), revoke: revoke, policy: policy}
	registry.byLaunch[launchID] = binding
	registry.byPID[pid] = binding
	accepted = true
	go registry.watch(binding)
	return deadline, nil
}

// BoundProcessPolicy is read only after the native pipe reports its actual
// client PID. It cannot create or consume a binding; Promote remains the sole
// atomic transition to a verified host connection.
func (registry *LocalAppLaunchRegistry) BoundProcessPolicy(pid uint32) (ProcessTuple, LocalDevelopmentProcessPolicy, bool) {
	if registry == nil || pid == 0 {
		return ProcessTuple{}, LocalDevelopmentProcessPolicy{}, false
	}
	registry.mu.Lock()
	defer registry.mu.Unlock()
	binding := registry.byPID[pid]
	if binding == nil || binding.installed != nil {
		return ProcessTuple{}, LocalDevelopmentProcessPolicy{}, false
	}
	return binding.process, binding.policy, true
}

func (registry *LocalAppLaunchRegistry) BindInstalled(launchID Identifier, policy InstalledAppProcessPolicy, process ProcessTuple, liveness DesktopProcessLiveness, revoke func()) error {
	if registry == nil || launchID == (Identifier{}) || !policy.valid() || process.validate() != nil || process.ExecutableDigest != policy.HostExecutableDigest ||
		process.CanonicalExecutablePath != policy.HostExecutablePath || liveness == nil || liveness.Revoked() == nil || revoke == nil {
		return fmt.Errorf("complete verified installed process is required")
	}
	select {
	case <-liveness.Revoked():
		return fmt.Errorf("installed process exited before bind")
	default:
	}
	registry.mu.Lock()
	defer registry.mu.Unlock()
	if registry.byLaunch[launchID] != nil || registry.byPID[process.PID] != nil {
		return fmt.Errorf("installed process is already bound")
	}
	binding := &localAppLaunchBinding{launchID: launchID, process: process, liveness: liveness, done: make(chan struct{}), revoke: revoke, installed: &policy}
	registry.byLaunch[launchID], registry.byPID[process.PID] = binding, binding
	go registry.watch(binding)
	return nil
}

func (registry *LocalAppLaunchRegistry) BoundInstalledProcessPolicy(pid uint32) (ProcessTuple, InstalledAppProcessPolicy, bool) {
	if registry == nil {
		return ProcessTuple{}, InstalledAppProcessPolicy{}, false
	}
	registry.mu.Lock()
	defer registry.mu.Unlock()
	binding := registry.byPID[pid]
	if binding == nil || binding.installed == nil {
		return ProcessTuple{}, InstalledAppProcessPolicy{}, false
	}
	return binding.process, *binding.installed, true
}

func (registry *LocalAppLaunchRegistry) RevokeInstalled(launchID Identifier) {
	if registry == nil {
		return
	}
	registry.mu.Lock()
	binding := registry.byLaunch[launchID]
	if binding == nil || binding.installed == nil {
		registry.mu.Unlock()
		return
	}
	delete(registry.byLaunch, launchID)
	delete(registry.byPID, binding.process.PID)
	close(binding.done)
	registry.mu.Unlock()
	_ = binding.liveness.Close()
}

func (registry *LocalAppLaunchRegistry) watch(binding *localAppLaunchBinding) {
	select {
	case <-binding.liveness.Revoked():
		registry.remove(binding, true)
	case <-binding.done:
	}
}

// Promote requires the independently verified named-pipe peer to equal the
// pre-bound suspended process exactly. It transfers the retained pre-bind
// liveness witness to the local-app connection.
func (registry *LocalAppLaunchRegistry) Promote(peer ProcessTuple, pipeLiveness DesktopProcessLiveness) (VerifiedLocalAppLaunchPeer, error) {
	if registry == nil || pipeLiveness == nil || pipeLiveness.Revoked() == nil || peer.validate() != nil {
		if pipeLiveness != nil {
			_ = pipeLiveness.Close()
		}
		return VerifiedLocalAppLaunchPeer{}, fmt.Errorf("verified local-app pipe peer is required")
	}
	registry.mu.Lock()
	binding := registry.byPID[peer.PID]
	if binding == nil || binding.process != peer {
		registry.mu.Unlock()
		_ = pipeLiveness.Close()
		return VerifiedLocalAppLaunchPeer{}, fmt.Errorf("local-app pipe peer does not match a bound launch")
	}
	delete(registry.byPID, peer.PID)
	delete(registry.byLaunch, binding.launchID)
	close(binding.done)
	registry.mu.Unlock()
	_ = pipeLiveness.Close()
	result := VerifiedLocalAppLaunchPeer{LaunchID: binding.launchID, Process: binding.process, RuntimeBootEpoch: registry.bootEpoch, ProcessLiveness: binding.liveness, TrustClass: LocalAppTrustLocalDevelopment}
	if binding.installed != nil {
		result.TrustClass = LocalAppTrustVerified
		result.InstalledRegistrationHandle = binding.installed.RegistrationHandle
		result.SourceGeneration = binding.installed.SourceGeneration
		result.DeclarationGeneration = binding.installed.DeclarationGeneration
	}
	return result, nil
}

func (registry *LocalAppLaunchRegistry) remove(binding *localAppLaunchBinding, revoke bool) {
	if registry == nil || binding == nil {
		return
	}
	registry.mu.Lock()
	if registry.byLaunch[binding.launchID] != binding || registry.byPID[binding.process.PID] != binding {
		registry.mu.Unlock()
		return
	}
	delete(registry.byLaunch, binding.launchID)
	delete(registry.byPID, binding.process.PID)
	registry.mu.Unlock()
	if revoke {
		binding.revoke()
	}
}
