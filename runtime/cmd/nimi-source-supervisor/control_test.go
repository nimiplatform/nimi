package main

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func testControlLockPath(t *testing.T) string {
	t.Helper()
	if runtime.GOOS != "windows" && runtime.GOOS != "darwin" {
		t.Skip("source Runtime control is platform-native")
	}
	if runtime.GOOS == "darwin" {
		// Darwin's Unix socket limit also includes the temporary directory.
		root, err := os.MkdirTemp("/tmp", "nimi-control-")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.RemoveAll(root) })
		return filepath.Join(root, "owner.lock")
	}
	return filepath.Join(t.TempDir(), "owner.lock")
}

func TestStopWaitsForOwnerRelease(t *testing.T) {
	lockPath := testControlLockPath(t)
	listener, err := acquireSourceRuntimeOwnerLock(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	control := newSupervisorControl(listener)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- requestSourceRuntimeStop(ctx, lockPath, true) }()
	select {
	case force := <-control.requests:
		if !force {
			t.Error("force request was lost")
		}
	case <-ctx.Done():
		control.finish(nil)
		t.Fatal("stop request did not reach the owner")
	}
	select {
	case err := <-result:
		t.Errorf("stop returned before owner release: %v", err)
	default:
	}
	control.finish(nil)
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	next, err := acquireSourceRuntimeOwnerLock(lockPath)
	if err != nil {
		t.Fatalf("owner lock was not released: %v", err)
	}
	_ = next.Close()
}

func TestStopAbsentOwner(t *testing.T) {
	lockPath := testControlLockPath(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := requestSourceRuntimeStop(ctx, lockPath, false); !errors.Is(err, errSourceRuntimeNotRunning) {
		t.Fatalf("absent owner returned %v", err)
	}
}

func TestStopTimeoutIsNotSuccessOrAbsentOwner(t *testing.T) {
	lockPath := testControlLockPath(t)
	listener, err := acquireSourceRuntimeOwnerLock(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	control := newSupervisorControl(listener)
	defer control.finish(nil)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	err = requestSourceRuntimeStop(ctx, lockPath, false)
	var timeout net.Error
	if !errors.As(err, &timeout) || !timeout.Timeout() || errors.Is(err, errSourceRuntimeNotRunning) {
		t.Fatalf("uncompleted shutdown returned %v", err)
	}
}

func TestStopReportsOwnerFailure(t *testing.T) {
	lockPath := testControlLockPath(t)
	listener, err := acquireSourceRuntimeOwnerLock(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	control := newSupervisorControl(listener)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- requestSourceRuntimeStop(ctx, lockPath, false) }()
	select {
	case <-control.requests:
	case <-ctx.Done():
		control.finish(nil)
		t.Fatal("stop request did not reach the owner")
	}
	control.finish(errors.New("shutdown failed"))
	if err := <-result; err == nil || errors.Is(err, errSourceRuntimeNotRunning) {
		t.Fatalf("failed shutdown returned %v", err)
	}
}
