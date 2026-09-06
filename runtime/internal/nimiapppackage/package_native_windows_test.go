//go:build windows

package nimiapppackage

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/nimiappnative"
	"golang.org/x/sys/windows"
)

func TestProbeAndMaterializeUseSameRealWindowsRuntimeEntry(t *testing.T) {
	executable := compileProbeTestPE(t)
	executableBytes, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	entries := validArchiveEntries(t)
	entries[3].bytes = executableBytes
	archivePath, expected := writeArchiveFixture(t, entries)
	verifier, err := nimiappnative.NewWindowsVerifier(nimiappnative.WindowsExpectation{
		Arch: "x86_64", ExecutionProfileRef: nimiappnative.WindowsExecutionProfileRef,
		WindowsCodeSigning: "unsigned",
	})
	if err != nil {
		t.Fatal(err)
	}
	ownerRoot, ownerPath := openOwnerRoot(t)
	probe, err := ProbeRuntimeEntry(context.Background(), archivePath, ownerRoot, "native-probe", expected, verifier)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(ownerPath, "native-probe")); !os.IsNotExist(err) {
		t.Fatalf("native probe remained after observation: %v", err)
	}
	materialized, err := Materialize(context.Background(), archivePath, ownerRoot, "stage", expected)
	if err != nil {
		t.Fatal(err)
	}
	if probe.HostExecutableSHA256 != materialized.HostExecutableSHA256 {
		t.Fatal("native-observed Runtime entry differs from materialized Runtime entry")
	}
}

func compileProbeTestPE(t *testing.T) string {
	t.Helper()
	windowsDirectory, err := windows.GetSystemWindowsDirectory()
	if err != nil {
		t.Fatal(err)
	}
	compilers := []string{
		filepath.Join(windowsDirectory, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
		filepath.Join(windowsDirectory, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
	}
	compiler := ""
	for _, candidate := range compilers {
		if _, err := os.Stat(candidate); err == nil {
			compiler = candidate
			break
		}
	}
	if compiler == "" {
		t.Fatal("a real Windows C# compiler is required")
	}
	root := t.TempDir()
	executable := filepath.Join(root, "example-app.exe")
	source := filepath.Join(root, "Program.cs")
	manifest := filepath.Join(root, "app.manifest")
	if err := os.WriteFile(source, []byte("internal static class Program { [System.STAThread] private static void Main() {} }\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifest, []byte(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security><requestedPrivileges>
      <requestedExecutionLevel level="asInvoker" uiAccess="false" />
    </requestedPrivileges></security>
  </trustInfo>
</assembly>
`), 0o600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(compiler,
		"/nologo", "/target:winexe", "/platform:x64", "/out:"+executable, "/win32manifest:"+manifest, source,
	)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("compile real probe PE: %v\n%s", err, output)
	}
	return executable
}
