package runtimeinstance

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestRuntimeLockProcess(t *testing.T) {
	if os.Getenv("NIMI_TEST_LOCK_CHILD") != "1" {
		return
	}
	_, err := acquireLock(os.Getenv("NIMI_TEST_LOCK_NAME"))
	if errors.Is(err, ErrAlreadyRunning) {
		os.Exit(23)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(24)
	}
	// Deliberately exit without release: the OS must drop the lease.
	os.Exit(0)
}

func TestMachineLeaseRejectsOtherProcessAndReleasesOnExit(t *testing.T) {
	name := fmt.Sprintf("nimi-runtime-test-%d-%d", os.Getpid(), time.Now().UnixNano())
	t.Cleanup(func() { _ = os.Remove(filepath.Join("/tmp", name+".lock")) })
	release, err := acquireLock(name)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = release() })
	runChild := func() error {
		command := exec.Command(os.Args[0], "-test.run=^TestRuntimeLockProcess$")
		command.Env = append(os.Environ(), "NIMI_TEST_LOCK_CHILD=1", "NIMI_TEST_LOCK_NAME="+name)
		return command.Run()
	}
	var exit *exec.ExitError
	if err := runChild(); !errors.As(err, &exit) || exit.ExitCode() != 23 {
		t.Fatalf("second process must report an active Runtime, got %v", err)
	}
	if err := release(); err != nil {
		t.Fatal(err)
	}
	if err := runChild(); err != nil {
		t.Fatalf("start after normal release: %v", err)
	}
	releaseAgain, err := acquireLock(name)
	if err != nil {
		t.Fatalf("start after child exit: %v", err)
	}
	if err := releaseAgain(); err != nil {
		t.Fatal(err)
	}
}
