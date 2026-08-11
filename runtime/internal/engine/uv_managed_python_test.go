package engine

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureManagedPythonRuntimeReusesVerifiedManagedInterpreter(t *testing.T) {
	installCalls := 0
	findCalls := 0
	path, version, err := ensureManagedPythonRuntimeWithCommands(
		"3.12",
		func() (string, error) {
			findCalls++
			return `D:\shared-payload\environments\python\_python-installations\cpython-3.12\python.exe`, nil
		},
		func(path string) (string, error) {
			if path == "" {
				t.Fatal("verification received an empty interpreter path")
			}
			return "Python 3.12.13\n", nil
		},
		func() error {
			installCalls++
			return nil
		},
		func() (string, error) {
			t.Fatal("reuse unexpectedly requested post-install discovery")
			return "", nil
		},
	)
	if err != nil {
		t.Fatalf("reuse verified managed interpreter: %v", err)
	}
	if path == "" || version != "Python 3.12.13" || findCalls != 1 || installCalls != 0 {
		t.Fatalf("reuse result = (%q, %q, find=%d, install=%d)", path, version, findCalls, installCalls)
	}
}

func TestEnsureManagedPythonRuntimeInstallsOnlyWhenManagedFindIsMissing(t *testing.T) {
	findCalls := 0
	installCalls := 0
	path, version, err := ensureManagedPythonRuntimeWithCommands(
		"3.12",
		func() (string, error) {
			findCalls++
			return "", errors.New("managed Python missing")
		},
		func(string) (string, error) { return "Python 3.12.13", nil },
		func() error {
			installCalls++
			return nil
		},
		func() (string, error) {
			findCalls++
			return `D:\managed\python.exe`, nil
		},
	)
	if err != nil {
		t.Fatalf("install missing managed interpreter: %v", err)
	}
	if path == "" || version != "Python 3.12.13" || findCalls != 2 || installCalls != 1 {
		t.Fatalf("materialization result = (%q, %q, find=%d, install=%d)", path, version, findCalls, installCalls)
	}
}

func TestEnsureManagedPythonRuntimeDoesNotOverwriteUnverifiableExistingPayload(t *testing.T) {
	installCalls := 0
	_, _, err := ensureManagedPythonRuntimeWithCommands(
		"3.12",
		func() (string, error) { return `D:\managed\python.exe`, nil },
		func(string) (string, error) { return "", errors.New("interpreter rejected") },
		func() error {
			installCalls++
			return nil
		},
		func() (string, error) { return `D:\managed\python.exe`, nil },
	)
	if err == nil || installCalls != 0 {
		t.Fatalf("unverifiable existing payload must fail without install, err=%v install=%d", err, installCalls)
	}
}

func TestEnsureManagedPythonRuntimeDoesNotInstallWhenFinderItselfFails(t *testing.T) {
	installCalls := 0
	_, _, err := ensureManagedPythonRuntimeWithCommands(
		"3.12",
		func() (string, error) { return "", errors.New("uv failed: exit status 0xc0000142") },
		func(string) (string, error) { return "", nil },
		func() error {
			installCalls++
			return nil
		},
		func() (string, error) { return `D:\managed\python.exe`, nil },
	)
	if err == nil || installCalls != 0 {
		t.Fatalf("finder execution failure must not be rewritten as missing, err=%v install=%d", err, installCalls)
	}
}

func TestDiscoverManagedPythonRuntimeRequiresCanonicalPayloadFiles(t *testing.T) {
	root := filepath.Join(t.TempDir(), "environments", "python", ManagedPythonVersion)
	candidate := filepath.Join(managedPythonInstallationDir(root), "cpython-3.12.13-windows-x86_64-none")
	if err := os.MkdirAll(candidate, 0o755); err != nil {
		t.Fatal(err)
	}
	required := []string{managedPythonInterpreterPath(candidate)}
	if currentGOOS() == "windows" {
		required = append(required, filepath.Join(candidate, "python3.dll"), filepath.Join(candidate, "python312.dll"))
	}
	for _, file := range required {
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte("verified fixture"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	path, found, err := discoverManagedPythonRuntime(root, "3.12")
	if err != nil || !found || path != required[0] {
		t.Fatalf("discover managed python = (%q, %v, %v), want %q", path, found, err, required[0])
	}
	if err := os.Remove(required[len(required)-1]); err != nil {
		t.Fatal(err)
	}
	if _, _, err := discoverManagedPythonRuntime(root, "3.12"); err == nil {
		t.Fatal("incomplete managed python payload must not be admitted")
	}
}

func TestDiscoverManagedPythonRuntimeSelectsExactPatchVersion(t *testing.T) {
	root := filepath.Join(t.TempDir(), "environments", "python", ManagedPythonVersion)
	wanted := filepath.Join(managedPythonInstallationDir(root), "cpython-3.12.13-windows-x86_64-none")
	newer := filepath.Join(managedPythonInstallationDir(root), "cpython-3.12.14-windows-x86_64-none")
	for _, candidate := range []string{wanted, newer} {
		required := []string{managedPythonInterpreterPath(candidate)}
		if currentGOOS() == "windows" {
			required = append(required, filepath.Join(candidate, "python3.dll"), filepath.Join(candidate, "python312.dll"))
		}
		for _, file := range required {
			if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(file, []byte("verified fixture"), 0o755); err != nil {
				t.Fatal(err)
			}
		}
	}

	path, found, err := discoverManagedPythonRuntime(root, ManagedPythonVersion)
	if err != nil || !found || path != managedPythonInterpreterPath(wanted) {
		t.Fatalf("discover exact managed Python = (%q, %v, %v), want %q", path, found, err, managedPythonInterpreterPath(wanted))
	}
}

func TestManagedPythonRuntimeEnvKeepsUVCacheBesideManagedVenv(t *testing.T) {
	root := filepath.Join(`D:\DataNimi`, "environments", "python", ManagedPythonVersion)
	env := managedPythonRuntimeEnv(root)
	want := filepath.Join(`D:\DataNimi`, "environments", "python", "_uv-cache")
	if env["UV_CACHE_DIR"] != want {
		t.Fatalf("UV_CACHE_DIR = %q, want %q", env["UV_CACHE_DIR"], want)
	}
	if strings.Contains(strings.ToLower(env["UV_CACHE_DIR"]), "systemprofile") {
		t.Fatalf("UV cache escaped to system profile: %q", env["UV_CACHE_DIR"])
	}
	wantTemp := filepath.Join(`D:\DataNimi`, "environments", "python", "_tmp")
	for _, key := range []string{"TMP", "TEMP", "TMPDIR"} {
		if env[key] != wantTemp {
			t.Fatalf("%s = %q, want %q", key, env[key], wantTemp)
		}
	}
}

func TestPrepareManagedCommandEnvironmentCreatesOneAbsoluteTempRoot(t *testing.T) {
	root := filepath.Join(t.TempDir(), "environments", "python", ManagedPythonVersion)
	env := managedPythonRuntimeEnv(root)
	if err := prepareManagedCommandEnvironment(env); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(env["TEMP"]); err != nil || !info.IsDir() {
		t.Fatalf("managed temp root was not created: info=%v err=%v", info, err)
	}
	if err := prepareManagedCommandEnvironment(map[string]string{
		"TMP":  "relative-temp",
		"TEMP": "relative-temp",
	}); err == nil {
		t.Fatal("relative managed temp root must fail closed")
	}
	if err := prepareManagedCommandEnvironment(map[string]string{
		"TMP":  filepath.Join(t.TempDir(), "one"),
		"TEMP": filepath.Join(t.TempDir(), "two"),
	}); err == nil {
		t.Fatal("divergent managed temp roots must fail closed")
	}
}

func TestManagedPythonRuntimeEnvSetsWindowsSystemTempForLocalSystem(t *testing.T) {
	if currentGOOS() != "windows" {
		t.Skip("SystemTemp is the Windows SYSTEM-process GetTempPath2 override")
	}
	root := filepath.Join(t.TempDir(), "environments", "python", ManagedPythonVersion)
	env := managedPythonRuntimeEnv(root)
	want := managedPythonTempDir(root)
	if env["SystemTemp"] != want {
		t.Fatalf("SystemTemp = %q, want %q", env["SystemTemp"], want)
	}

	env["SystemTemp"] = filepath.Join(t.TempDir(), "divergent-system-temp")
	if err := prepareManagedCommandEnvironment(env); err == nil {
		t.Fatal("divergent Windows SystemTemp must fail closed")
	}
}

func TestRunCommandOutputUsesRuntimeOwnedManagedTemp(t *testing.T) {
	const helperEnv = "NIMI_TEST_MANAGED_COMMAND_TEMP_CHILD"
	if os.Getenv(helperEnv) == "1" {
		_, _ = fmt.Fprint(os.Stdout, os.TempDir())
		os.Exit(0)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), "environments", "python", ManagedPythonVersion)
	env := managedPythonRuntimeEnv(root)
	env[helperEnv] = "1"
	output, err := runCommandOutput(
		context.Background(),
		"",
		env,
		executable,
		"-test.run=^TestRunCommandOutputUsesRuntimeOwnedManagedTemp$",
	)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Clean(managedCommandEnvironmentValue(env["TEMP"]))
	if filepath.Clean(output) != want {
		t.Fatalf("child temp root = %q, want %q", output, want)
	}
}

func TestRunCommandOutputRemovesAmbientPythonEnvironmentAndPreservesManagedOverrides(t *testing.T) {
	const helperEnv = "NIMI_TEST_MANAGED_COMMAND_ENV_CHILD"
	const preservedEnv = "NIMI_TEST_MANAGED_COMMAND_PRESERVED"
	if os.Getenv(helperEnv) == "1" {
		pythonPath, pythonPathSet := os.LookupEnv("PYTHONPATH")
		pythonHome, pythonHomeSet := os.LookupEnv("PYTHONHOME")
		_, _ = fmt.Fprintf(
			os.Stdout,
			"python_path=%t:%s;python_home=%t:%s;preserved=%s",
			pythonPathSet,
			pythonPath,
			pythonHomeSet,
			pythonHome,
			os.Getenv(preservedEnv),
		)
		os.Exit(0)
	}

	t.Setenv("PYTHONPATH", filepath.Join(t.TempDir(), "ambient-modules"))
	t.Setenv("PYTHONHOME", filepath.Join(t.TempDir(), "ambient-home"))
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), "environments", "python", ManagedPythonVersion)
	env := managedPythonRuntimeEnv(root)
	env[helperEnv] = "1"
	env[preservedEnv] = "kept"
	output, err := runCommandOutput(
		context.Background(),
		"",
		env,
		executable,
		"-test.run=^TestRunCommandOutputRemovesAmbientPythonEnvironmentAndPreservesManagedOverrides$",
	)
	if err != nil {
		t.Fatal(err)
	}
	if want := "python_path=false:;python_home=false:;preserved=kept"; output != want {
		t.Fatalf("managed child environment = %q, want %q", output, want)
	}
}
