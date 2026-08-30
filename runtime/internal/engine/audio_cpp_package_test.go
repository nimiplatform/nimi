package engine

import (
	"archive/zip"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestExtractAudioCppAdmittedPackageFilesSkipsNonProductEntries(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "audio-cpp.zip")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entries := append(append([]string(nil), audioCppPackageAdmittedFiles...),
		"audiocpp_server.exe", "tools/model_manager_v2.py", "model_specs/minimax_music3.json", "assets/model_manager/vocab.json")
	for _, name := range entries {
		entry, createErr := writer.Create(name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, writeErr := entry.Write([]byte("fixture:" + name)); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	destination := t.TempDir()
	if err := extractAudioCppAdmittedPackageFiles(archivePath, destination); err != nil {
		t.Fatal(err)
	}
	for _, name := range audioCppPackageAdmittedFiles {
		if _, err := os.Stat(filepath.Join(destination, name)); err != nil {
			t.Fatalf("admitted artifact %s: %v", name, err)
		}
	}
	for _, name := range []string{"audiocpp_server.exe", "tools", "model_specs", "assets"} {
		if _, err := os.Stat(filepath.Join(destination, name)); !os.IsNotExist(err) {
			t.Fatalf("rejected package entry %s was materialized: %v", name, err)
		}
	}
}

func TestAudioCppRegistryEvidenceRejectsCorruptedRuntimeDLL(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("audio.cpp package is admitted only on windows/amd64")
	}
	root := t.TempDir()
	for _, name := range audioCppPackageAdmittedFiles {
		if err := os.WriteFile(filepath.Join(root, name), []byte("fixture:"+name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	fileDigests, err := audioCppPackageFileSHA256(root)
	if err != nil {
		t.Fatal(err)
	}
	entry := &RegistryEntry{
		Engine: EngineAudioCPP, Version: AudioCppPackageVersion,
		BinaryPath: filepath.Join(root, AudioCppCLIExecutableName),
		SHA256:     AudioCppPackageArchiveSHA256, BinarySHA256: fileDigests[AudioCppCLIExecutableName],
		AudioCppFileSHA256: fileDigests, Platform: "windows/amd64", AssetName: AudioCppPackageAssetName,
		AcceleratorPlane: "cuda13",
	}
	manager := &Manager{}
	if _, err := manager.audioCppStatusFromRegistryEntry(entry); err != nil {
		t.Fatalf("valid owner file evidence = %v", err)
	}
	manager.registry = &Registry{
		root: filepath.Dir(root), entries: map[string]*RegistryEntry{
			registryKey(EngineAudioCPP, AudioCppPackageVersion): cloneRegistryEntry(entry),
		},
		pendingRebases: make(map[string]struct{}), conflictEntries: make(map[string][]*RegistryEntry),
	}
	adapter := NewServiceAdapter(manager)
	if err := adapter.VerifyEngineBinaryDependency("audio-cpp", AudioCppPackageVersion, entry.BinaryPath); err != nil {
		t.Fatalf("exact selected-source path verification = %v", err)
	}
	if err := adapter.VerifyEngineBinaryDependency("audio-cpp", AudioCppPackageVersion, filepath.Join(t.TempDir(), AudioCppCLIExecutableName)); err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("different selected-source path passed owner verification: %v", err)
	}
	corrupted := "MSVCP140.dll"
	if err := os.WriteFile(filepath.Join(root, corrupted), []byte("corrupted runtime bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.audioCppStatusFromRegistryEntry(entry); err == nil || !strings.Contains(err.Error(), corrupted+" SHA-256 evidence mismatch") {
		t.Fatalf("corrupted runtime DLL evidence = %v", err)
	}
}
