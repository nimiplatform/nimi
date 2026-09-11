package grpcserver

import (
	"context"
	"errors"
	"testing"
)

type appRootHandoffStub struct {
	entered chan struct{}
	settled chan struct{}
	fail    error
	resumed int
}

func (a *appRootHandoffStub) QuiesceDataRootContext(ctx context.Context) error {
	close(a.entered)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-a.settled:
		return a.fail
	}
}

func (a *appRootHandoffStub) ResumeDataRootAfterAbort() { a.resumed++ }

func TestProductControlRootHandoffWaitsForAppWorkersAndKeepsCommittedOwnerClosed(t *testing.T) {
	owner := &appRootHandoffStub{entered: make(chan struct{}), settled: make(chan struct{})}
	registry := newActiveRPCRegistry(nil)
	handoff := &productControlRuntimeRootHandoff{registry: registry, appPackages: owner}
	finished := make(chan error, 1)
	go func() { finished <- handoff.CloseRootAdmission(context.Background()) }()
	<-owner.entered
	select {
	case err := <-finished:
		t.Fatalf("root handoff passed unsettled App workers: %v", err)
	default:
	}
	_, release, admitted := registry.TrackUnary(context.Background(), "/nimi.runtime.v1.RuntimeAppPackageService/StartAppPackageInstall")
	release()
	if admitted {
		t.Fatal("new App download admitted during root handoff")
	}
	close(owner.settled)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	handoff.CommitRootHandoff()
	handoff.AbortRootHandoff()
	if owner.resumed != 0 {
		t.Fatal("committed handoff reopened the old App owner")
	}
}

func TestProductControlRootHandoffAbortsWhenAppCommitCannotBeSettled(t *testing.T) {
	unknown := errors.New("App commit outcome unknown")
	owner := &appRootHandoffStub{entered: make(chan struct{}), settled: make(chan struct{}), fail: unknown}
	close(owner.settled)
	registry := newActiveRPCRegistry(nil)
	handoff := &productControlRuntimeRootHandoff{registry: registry, appPackages: owner}
	if err := handoff.CloseRootAdmission(context.Background()); !errors.Is(err, unknown) {
		t.Fatalf("App owner failure did not block activation: %v", err)
	}
	handoff.AbortRootHandoff()
	if owner.resumed != 1 {
		t.Fatal("pre-commit abort did not restore App owner admission")
	}
	_, release, admitted := registry.TrackUnary(context.Background(), "/nimi.runtime.v1.RuntimeAppPackageService/ListAppPackageJobs")
	defer release()
	if !admitted {
		t.Fatal("pre-commit abort left current root RPC admission closed")
	}
}
