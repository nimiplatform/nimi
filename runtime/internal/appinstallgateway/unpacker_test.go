package appinstallgateway

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
)

func tarGzArchive(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, content := range files {
		if err := tw.WriteHeader(&tar.Header{
			Name:     name,
			Typeflag: tar.TypeReg,
			Mode:     0o644,
			Size:     int64(len(content)),
		}); err != nil {
			t.Fatalf("write tar header: %v", err)
		}
		if _, err := tw.Write([]byte(content)); err != nil {
			t.Fatalf("write tar body: %v", err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("close tar: %v", err)
	}
	if err := gz.Close(); err != nil {
		t.Fatalf("close gzip: %v", err)
	}
	return buf.Bytes()
}

func zipArchive(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create zip entry: %v", err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatalf("write zip body: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

func unpackPlan(t *testing.T) appstorage.Plan {
	t.Helper()
	plan, err := appstorage.Resolve(t.TempDir(), "nimi.parentos", "1.0.0", "nimi-data-app-roots")
	if err != nil {
		t.Fatalf("resolve plan: %v", err)
	}
	if err := appstorage.Materialize(plan); err != nil {
		t.Fatalf("materialize plan: %v", err)
	}
	return plan
}

func TestArchiveUnpackerUnpacksTarGz(t *testing.T) {
	plan := unpackPlan(t)
	payload := tarGzArchive(t, map[string]string{
		"manifest.json": `{"name":"parentos"}`,
		"bin/run.js":    "console.log('parentos')",
	})
	unpacker := NewArchiveUnpacker()
	if err := unpacker.Unpack(context.Background(), VerifiedArtifact{Payload: payload}, plan); err != nil {
		t.Fatalf("Unpack tar.gz: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(plan.ReleaseRoot, "bin", "run.js"))
	if err != nil {
		t.Fatalf("read unpacked file: %v", err)
	}
	if string(got) != "console.log('parentos')" {
		t.Fatalf("unpacked content = %q", got)
	}
}

func TestArchiveUnpackerUnpacksZip(t *testing.T) {
	plan := unpackPlan(t)
	payload := zipArchive(t, map[string]string{
		"manifest.json": `{"name":"parentos"}`,
	})
	unpacker := NewArchiveUnpacker()
	if err := unpacker.Unpack(context.Background(), VerifiedArtifact{Payload: payload}, plan); err != nil {
		t.Fatalf("Unpack zip: %v", err)
	}
	if _, err := os.Stat(filepath.Join(plan.ReleaseRoot, "manifest.json")); err != nil {
		t.Fatalf("expected unpacked manifest: %v", err)
	}
}

func TestArchiveUnpackerRejectsUnsupportedFormat(t *testing.T) {
	plan := unpackPlan(t)
	unpacker := NewArchiveUnpacker()
	err := unpacker.Unpack(context.Background(), VerifiedArtifact{Payload: []byte("not an archive")}, plan)
	if !errors.Is(err, ErrUnsupportedArchiveFormat) {
		t.Fatalf("error = %v, want ErrUnsupportedArchiveFormat", err)
	}
}

func TestArchiveUnpackerRejectsPathTraversal(t *testing.T) {
	plan := unpackPlan(t)
	payload := tarGzArchive(t, map[string]string{
		"../../escape.txt": "escaped",
	})
	unpacker := NewArchiveUnpacker()
	err := unpacker.Unpack(context.Background(), VerifiedArtifact{Payload: payload}, plan)
	if !errors.Is(err, ErrArchiveEntryEscapesRoot) {
		t.Fatalf("error = %v, want ErrArchiveEntryEscapesRoot", err)
	}
}

func TestArchiveUnpackerRejectsSymlinkEntry(t *testing.T) {
	plan := unpackPlan(t)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	if err := tw.WriteHeader(&tar.Header{
		Name:     "link",
		Typeflag: tar.TypeSymlink,
		Linkname: "/etc/passwd",
		Mode:     0o777,
	}); err != nil {
		t.Fatalf("write symlink header: %v", err)
	}
	_ = tw.Close()
	_ = gz.Close()
	unpacker := NewArchiveUnpacker()
	err := unpacker.Unpack(context.Background(), VerifiedArtifact{Payload: buf.Bytes()}, plan)
	if !errors.Is(err, ErrArchiveEntrySymlink) {
		t.Fatalf("error = %v, want ErrArchiveEntrySymlink", err)
	}
}

func TestArchiveUnpackerRejectsOversizeEntry(t *testing.T) {
	plan := unpackPlan(t)
	payload := tarGzArchive(t, map[string]string{"big.bin": "0123456789"})
	unpacker := NewArchiveUnpacker(WithMaxEntryBytes(4))
	err := unpacker.Unpack(context.Background(), VerifiedArtifact{Payload: payload}, plan)
	if !errors.Is(err, ErrArchiveEntryTooLarge) {
		t.Fatalf("error = %v, want ErrArchiveEntryTooLarge", err)
	}
}
