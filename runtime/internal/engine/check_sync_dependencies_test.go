package engine

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeManagedImageBackendCustodyForTest(t *testing.T, root string) {
	t.Helper()
	hashes, err := managedImageBackendPayloadHashes(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeManagedImageBackendMetadata(filepath.Join(root, "metadata.json"), managedImageBackendMetadata{
		Name: filepath.Base(root), Alias: "stablediffusion-ggml", ArchiveSHA256: strings.Repeat("a", 64), PayloadHashes: hashes,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestCheckSyncMediaCodecRequiresHashesAndExecutableProbe(t *testing.T) {
	root := t.TempDir()
	content := []byte("unit-test codec artifact")
	spec := mediaCodecSpec{version: "test", directory: "test", hashes: map[string]string{
		"bin/ffmpeg": fmt.Sprintf("%x", sha256.Sum256(content)), "bin/ffprobe": fmt.Sprintf("%x", sha256.Sum256(content)),
	}}
	packageRoot := filepath.Join(root, "dependencies", "media-codec", spec.directory)
	if err := os.MkdirAll(filepath.Join(packageRoot, "bin"), 0755); err != nil {
		t.Fatal(err)
	}
	for path := range spec.hashes {
		if err := os.WriteFile(filepath.Join(packageRoot, filepath.FromSlash(path)), content, 0755); err != nil {
			t.Fatal(err)
		}
	}
	probes := 0
	probe := func(_ context.Context, ffmpeg, ffprobe string) error {
		probes++
		if ffmpeg != filepath.Join(packageRoot, "bin", "ffmpeg") || ffprobe != filepath.Join(packageRoot, "bin", "ffprobe") {
			t.Fatal("wrong probe paths")
		}
		return nil
	}
	for range 2 {
		row := checkSyncMediaCodec(context.Background(), root, spec, probe)
		if row.MediaCodec == nil || row.Reason != "MEDIA_CODEC_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED" {
			t.Fatalf("healthy material rejected: %+v", row)
		}
	}
	failed := checkSyncMediaCodec(context.Background(), root, spec, func(context.Context, string, string) error { return errors.New("cannot execute") })
	if failed.MediaCodec != nil {
		t.Fatal("failed executable probe promoted")
	}
	if err := os.WriteFile(filepath.Join(packageRoot, "bin", "ffprobe"), []byte("changed"), 0755); err != nil {
		t.Fatal(err)
	}
	failed = checkSyncMediaCodec(context.Background(), root, spec, probe)
	if failed.MediaCodec != nil || probes != 2 {
		t.Fatal("changed artifact promoted or executed")
	}
}

func TestCheckSyncManagedImagePackageRetainsVerifiedArchiveCustody(t *testing.T) {
	var buffer bytes.Buffer
	w := zip.NewWriter(&buffer)
	for name, value := range map[string]string{"bin/sd.exe": "unit-test executable", "bin/ggml.dll": "unit-test library"} {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	archive := buffer.Bytes()
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests++; _, _ = w.Write(archive) }))
	defer server.Close()
	spec := managedImageBackendPackageSpec{BackendName: "stablediffusion-ggml", InstallDirName: "test-sd", ReleaseTag: "test-release",
		PackageFormat: managedImageBackendPackageFormatDirectArchive, LaunchMode: managedImageBackendLaunchModeRuntimeWrapper,
		ArchiveURL: server.URL + "/sd.zip", ArchiveSHA256: fmt.Sprintf("%x", sha256.Sum256(archive)), ExecutableCandidates: []string{"sd.exe"}}
	formerRoot := t.TempDir()
	backends := filepath.Join(formerRoot, "environments", "managed-image-backends")
	if err := os.MkdirAll(backends, 0755); err != nil {
		t.Fatal(err)
	}
	wrong := spec
	wrong.ArchiveSHA256 = strings.Repeat("b", 64)
	if err := installManagedImageBackendFromDirectArchive(context.Background(), backends, spec.BackendName, wrong, nil); err == nil {
		t.Fatal("unpinned archive installed")
	}
	if _, err := os.Stat(filepath.Join(backends, spec.InstallDirName)); !os.IsNotExist(err) {
		t.Fatal("rejected archive left promoted material")
	}
	if err := installManagedImageBackendFromDirectArchive(context.Background(), backends, spec.BackendName, spec, nil); err != nil {
		t.Fatal(err)
	}
	currentRoot := filepath.Join(t.TempDir(), "copied")
	if err := os.CopyFS(currentRoot, os.DirFS(formerRoot)); err != nil {
		t.Fatal(err)
	}
	currentPackage := filepath.Join(currentRoot, "environments", "managed-image-backends", spec.InstallDirName)
	for range 2 {
		row := checkSyncManagedImagePackage(currentRoot, spec)
		if row.ImageBackend == nil || row.ImageBackend.CanonicalRoot != currentPackage {
			t.Fatalf("verified/copied material rejected: %+v", row)
		}
	}
	metadataPath := filepath.Join(currentPackage, "metadata.json")
	metadata, err := os.ReadFile(metadataPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(metadataPath); err != nil {
		t.Fatal(err)
	}
	if checkSyncManagedImagePackage(currentRoot, spec).ImageBackend != nil {
		t.Fatal("missing custody promoted")
	}
	if err := os.WriteFile(metadataPath, metadata, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(currentPackage, "ggml.dll"), []byte("corrupted"), 0644); err != nil {
		t.Fatal(err)
	}
	if checkSyncManagedImagePackage(currentRoot, spec).ImageBackend != nil {
		t.Fatal("changed DLL promoted")
	}
	if requests != 2 {
		t.Fatalf("Check & Sync downloaded: requests=%d", requests)
	}
	// The normal explicit installer replaces corrupt material and regenerates
	// the same existing metadata, but Check & Sync never does so itself.
	if err := installManagedImageBackendFromDirectArchive(context.Background(), filepath.Dir(currentPackage), spec.BackendName, spec, nil); err != nil {
		t.Fatal(err)
	}
	if checkSyncManagedImagePackage(currentRoot, spec).ImageBackend == nil {
		t.Fatal("explicit repair not reusable")
	}
}
