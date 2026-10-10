//go:build !windows

package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"
)

func TestAudioCppCancellationWaitsForOwnedProcessTree(t *testing.T) {
	root := t.TempDir()
	model := filepath.Join(root, "model.gguf")
	data := []byte("process lifecycle fixture")
	if err := os.WriteFile(model, data, 0600); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(data)
	digest := hex.EncodeToString(hash[:])
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := runAudioCppProcess(ctx, audioCppProcessSpec{executablePath: executable, workingDir: root, cuda13Root: root, args: []string{"-test.run=^TestAudioCppProcessTreeProbe$", "--", "audio-tree-parent", root}, stagingOutputPath: filepath.Join(root, "music.wav"), modelBindings: []capabilitydriver.InvocationExactBinding{{RequirementID: "model", ModelAssetID: "fixture", AbsolutePath: model, BundleDir: root, DeclaredFiles: []string{"model.gguf"}, VerifiedContentID: "sha256:" + digest, EntrySHA256: digest}}})
		done <- err
	}()
	pids := []int{}
	defer func() {
		for _, pid := range pids {
			if process, err := os.FindProcess(pid); err == nil {
				_ = process.Kill()
			}
		}
	}()
	deadline := time.Now().Add(5 * time.Second)
	for _, name := range []string{"parent.pid", "child.pid"} {
		for {
			raw, err := os.ReadFile(filepath.Join(root, name))
			if err == nil {
				pid, err := strconv.Atoi(string(raw))
				if err != nil || pid <= 0 {
					t.Fatal("invalid fixture process identity")
				}
				pids = append(pids, pid)
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("owned process tree did not start")
			}
			time.Sleep(5 * time.Millisecond)
		}
	}
	cancel()
	select {
	case err := <-done:
		if localexecution.FailureKindOf(err) != localexecution.FailureCanceled {
			t.Fatalf("cancel outcome=%v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Host did not stop its own process group promptly")
	}
	for _, pid := range pids {
		if err := syscall.Kill(pid, 0); err != syscall.ESRCH {
			t.Fatalf("Host released with process %d still present: %v", pid, err)
		}
	}
	pids = nil
}
func TestAudioCppProcessTreeProbe(t *testing.T) {
	for i, arg := range os.Args {
		if (arg != "audio-tree-parent" && arg != "audio-tree-child") || i+1 >= len(os.Args) {
			continue
		}
		root := os.Args[i+1]
		name := "child.pid"
		if arg == "audio-tree-parent" {
			name = "parent.pid"
			executable, _ := os.Executable()
			child := exec.Command(executable, "-test.run=^TestAudioCppProcessTreeProbe$", "--", "audio-tree-child", root)
			child.Stdout = os.Stdout
			child.Stderr = os.Stderr
			if err := child.Start(); err != nil {
				t.Fatal(err)
			}
			go child.Wait()
		}
		if err := os.WriteFile(filepath.Join(root, name), []byte(fmt.Sprint(os.Getpid())), 0600); err != nil {
			t.Fatal(err)
		}
		for {
			time.Sleep(time.Second)
		}
	}
}

func audioCppOwnedProcessFixture(t *testing.T, root string, args []string) audioCppProcessSpec {
	t.Helper()
	model := filepath.Join(root, "model.gguf")
	data := []byte("owned process fixture")
	if err := os.WriteFile(model, data, 0600); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(data)
	digest := hex.EncodeToString(hash[:])
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return audioCppProcessSpec{executablePath: executable, workingDir: root, cuda13Root: root, args: args, stagingOutputPath: filepath.Join(root, "music.wav"), modelBindings: []capabilitydriver.InvocationExactBinding{{RequirementID: "model", ModelAssetID: "fixture", AbsolutePath: model, BundleDir: root, DeclaredFiles: []string{"model.gguf"}, VerifiedContentID: "sha256:" + digest, EntrySHA256: digest}}}
}
func TestAudioCppOwnerWatcherDoesNotHoldFinishedCommandOutput(t *testing.T) {
	root := t.TempDir()
	spec := audioCppOwnedProcessFixture(t, root, []string{"-test.run=^TestAudioCppProcessStartProbe$", "--", "audio-cpp-start-probe", filepath.Join(root, "started")})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := runAudioCppProcess(ctx, spec); err != nil {
		t.Fatalf("owner watcher held stdout after producer exit: %v", err)
	}
}
func TestAudioCppOwnerLossStopsItsActualTree(t *testing.T) {
	root := t.TempDir()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	runtimeProcess := exec.Command(executable, "-test.run=^TestAudioCppRuntimeOwnerProbe$", "--", "audio-runtime-probe", root)
	if err := runtimeProcess.Start(); err != nil {
		t.Fatal(err)
	}
	defer runtimeProcess.Process.Kill()
	pids := []int{}
	defer func() {
		for _, pid := range pids {
			if process, err := os.FindProcess(pid); err == nil {
				process.Kill()
			}
		}
	}()
	deadline := time.Now().Add(5 * time.Second)
	for _, name := range []string{"parent.pid", "child.pid"} {
		for {
			raw, err := os.ReadFile(filepath.Join(root, name))
			if err == nil {
				pid, err := strconv.Atoi(string(raw))
				if err != nil || pid <= 0 {
					t.Fatal("invalid owned identity")
				}
				pids = append(pids, pid)
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("Runtime-owned fixture did not start")
			}
			time.Sleep(5 * time.Millisecond)
		}
	}
	if err := runtimeProcess.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = runtimeProcess.Wait()
	deadline = time.Now().Add(6 * time.Second)
	for {
		allGone := true
		for _, pid := range pids {
			if syscall.Kill(pid, 0) != syscall.ESRCH {
				allGone = false
			}
		}
		if allGone {
			pids = nil
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("CLI tree outlived its Runtime owner")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
func TestAudioCppRuntimeOwnerProbe(t *testing.T) {
	for i, arg := range os.Args {
		if arg == "audio-runtime-probe" && i+1 < len(os.Args) {
			root := os.Args[i+1]
			spec := audioCppOwnedProcessFixture(t, root, []string{"-test.run=^TestAudioCppProcessTreeProbe$", "--", "audio-tree-parent", root})
			_, _ = runAudioCppProcess(context.Background(), spec)
			return
		}
	}
}
