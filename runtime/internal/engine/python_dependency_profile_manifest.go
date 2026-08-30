package engine

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const PythonDependencyProfileManifestFileName = "profile.manifest.json"

type PythonDependencyProfileManifest struct {
	SchemaVersion      int                             `json:"schema_version"`
	ValidationConsumer string                          `json:"validation_consumer"`
	Identity           PythonDependencyProfileIdentity `json:"identity"`
}

func writePythonDependencyProfileManifest(profileRoot string, consumer string, identity PythonDependencyProfileIdentity) error {
	manifest := PythonDependencyProfileManifest{SchemaVersion: 1, ValidationConsumer: strings.TrimSpace(consumer), Identity: identity}
	// The manifest is first written beneath a randomly suffixed staging root.
	// Validate canonical identity now; owner-directory equality is checked only
	// after atomic promotion when the final root name is the profile digest.
	if err := validatePythonDependencyProfileManifestIdentity(manifest); err != nil {
		return err
	}
	payload, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(profileRoot, PythonDependencyProfileManifestFileName), payload, 0o444)
}

func ReadPythonDependencyProfileManifest(profileRoot string) (PythonDependencyProfileManifest, error) {
	path := filepath.Join(filepath.Clean(strings.TrimSpace(profileRoot)), PythonDependencyProfileManifestFileName)
	payload, err := os.ReadFile(path)
	if err != nil {
		return PythonDependencyProfileManifest{}, err
	}
	if len(payload) == 0 || len(payload) > 64*1024 {
		return PythonDependencyProfileManifest{}, errors.New("python dependency profile manifest is invalid")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var manifest PythonDependencyProfileManifest
	if err := decoder.Decode(&manifest); err != nil {
		return PythonDependencyProfileManifest{}, fmt.Errorf("decode python dependency profile manifest: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return PythonDependencyProfileManifest{}, errors.New("python dependency profile manifest has trailing JSON")
	}
	if err := validatePythonDependencyProfileManifest(profileRoot, manifest); err != nil {
		return PythonDependencyProfileManifest{}, err
	}
	return manifest, nil
}

func validatePythonDependencyProfileManifest(profileRoot string, manifest PythonDependencyProfileManifest) error {
	if err := validatePythonDependencyProfileManifestIdentity(manifest); err != nil {
		return err
	}
	if filepath.Base(filepath.Clean(profileRoot)) != manifest.Identity.ProfileDigest {
		return errors.New("python dependency profile manifest does not match its owner directory")
	}
	return nil
}

func validatePythonDependencyProfileManifestIdentity(manifest PythonDependencyProfileManifest) error {
	if manifest.SchemaVersion != 1 || strings.TrimSpace(manifest.ValidationConsumer) == "" || strings.TrimSpace(manifest.Identity.ProfileDigest) == "" {
		return errors.New("python dependency profile manifest identity is incomplete")
	}
	expected, err := ResolvePythonDependencyProfileIdentity(manifest.ValidationConsumer, manifest.Identity.PlatformTuple, manifest.Identity.AcceleratorPlane)
	if err != nil || expected != manifest.Identity {
		return errors.New("python dependency profile manifest does not match canonical owner inputs")
	}
	return nil
}
