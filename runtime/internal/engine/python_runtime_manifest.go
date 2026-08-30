package engine

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const managedPythonRuntimeManifestFileName = "python-runtime.manifest.json"

type managedPythonRuntimeManifest struct {
	SchemaVersion      int    `json:"schema_version"`
	PythonVersion      string `json:"python_version"`
	PythonABI          string `json:"python_abi"`
	Platform           string `json:"platform"`
	InterpreterLocator string `json:"interpreter_locator"`
	InterpreterSHA256  string `json:"interpreter_sha256"`
}

func writeManagedPythonRuntimeManifest(root string, interpreterPath string, version string) error {
	version = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(version), "Python "))
	relative, err := filepath.Rel(root, interpreterPath)
	if err != nil || filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return errors.New("managed Python interpreter escaped owner root")
	}
	digest, err := sha256File(interpreterPath)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(managedPythonRuntimeManifest{
		SchemaVersion: 1, PythonVersion: strings.TrimSpace(version), PythonABI: ManagedPythonABI,
		Platform: currentGOOS() + "/" + currentGOARCH(), InterpreterLocator: filepath.ToSlash(relative),
		InterpreterSHA256: digest,
	})
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(root, managedPythonRuntimeManifestFileName), payload, 0o444)
}

func verifyManagedPythonRuntimeManifest(root string, interpreterPath string) bool {
	payload, err := os.ReadFile(filepath.Join(root, managedPythonRuntimeManifestFileName))
	if err != nil || len(payload) == 0 || len(payload) > 16*1024 {
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var manifest managedPythonRuntimeManifest
	if decoder.Decode(&manifest) != nil {
		return false
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return false
	}
	if manifest.SchemaVersion != 1 || manifest.PythonVersion != ManagedPythonVersion || manifest.PythonABI != ManagedPythonABI || !strings.EqualFold(manifest.Platform, currentGOOS()+"/"+currentGOARCH()) {
		return false
	}
	expected := filepath.Join(root, filepath.FromSlash(manifest.InterpreterLocator))
	if !sameManagedPath(expected, interpreterPath) {
		return false
	}
	digest, err := sha256File(interpreterPath)
	return err == nil && strings.EqualFold(digest, manifest.InterpreterSHA256)
}
