package engine

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManagedCommandExecutablePathUsesVerbatimFormBeyondLegacyLimit(t *testing.T) {
	short := filepath.Join(`C:\`, "Nimi", "python.exe")
	if got := managedCommandExecutablePath(short); got != short {
		t.Fatalf("short executable path changed: got=%q want=%q", got, short)
	}
	longRoot := `C:\`
	for len(filepath.Join(longRoot, "python.exe")) < windowsLegacyMaxPath+24 {
		longRoot = filepath.Join(longRoot, "managed-command-segment")
	}
	long := filepath.Join(longRoot, "python.exe")
	if len(long) < windowsLegacyMaxPath {
		t.Fatalf("test path length = %d, want at least %d", len(long), windowsLegacyMaxPath)
	}
	verbatim := `\\?\` + long
	if got := managedCommandExecutablePath(long); got != verbatim {
		t.Fatalf("long executable path = %q, want %q", got, verbatim)
	}
	arguments := managedCommandArguments([]string{"--python", long, "https://example.invalid/package"})
	if len(arguments) != 3 || arguments[0] != "--python" || arguments[1] != verbatim || arguments[2] != "https://example.invalid/package" {
		t.Fatalf("managed command arguments = %#v", arguments)
	}
}

func TestRunCommandOutputStartsExecutableBeyondLegacyPathLimit(t *testing.T) {
	windowsDirectory := strings.TrimSpace(os.Getenv("WINDIR"))
	if windowsDirectory == "" {
		t.Skip("WINDIR is unavailable")
	}
	source := filepath.Join(windowsDirectory, "System32", "cmd.exe")
	root := t.TempDir()
	longRoot := root
	for len(filepath.Join(longRoot, "cmd.exe")) < windowsLegacyMaxPath+24 {
		longRoot = filepath.Join(longRoot, "managed-command-segment")
	}
	if err := os.MkdirAll(longRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(longRoot, "cmd.exe")
	payload, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, payload, 0o755); err != nil {
		t.Fatal(err)
	}
	if shortPath, ok := windowsShortCommandPath(target); ok && len(shortPath) < windowsLegacyMaxPath {
		if got := managedCommandExecutablePath(target); got != shortPath {
			t.Fatalf("existing long executable path = %q, want short alias %q", got, shortPath)
		}
	}
	output, err := runCommandOutput(context.Background(), "", nil, target, "/d", "/c", "echo", "nimi-long-path-ready")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(output) != "nimi-long-path-ready" {
		t.Fatalf("long-path command output = %q", output)
	}
}
