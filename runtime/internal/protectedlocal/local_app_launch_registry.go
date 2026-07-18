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
	// Runtime service code. It is never persisted or request-supplied.
	SupervisorProcess ProcessTuple
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
	launchID Identifier
	process  ProcessTuple
	liveness DesktopProcessLiveness
	done     chan struct{}
	revoke   func()
	policy   LocalDevelopmentProcessPolicy
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
	if binding == nil {
		return ProcessTuple{}, LocalDevelopmentProcessPolicy{}, false
	}
	return binding.process, binding.policy, true
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
	return VerifiedLocalAppLaunchPeer{LaunchID: binding.launchID, Process: binding.process, RuntimeBootEpoch: registry.bootEpoch, ProcessLiveness: binding.liveness, TrustClass: LocalAppTrustLocalDevelopment}, nil
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
