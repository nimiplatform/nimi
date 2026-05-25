package app

import (
	"context"
	"os"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// TestUninstallAppEmitsWatchableUninstallJob proves UninstallApp produces a
// typed AppInstallJob of kind=UNINSTALL that reaches the UNINSTALLED terminal
// state — the live-job truth source for the `uninstalling` card state
// (K-APP-017).
func TestUninstallAppEmitsWatchableUninstallJob(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	installBundledAppForOpen(t, svc)

	resp, err := svc.UninstallApp(context.Background(), &runtimev1.UninstallAppRequest{AppId: "nimi.shijing"})
	if err != nil {
		t.Fatalf("UninstallApp: %v", err)
	}
	job := resp.GetJob()
	if job == nil {
		t.Fatal("expected a watchable uninstall job in the response")
	}
	if job.GetKind() != runtimev1.AppLifecycleJobKind_APP_LIFECYCLE_JOB_KIND_UNINSTALL {
		t.Fatalf("job kind = %v, want UNINSTALL", job.GetKind())
	}
	if job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_UNINSTALLED {
		t.Fatalf("job state = %v detail=%q, want UNINSTALLED", job.GetState(), job.GetFailureDetail())
	}
	if job.GetPhase() != runtimev1.AppInstallJobPhase_APP_INSTALL_JOB_PHASE_UNINSTALLED {
		t.Fatalf("job phase = %v, want UNINSTALLED", job.GetPhase())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("job reason = %v, want ACTION_EXECUTED", job.GetReasonCode())
	}

	result := resp.GetResult()
	if result == nil || !result.GetReleaseRemoved() {
		t.Fatal("expected uninstall result with release removed")
	}
	if result.GetDurableDataRemoved() {
		t.Fatal("default uninstall must keep durable data")
	}

	// The job is retrievable as a terminal projection and watchable.
	fetched, ok := svc.installJobs.getJob(job.GetJobId())
	if !ok || !installJobTerminal(fetched.GetState()) {
		t.Fatalf("uninstall job %s not retrievable as terminal", job.GetJobId())
	}
}

// TestUninstallJobWatchStreamCarriesUninstallKind proves the WatchAppInstallJob
// progress stream carries the uninstall job frames so the `uninstalling` card
// state has a live source.
func TestUninstallJobWatchStreamCarriesUninstallKind(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	installBundledAppForOpen(t, svc)

	stream := newRecordingInstallEventStream()
	done := make(chan error, 1)
	go func() {
		done <- svc.WatchAppInstallJobEvents(&runtimev1.WatchAppInstallJobEventsRequest{}, stream)
	}()

	resp, err := svc.UninstallApp(context.Background(), &runtimev1.UninstallAppRequest{AppId: "nimi.shijing"})
	if err != nil {
		t.Fatalf("UninstallApp: %v", err)
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && !stream.terminalSeen() {
		time.Sleep(10 * time.Millisecond)
	}
	stream.cancel()
	<-done

	if !stream.terminalSeen() {
		t.Fatal("uninstall watch stream did not deliver a terminal frame")
	}
	var sawUninstallKind bool
	stream.mu.Lock()
	for _, event := range stream.events {
		if event.GetJob().GetJobId() != resp.GetJob().GetJobId() {
			continue
		}
		if event.GetJob().GetKind() == runtimev1.AppLifecycleJobKind_APP_LIFECYCLE_JOB_KIND_UNINSTALL {
			sawUninstallKind = true
		}
	}
	stream.mu.Unlock()
	if !sawUninstallKind {
		t.Fatal("uninstall watch stream did not carry an uninstall-kind job frame")
	}
}

// TestUninstallAppDestructiveDeleteRemovesDurableData proves a confirmed
// destructive uninstall removes the durable data and still emits a terminal
// uninstall job.
func TestUninstallAppDestructiveDeleteRemovesDurableData(t *testing.T) {
	svc, dataRoot := newBundledInstallService(t)
	installBundledAppForOpen(t, svc)

	resp, err := svc.UninstallApp(context.Background(), &runtimev1.UninstallAppRequest{
		AppId:                          "nimi.shijing",
		DeleteDurableData:              true,
		DestructiveDataDeleteConfirmed: true,
	})
	if err != nil {
		t.Fatalf("UninstallApp: %v", err)
	}
	if resp.GetJob().GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_UNINSTALLED {
		t.Fatalf("job state = %v, want UNINSTALLED", resp.GetJob().GetState())
	}
	if !resp.GetResult().GetDurableDataRemoved() {
		t.Fatal("expected durable data removed on confirmed destructive delete")
	}
	durableRoot := resp.GetResult().GetStorage().GetDurableDataRoot()
	if durableRoot == "" {
		t.Fatalf("expected durable data root in storage projection under %s", dataRoot)
	}
	if _, statErr := os.Stat(durableRoot); !os.IsNotExist(statErr) {
		t.Fatalf("expected durable data root removed, stat err = %v", statErr)
	}
}
