//go:build windows

package engine

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const managedPythonBuildSiteDirectory = "_python-build-site"

//go:embed managed_python_build_sitecustomize.py
var managedPythonBuildSitecustomize []byte

// managedPythonBuildEnvironment confines the Windows CPython ACL adaptation to
// uv's PEP 517 build subprocesses. Python 3.12.4+ gives mode-0700 directories a
// protected DACL on Windows; that discards the Runtime service SID inherited
// from the selected managed root. The embedded sitecustomize changes only
// mode-0700 mkdir calls beneath uv's disposable builds-v0 workspace so those
// directories inherit the already-admitted parent DACL.
func managedPythonBuildEnvironment(venvRoot string) (map[string]string, error) {
	env := managedPythonRuntimeEnv(venvRoot)
	siteRoot, err := materializeManagedPythonBuildSite(venvRoot)
	if err != nil {
		return nil, err
	}
	env["PYTHONPATH"] = siteRoot
	return env, nil
}

func materializeManagedPythonBuildSite(venvRoot string) (string, error) {
	trimmedVenvRoot := strings.TrimSpace(venvRoot)
	if trimmedVenvRoot == "" {
		return "", fmt.Errorf("managed Python build site requires a managed venv root")
	}
	cleanVenvRoot := filepath.Clean(trimmedVenvRoot)
	if !filepath.IsAbs(cleanVenvRoot) {
		return "", fmt.Errorf("managed Python build site root must be absolute: %s", cleanVenvRoot)
	}

	digest := sha256.Sum256(managedPythonBuildSitecustomize)
	siteRoot := filepath.Join(
		filepath.Dir(cleanVenvRoot),
		managedPythonBuildSiteDirectory,
		fmt.Sprintf("%x", digest),
	)
	if err := os.MkdirAll(siteRoot, 0o755); err != nil {
		return "", fmt.Errorf("create managed Python build site root: %w", err)
	}
	sitecustomizePath := filepath.Join(siteRoot, "sitecustomize.py")
	file, err := os.OpenFile(sitecustomizePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err == nil {
		writeErr := writeManagedPythonBuildSitecustomize(file)
		closeErr := file.Close()
		if writeErr != nil || closeErr != nil {
			_ = os.Remove(sitecustomizePath)
			if writeErr != nil {
				return "", fmt.Errorf("write managed Python build sitecustomize: %w", writeErr)
			}
			return "", fmt.Errorf("close managed Python build sitecustomize: %w", closeErr)
		}
	} else if !errors.Is(err, os.ErrExist) {
		return "", fmt.Errorf("create managed Python build sitecustomize: %w", err)
	}

	observed, err := os.ReadFile(sitecustomizePath)
	if err != nil {
		return "", fmt.Errorf("verify managed Python build sitecustomize: %w", err)
	}
	if !bytes.Equal(observed, managedPythonBuildSitecustomize) {
		return "", fmt.Errorf("managed Python build sitecustomize does not match Runtime payload: %s", sitecustomizePath)
	}
	return siteRoot, nil
}

func writeManagedPythonBuildSitecustomize(file *os.File) error {
	if _, err := file.Write(managedPythonBuildSitecustomize); err != nil {
		return err
	}
	return file.Sync()
}
