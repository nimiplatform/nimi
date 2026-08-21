package engine

import (
	"archive/zip"
	"os"
	"path/filepath"
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
