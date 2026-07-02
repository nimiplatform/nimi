package nimi_test

import (
	"bytes"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkspaceGoModules(t *testing.T) {
	for _, moduleDir := range []string{"nimi-cognition", "runtime"} {
		moduleDir := moduleDir
		t.Run(moduleDir, func(t *testing.T) {
			markModuleGoInputs(t, moduleDir)

			cmd := exec.Command("go", "test", "-count=1", "./...")
			cmd.Dir = moduleDir
			var output bytes.Buffer
			cmd.Stdout = &output
			cmd.Stderr = &output
			if err := cmd.Run(); err != nil {
				t.Fatalf("go test ./... in %s failed: %v\n%s", moduleDir, err, output.String())
			}
		})
	}
}

func markModuleGoInputs(t *testing.T, moduleDir string) {
	t.Helper()

	var bytesRead int
	err := filepath.WalkDir(moduleDir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			switch entry.Name() {
			case ".git", ".cache", "node_modules":
				return filepath.SkipDir
			default:
				return nil
			}
		}
		if !isGoModuleInput(path) {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		bytesRead += len(data)
		return nil
	})
	if err != nil {
		t.Fatalf("failed to mark Go module inputs for %s: %v", moduleDir, err)
	}
	if bytesRead == 0 {
		t.Fatalf("no Go module inputs found under %s", moduleDir)
	}
}

func isGoModuleInput(path string) bool {
	name := filepath.Base(path)
	return name == "go.mod" || name == "go.sum" || strings.HasSuffix(name, ".go")
}
