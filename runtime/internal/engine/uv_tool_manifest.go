package engine

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const managedUVManifestFileName = "uv.manifest.json"

type managedUVManifest struct {
	SchemaVersion    int    `json:"schema_version"`
	Version          string `json:"version"`
	Platform         string `json:"platform"`
	ArchiveName      string `json:"archive_name"`
	ArchiveSHA256    string `json:"archive_sha256"`
	ExecutableName   string `json:"executable_name"`
	ExecutableSHA256 string `json:"executable_sha256"`
}

func writeManagedUVManifest(root string, spec managedUVArchiveSpec) error {
	executable := managedUVPath(root)
	digest, err := sha256ManagedUVFile(executable)
	if err != nil {
		return err
	}
	manifest := managedUVManifest{
		SchemaVersion: 1, Version: ManagedUVVersion, Platform: currentGOOS() + "/" + currentGOARCH(),
		ArchiveName: spec.ArchiveName, ArchiveSHA256: strings.ToLower(strings.TrimSpace(spec.SHA256)),
		ExecutableName: filepath.Base(executable), ExecutableSHA256: digest,
	}
	payload, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(root, managedUVManifestFileName), payload, 0o444)
}

func verifyManagedUVManifest(root string, spec managedUVArchiveSpec) bool {
	payload, err := os.ReadFile(filepath.Join(root, managedUVManifestFileName))
	if err != nil || len(payload) == 0 || len(payload) > 16*1024 {
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var manifest managedUVManifest
	if decoder.Decode(&manifest) != nil {
		return false
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return false
	}
	if manifest.SchemaVersion != 1 || manifest.Version != ManagedUVVersion || !strings.EqualFold(manifest.Platform, currentGOOS()+"/"+currentGOARCH()) || manifest.ArchiveName != spec.ArchiveName || !strings.EqualFold(manifest.ArchiveSHA256, spec.SHA256) || manifest.ExecutableName != filepath.Base(managedUVPath(root)) {
		return false
	}
	digest, err := sha256ManagedUVFile(managedUVPath(root))
	return err == nil && strings.EqualFold(digest, manifest.ExecutableSHA256)
}

func sha256ManagedUVFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer func() { _ = file.Close() }()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}
