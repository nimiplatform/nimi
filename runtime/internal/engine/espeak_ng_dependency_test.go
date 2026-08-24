package engine

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func TestExtractESpeakNGWheelPromotesOnlyRuntimePayload(t *testing.T) {
	root := t.TempDir()
	wheel := filepath.Join(root, "espeak.whl")
	file, err := os.Create(wheel)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entries := map[string]string{
		"espeakng_loader/espeak-ng.dll":                 "dll",
		"espeakng_loader/espeak-ng-data/phontab":        "phonemes",
		"espeakng_loader/espeak-ng-data/lang/gmw/en":    "english",
		"espeakng_loader/espeak-ng-data/lang/gmw/en-US": "english-us",
		"espeakng_loader/__init__.py":                   "ignored",
		"espeakng_loader-0.2.4.dist-info/METADATA":      "ignored",
	}
	for name, content := range entries {
		entry, createErr := writer.Create(name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, writeErr := entry.Write([]byte(content)); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(root, "payload")
	if err := extractESpeakNGWheel(wheel, destination); err != nil {
		t.Fatal(err)
	}
	for _, relative := range espeakNGRequiredArtifacts {
		if _, err := os.Stat(filepath.Join(destination, filepath.FromSlash(relative))); err != nil {
			t.Fatalf("missing extracted artifact %s: %v", relative, err)
		}
	}
	if _, err := os.Stat(filepath.Join(destination, "__init__.py")); !os.IsNotExist(err) {
		t.Fatalf("non-runtime wheel payload was extracted")
	}
}
