//go:build windows

package engine

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func TestManagedPythonBuildEnvironmentMaterializesExactVersionedSitecustomize(t *testing.T) {
	venvRoot := filepath.Join(t.TempDir(), "environments", "speech", "qwen3-asr")
	env, err := managedPythonBuildEnvironment(venvRoot)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(managedPythonBuildSitecustomize)
	wantSiteRoot := filepath.Join(
		filepath.Dir(venvRoot),
		managedPythonBuildSiteDirectory,
		fmt.Sprintf("%x", digest),
	)
	if env["PYTHONPATH"] != wantSiteRoot {
		t.Fatalf("PYTHONPATH = %q, want %q", env["PYTHONPATH"], wantSiteRoot)
	}
	observed, err := os.ReadFile(filepath.Join(wantSiteRoot, "sitecustomize.py"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(observed, managedPythonBuildSitecustomize) {
		t.Fatal("materialized sitecustomize does not match the embedded Runtime payload")
	}
	if env["UV_CACHE_DIR"] != filepath.Join(filepath.Dir(venvRoot), "_uv-cache") {
		t.Fatalf("UV_CACHE_DIR = %q", env["UV_CACHE_DIR"])
	}
}

func TestManagedPythonBuildEnvironmentFailsClosedOnPayloadMismatch(t *testing.T) {
	venvRoot := filepath.Join(t.TempDir(), "environments", "speech", "qwen3-asr")
	env, err := managedPythonBuildEnvironment(venvRoot)
	if err != nil {
		t.Fatal(err)
	}
	sitecustomizePath := filepath.Join(env["PYTHONPATH"], "sitecustomize.py")
	if err := os.WriteFile(sitecustomizePath, []byte("tampered\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := managedPythonBuildEnvironment(venvRoot); err == nil || !strings.Contains(err.Error(), "does not match Runtime payload") {
		t.Fatalf("payload mismatch error = %v", err)
	}
}

func TestManagedPythonBuildEnvironmentPreservesParentDACLOnlyInsideUVBuilds(t *testing.T) {
	pythonPath, version := pythonWithProtectedModeDirectories(t)
	if version[0] < 3 || version[0] == 3 && (version[1] < 12 || version[1] == 12 && version[2] < 4) {
		t.Skipf("Python %d.%d.%d predates protected mode-0700 Windows directories", version[0], version[1], version[2])
	}

	venvRoot := filepath.Join(t.TempDir(), "environments", "speech", "qwen3-asr")
	env, err := managedPythonBuildEnvironment(venvRoot)
	if err != nil {
		t.Fatal(err)
	}
	buildsRoot := filepath.Join(env["UV_CACHE_DIR"], "builds-v0")
	archiveRoot := filepath.Join(env["UV_CACHE_DIR"], "archive-v0")
	if err := os.MkdirAll(buildsRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(archiveRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	insideBuilds := filepath.Join(buildsRoot, ".tmp-nimi-acl-probe")
	outsideBuilds := filepath.Join(archiveRoot, ".tmp-nimi-acl-probe")
	command := exec.Command(
		pythonPath,
		"-c",
		"import os,sys; os.mkdir(sys.argv[1], 0o700); os.mkdir(sys.argv[2], 0o700)",
		insideBuilds,
		outsideBuilds,
	)
	command.Env = managedTestEnvironment(os.Environ(), map[string]string{
		"PYTHONPATH":   env["PYTHONPATH"],
		"UV_CACHE_DIR": env["UV_CACHE_DIR"],
	})
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("run managed Python ACL probe: %v (%s)", err, strings.TrimSpace(string(output)))
	}

	insideControl := directorySecurityDescriptorControl(t, insideBuilds)
	if insideControl&windows.SE_DACL_PROTECTED != 0 {
		t.Fatalf("uv build child retained a protected DACL: %#x", insideControl)
	}
	outsideControl := directorySecurityDescriptorControl(t, outsideBuilds)
	if outsideControl&windows.SE_DACL_PROTECTED == 0 {
		t.Fatalf("mode-0700 directory outside builds-v0 lost CPython protection: %#x", outsideControl)
	}
}

func pythonWithProtectedModeDirectories(t *testing.T) (string, [3]int) {
	t.Helper()
	pythonPath, err := exec.LookPath("python")
	if err != nil {
		t.Skip("Python is not available for the Windows ACL integration probe")
	}
	output, err := exec.Command(
		pythonPath,
		"-c",
		"import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')",
	).CombinedOutput()
	if err != nil {
		t.Skipf("Python version probe is unavailable: %v (%s)", err, strings.TrimSpace(string(output)))
	}
	parts := strings.Split(strings.TrimSpace(string(output)), ".")
	if len(parts) != 3 {
		t.Skipf("Python version probe returned %q", strings.TrimSpace(string(output)))
	}
	version := [3]int{}
	for index, part := range parts {
		value, err := strconv.Atoi(part)
		if err != nil {
			t.Skipf("Python version probe returned %q", strings.TrimSpace(string(output)))
		}
		version[index] = value
	}
	return pythonPath, version
}

func directorySecurityDescriptorControl(t *testing.T, path string) windows.SECURITY_DESCRIPTOR_CONTROL {
	t.Helper()
	descriptor, err := windows.GetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION,
	)
	if err != nil {
		t.Fatalf("read DACL for %s: %v", path, err)
	}
	control, _, err := descriptor.Control()
	if err != nil {
		t.Fatalf("read security descriptor control for %s: %v", path, err)
	}
	return control
}

func managedTestEnvironment(base []string, overrides map[string]string) []string {
	keys := make(map[string]struct{}, len(overrides))
	for key := range overrides {
		keys[strings.ToLower(key)] = struct{}{}
	}
	env := make([]string, 0, len(base)+len(overrides))
	for _, entry := range base {
		key, _, found := strings.Cut(entry, "=")
		if _, overridden := keys[strings.ToLower(key)]; found && overridden {
			continue
		}
		env = append(env, entry)
	}
	for key, value := range overrides {
		env = append(env, key+"="+value)
	}
	return env
}
