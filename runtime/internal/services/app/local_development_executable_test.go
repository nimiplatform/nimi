package app

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func TestLocalDevelopmentFailureStageIsStructuredAndNonSensitive(t *testing.T) {
	err := localDevelopmentFailureAtStage(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_DEVELOPMENT_PROJECT_CHANGED, "host-executable")
	metadata, ok := grpcerr.ExtractReasonMetadata(err)
	if !ok || metadata["diagnostic_stage"] != "host-executable" {
		t.Fatalf("diagnostic stage metadata = %#v, %v", metadata, ok)
	}
	if len(metadata) != 2 || metadata["action_hint"] == "" {
		t.Fatalf("diagnostic metadata must contain only stage and standard action hint: %#v", metadata)
	}
}

func TestLocalDevelopmentBindDiagnosticStageDoesNotExposeCause(t *testing.T) {
	stage := localDevelopmentBindDiagnosticStage(errors.New(`private path C:\\secret token=opaque`))
	if stage != "bind-witness" {
		t.Fatalf("bind diagnostic stage = %q", stage)
	}
}

func createLocalDevelopmentDirectoryLink(t *testing.T, target string, link string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		output, err := exec.Command("cmd.exe", "/d", "/c", "mklink", "/J", link, target).CombinedOutput()
		if err != nil {
			t.Fatalf("create directory junction: %v: %s", err, output)
		}
		return
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatalf("create directory symlink: %v", err)
	}
}

func TestLocalDevelopmentHostExecutableAllowsOnlyExactElectronAliasTarget(t *testing.T) {
	root := filepath.Join(t.TempDir(), "project")
	electronTarget := filepath.Join(t.TempDir(), "pnpm-store", "electron.exe")
	rogueTarget := filepath.Join(t.TempDir(), "rogue", "electron.exe")

	selected, err := validateCanonicalLocalDevelopmentHostExecutable(
		root,
		electronTarget,
		electronTarget,
		runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
	)
	if err != nil || selected != electronTarget {
		t.Fatalf("exact Electron project alias target must be admitted, got %q, %v", selected, err)
	}
	if _, err := validateCanonicalLocalDevelopmentHostExecutable(
		root,
		rogueTarget,
		electronTarget,
		runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
	); !errors.Is(err, errLocalDevelopmentProjectChanged) {
		t.Fatalf("unrelated external executable must remain rejected, got %v", err)
	}
}

func TestLocalDevelopmentHostExecutableAcceptsSameElectronFileIdentity(t *testing.T) {
	root := filepath.Join(t.TempDir(), "project")
	aliasExecutable := filepath.Join(t.TempDir(), "alias", "electron.exe")
	candidateExecutable := filepath.Join(t.TempDir(), "canonical", "electron.exe")
	for _, directory := range []string{filepath.Dir(aliasExecutable), filepath.Dir(candidateExecutable)} {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(aliasExecutable, []byte("electron fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(aliasExecutable, candidateExecutable); err != nil {
		t.Fatalf("create Electron hard-link identity fixture: %v", err)
	}

	selected, err := validateCanonicalLocalDevelopmentHostExecutable(
		root,
		candidateExecutable,
		aliasExecutable,
		runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
	)
	if err != nil || selected != candidateExecutable {
		t.Fatalf("the exact file object selected through the project Electron alias must be admitted, got %q, %v", selected, err)
	}
}

func TestLocalDevelopmentHostExecutableKeepsTauriInsideProjectOutput(t *testing.T) {
	root := filepath.Join(t.TempDir(), "project")
	projectTarget := filepath.Join(root, "src-tauri", "target", "debug", "sample.exe")
	externalTarget := filepath.Join(t.TempDir(), "outside", "sample.exe")

	selected, err := validateCanonicalLocalDevelopmentHostExecutable(
		root,
		projectTarget,
		"",
		runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_TAURI,
	)
	if err != nil || selected != projectTarget {
		t.Fatalf("Tauri project build output must be admitted, got %q, %v", selected, err)
	}
	if _, err := validateCanonicalLocalDevelopmentHostExecutable(
		root,
		externalTarget,
		"",
		runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_TAURI,
	); !errors.Is(err, errLocalDevelopmentProjectChanged) {
		t.Fatalf("external Tauri executable must remain rejected, got %v", err)
	}
}

func TestCanonicalLocalDevelopmentHostExecutableAllowsProjectElectronAliasIntoPackageStore(t *testing.T) {
	root := filepath.Join(t.TempDir(), "project")
	aliasParent := filepath.Join(root, "node_modules")
	storePackage := filepath.Join(t.TempDir(), "pnpm-store", "electron")
	storeExecutable := filepath.Join(storePackage, "dist", "electron.exe")
	if err := os.MkdirAll(aliasParent, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(storeExecutable), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(storeExecutable, []byte("electron fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	createLocalDevelopmentDirectoryLink(t, storePackage, filepath.Join(aliasParent, "electron"))
	aliasExecutable := filepath.Join(aliasParent, "electron", "dist", "electron.exe")
	if _, err := os.Stat(aliasExecutable); err != nil {
		t.Fatalf("stat Electron project alias: %v", err)
	}

	selected, err := canonicalLocalDevelopmentHostExecutable(
		root,
		aliasExecutable,
		runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
	)
	if err != nil {
		t.Fatalf("canonical Electron project alias target must be admitted: %v", err)
	}
	want, err := canonicalLocalDevelopmentFilePath(storeExecutable)
	if err != nil {
		t.Fatal(err)
	}
	if !sameLocalDevelopmentPath(selected, want) {
		t.Fatalf("selected = %q, want exact package-store target %q", selected, want)
	}
}

func TestCanonicalLocalDevelopmentHostExecutableAcceptsWindowsNamespaceProjectRoot(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows canonical path namespace")
	}
	root := filepath.Join(t.TempDir(), "project")
	aliasParent := filepath.Join(root, "node_modules")
	storePackage := filepath.Join(t.TempDir(), "pnpm-store", "electron")
	storeExecutable := filepath.Join(storePackage, "dist", "electron.exe")
	if err := os.MkdirAll(aliasParent, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(storeExecutable), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(storeExecutable, []byte("electron fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	createLocalDevelopmentDirectoryLink(t, storePackage, filepath.Join(aliasParent, "electron"))

	namespacedRoot := `\\?\` + root
	namespacedAlias := `\\?\` + filepath.Join(aliasParent, "electron", "dist", "electron.exe")
	selected, err := canonicalLocalDevelopmentHostExecutable(
		namespacedRoot,
		namespacedAlias,
		runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
	)
	if err != nil {
		t.Fatalf("Windows namespace paths emitted by Desktop must be admitted: %v", err)
	}
	want, err := canonicalLocalDevelopmentFilePath(storeExecutable)
	if err != nil {
		t.Fatal(err)
	}
	if !sameLocalDevelopmentPath(selected, want) {
		t.Fatalf("selected = %q, want exact package-store target %q", selected, want)
	}
}

func TestLocalDevelopmentLaunchStoreRevalidatesExactElectronAliasTarget(t *testing.T) {
	root := filepath.Join(t.TempDir(), "project")
	aliasParent := filepath.Join(root, "node_modules")
	storePackage := filepath.Join(t.TempDir(), "pnpm-store", "electron")
	storeExecutable := filepath.Join(storePackage, "dist", "electron.exe")
	rogueExecutable := filepath.Join(t.TempDir(), "rogue", "electron.exe")
	for _, directory := range []string{aliasParent, filepath.Dir(storeExecutable), filepath.Dir(rogueExecutable)} {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, executable := range []string{storeExecutable, rogueExecutable} {
		if err := os.WriteFile(executable, []byte("electron fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	createLocalDevelopmentDirectoryLink(t, storePackage, filepath.Join(aliasParent, "electron"))
	canonicalStoreExecutable, err := canonicalLocalDevelopmentFilePath(storeExecutable)
	if err != nil {
		t.Fatal(err)
	}
	canonicalRogueExecutable, err := canonicalLocalDevelopmentFilePath(rogueExecutable)
	if err != nil {
		t.Fatal(err)
	}

	if !validLocalDevelopmentHostPath(
		root,
		canonicalStoreExecutable,
		runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
	) {
		t.Fatal("launch store must admit the exact canonical target of the project Electron alias")
	}
	if validLocalDevelopmentHostPath(
		root,
		canonicalRogueExecutable,
		runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
	) {
		t.Fatal("launch store must reject an unrelated external Electron executable")
	}
}
