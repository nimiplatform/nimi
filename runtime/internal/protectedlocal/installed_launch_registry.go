package protectedlocal

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type InstalledProcessVerifier interface {
	VerifyInstalledProcess(context.Context, uint32) (ProcessTuple, DesktopProcessLiveness, error)
}

type installedLaunchBinding struct {
	launchID Identifier
	process  ProcessTuple
	liveness DesktopProcessLiveness
	done     chan struct{}
	revoke   func()
}

type InstalledLaunchRegistry struct {
	bootEpoch Identifier
	mu        sync.Mutex
	byLaunch  map[Identifier]*installedLaunchBinding
	byPID     map[uint32]*installedLaunchBinding
}

func NewInstalledLaunchRegistry(bootEpoch Identifier) (*InstalledLaunchRegistry, error) {
	if bootEpoch == (Identifier{}) {
		return nil, fmt.Errorf("installed launch registry requires Runtime boot epoch")
	}
	return &InstalledLaunchRegistry{bootEpoch: bootEpoch, byLaunch: make(map[Identifier]*installedLaunchBinding), byPID: make(map[uint32]*installedLaunchBinding)}, nil
}

// Bind verifies the suspended child through an OS-owned process witness before
// the durable commit callback transitions the launch record to process_bound.
func (registry *InstalledLaunchRegistry) Bind(ctx context.Context, launchID Identifier, pid uint32, verifier InstalledProcessVerifier, commit func(ProcessTuple) (time.Time, error), revoke func()) (time.Time, error) {
	if registry == nil || launchID == (Identifier{}) || pid == 0 || verifier == nil || commit == nil || revoke == nil {
		return time.Time{}, fmt.Errorf("complete installed process binding authority is required")
	}
	process, liveness, err := verifier.VerifyInstalledProcess(ctx, pid)
	if err != nil {
		return time.Time{}, err
	}
	accepted := false
	defer func() {
		if !accepted && liveness != nil {
			_ = liveness.Close()
		}
	}()
	if liveness == nil || liveness.Revoked() == nil || process.PID != pid {
		return time.Time{}, fmt.Errorf("verified installed process witness is incomplete")
	}
	if err := process.validate(); err != nil {
		return time.Time{}, fmt.Errorf("validate installed process: %w", err)
	}
	select {
	case <-liveness.Revoked():
		return time.Time{}, fmt.Errorf("installed process exited before binding")
	default:
	}

	registry.mu.Lock()
	defer registry.mu.Unlock()
	if registry.byLaunch[launchID] != nil || registry.byPID[pid] != nil {
		return time.Time{}, fmt.Errorf("installed launch or process is already bound")
	}
	deadline, err := commit(process)
	if err != nil {
		return time.Time{}, err
	}
	binding := &installedLaunchBinding{launchID: launchID, process: process, liveness: liveness, done: make(chan struct{}), revoke: revoke}
	registry.byLaunch[launchID] = binding
	registry.byPID[pid] = binding
	accepted = true
	go registry.watch(binding)
	return deadline, nil
}

func (registry *InstalledLaunchRegistry) watch(binding *installedLaunchBinding) {
	select {
	case <-binding.liveness.Revoked():
		registry.remove(binding, true)
	case <-binding.done:
	}
}

// Promote requires the independently verified named-pipe peer to equal the
// pre-bound suspended process exactly. It transfers the retained pre-bind
// liveness witness to the installed connection.
func (registry *InstalledLaunchRegistry) Promote(peer ProcessTuple, pipeLiveness DesktopProcessLiveness) (VerifiedInstalledLaunchPeer, error) {
	if registry == nil || pipeLiveness == nil || pipeLiveness.Revoked() == nil || peer.validate() != nil {
		if pipeLiveness != nil {
			_ = pipeLiveness.Close()
		}
		return VerifiedInstalledLaunchPeer{}, fmt.Errorf("verified installed pipe peer is required")
	}
	registry.mu.Lock()
	binding := registry.byPID[peer.PID]
	if binding == nil || binding.process != peer {
		registry.mu.Unlock()
		_ = pipeLiveness.Close()
		return VerifiedInstalledLaunchPeer{}, fmt.Errorf("installed pipe peer does not match a bound launch")
	}
	delete(registry.byPID, peer.PID)
	delete(registry.byLaunch, binding.launchID)
	close(binding.done)
	registry.mu.Unlock()
	_ = pipeLiveness.Close()
	return VerifiedInstalledLaunchPeer{LaunchID: binding.launchID, Process: binding.process, RuntimeBootEpoch: registry.bootEpoch, ProcessLiveness: binding.liveness}, nil
}

func (registry *InstalledLaunchRegistry) remove(binding *installedLaunchBinding, revoke bool) {
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
