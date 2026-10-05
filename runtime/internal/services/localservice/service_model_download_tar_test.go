package localservice

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTarFixture(t *testing.T, headers []*tar.Header, bodies [][]byte) string {
	t.Helper()
	var b bytes.Buffer
	gz := gzip.NewWriter(&b)
	tw := tar.NewWriter(gz)
	for i, h := range headers {
		if e := tw.WriteHeader(h); e != nil {
			t.Fatal(e)
		}
		if len(bodies[i]) > 0 {
			if _, e := tw.Write(bodies[i]); e != nil {
				t.Fatal(e)
			}
		}
	}
	if e := tw.Close(); e != nil {
		t.Fatal(e)
	}
	if e := gz.Close(); e != nil {
		t.Fatal(e)
	}
	path := filepath.Join(t.TempDir(), "model.tar.gz")
	if e := os.WriteFile(path, b.Bytes(), 0600); e != nil {
		t.Fatal(e)
	}
	return path
}
func TestTarModelArchiveChecksBeforeExtraction(t *testing.T) {
	data := []byte("model data")
	sum := sha256.Sum256(data)
	hashes := map[string]string{"model.meta": "sha256:" + hex.EncodeToString(sum[:])}
	noop := func() error { return nil }
	valid := func(name string) *tar.Header {
		return &tar.Header{Name: name, Mode: 0600, Typeflag: tar.TypeReg, Size: int64(len(data))}
	}
	path := writeTarFixture(t, []*tar.Header{valid("./model.meta")}, [][]byte{data})
	entries, e := indexManagedModelTarArchive(path, ".", []string{"model.meta"}, hashes, int64(len(data)), noop)
	if e != nil {
		t.Fatal(e)
	}
	reader, e := entries["model.meta"].open()
	if e != nil {
		t.Fatal(e)
	}
	actual, e := io.ReadAll(reader)
	_ = reader.Close()
	if e != nil || !bytes.Equal(actual, data) {
		t.Fatal("entry read differs", e)
	}
	tests := map[string]struct {
		h []*tar.Header
		b [][]byte
	}{
		"traversal":      {[]*tar.Header{valid("../model.meta")}, [][]byte{data}},
		"absolute":       {[]*tar.Header{valid("/model.meta")}, [][]byte{data}},
		"windows":        {[]*tar.Header{valid("C:/model.meta")}, [][]byte{data}},
		"trailing dot":   {[]*tar.Header{valid("model.meta.")}, [][]byte{data}},
		"reserved":       {[]*tar.Header{valid("CON")}, [][]byte{data}},
		"duplicate":      {[]*tar.Header{valid("model.meta"), valid("./model.meta")}, [][]byte{data, data}},
		"case collision": {[]*tar.Header{valid("model.meta"), valid("MODEL.META")}, [][]byte{data, data}},
		"symlink":        {[]*tar.Header{{Name: "model.meta", Typeflag: tar.TypeSymlink, Linkname: "other"}}, [][]byte{nil}},
		"hardlink":       {[]*tar.Header{{Name: "model.meta", Typeflag: tar.TypeLink, Linkname: "other"}}, [][]byte{nil}},
		"fifo":           {[]*tar.Header{{Name: "model.meta", Typeflag: tar.TypeFifo}}, [][]byte{nil}},
		"missing":        {[]*tar.Header{valid("other")}, [][]byte{data}},
		"bad content":    {[]*tar.Header{valid("model.meta")}, [][]byte{bytes.Repeat([]byte("x"), len(data))}},
	}
	for name, fixture := range tests {
		t.Run(name, func(t *testing.T) {
			path := writeTarFixture(t, fixture.h, fixture.b)
			if _, e := indexManagedModelTarArchive(path, ".", []string{"model.meta"}, hashes, int64(len(data)), noop); e == nil {
				t.Fatal("unsafe archive admitted")
			}
		})
	}
	t.Run("metadata budget", func(t *testing.T) {
		extra := bytes.Repeat([]byte("x"), int(modelTarMetadataBudget)+1)
		path := writeTarFixture(t, []*tar.Header{valid("model.meta"), {Name: "extra", Typeflag: tar.TypeReg, Size: int64(len(extra))}}, [][]byte{data, extra})
		if _, e := indexManagedModelTarArchive(path, ".", []string{"model.meta"}, hashes, int64(len(data)), noop); e == nil {
			t.Fatal("oversized archive admitted")
		}
	})
	t.Run("corrupt gzip", func(t *testing.T) {
		content, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		content[len(content)-8] ^= 0xff
		bad := filepath.Join(t.TempDir(), "bad.tar.gz")
		_ = os.WriteFile(bad, content, 0600)
		if _, e := indexManagedModelTarArchive(bad, ".", []string{"model.meta"}, hashes, int64(len(data)), noop); e == nil {
			t.Fatal("bad checksum admitted")
		}
	})
	t.Run("cancel", func(t *testing.T) {
		if _, e := indexManagedModelTarArchive(path, ".", []string{"model.meta"}, hashes, int64(len(data)), func() error { return io.ErrClosedPipe }); e == nil {
			t.Fatal("canceled scan succeeded")
		}
	})
}
func TestTarTopLevelRootIsExplicit(t *testing.T) {
	if tarPayloadRelative("model.meta", ".") != "model.meta" || tarPayloadRelative("root/model.meta", "root") != "model.meta" || tarPayloadRelative("outside/model.meta", "root") != "" {
		t.Fatal("root interpretation differs")
	}
	h := &tar.Header{Name: "./._checkpoint", Typeflag: tar.TypeReg}
	name, e := modelTarName(h)
	if e != nil || !strings.HasPrefix(name, "._") {
		t.Fatal("official regular metadata path invalid")
	}
}
