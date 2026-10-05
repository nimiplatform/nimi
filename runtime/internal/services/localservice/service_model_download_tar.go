package localservice

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strings"
)

type managedArchiveEntry struct {
	size int64
	open func() (io.ReadCloser, error)
}

const modelTarMaxEntries = 4096
const modelTarMetadataBudget = int64(1 << 20)

type modelTarReader struct {
	file    *os.File
	gz      *gzip.Reader
	limited *io.LimitedReader
	reader  *tar.Reader
	check   func() error
}

func openModelTar(path string, budget int64, check func() error) (*modelTarReader, error) {
	if budget <= 0 || budget > (1<<40) {
		return nil, fmt.Errorf("invalid tar payload budget")
	}
	f, e := os.Open(path)
	if e != nil {
		return nil, e
	}
	gz, e := gzip.NewReader(f)
	if e != nil {
		_ = f.Close()
		return nil, e
	}
	r := &modelTarReader{file: f, gz: gz, limited: &io.LimitedReader{R: gz, N: budget + modelTarMetadataBudget + modelTarMaxEntries*1024 + 1024}, check: check}
	r.reader = tar.NewReader(r)
	return r, nil
}
func (r *modelTarReader) Read(p []byte) (int, error) {
	if e := r.check(); e != nil {
		return 0, e
	}
	if len(p) > 65536 {
		p = p[:65536]
	}
	return r.limited.Read(p)
}
func (r *modelTarReader) Close() error {
	a := r.gz.Close()
	b := r.file.Close()
	if a != nil {
		return a
	}
	return b
}
func modelTarName(h *tar.Header) (string, error) {
	name := strings.TrimPrefix(h.Name, "./")
	if h.Typeflag == tar.TypeDir {
		name = strings.TrimSuffix(name, "/")
		if name == "" || name == "." {
			return ".", nil
		}
	}
	if name == "" || strings.ContainsAny(name, "\\:\x00") || strings.HasPrefix(name, "/") {
		return "", fmt.Errorf("unsafe tar path %q", h.Name)
	}
	for _, p := range strings.Split(name, "/") {
		if p == "" || p == "." || p == ".." || strings.TrimSpace(p) != p || strings.HasSuffix(p, ".") {
			return "", fmt.Errorf("unsafe tar path %q", h.Name)
		}
		base := strings.ToLower(strings.SplitN(p, ".", 2)[0])
		if base == "con" || base == "prn" || base == "aux" || base == "nul" || len(base) == 4 && (strings.HasPrefix(base, "com") || strings.HasPrefix(base, "lpt")) && base[3] >= '1' && base[3] <= '9' {
			return "", fmt.Errorf("reserved tar path %q", h.Name)
		}
	}
	return name, nil
}
func tarPayloadRelative(name, root string) string {
	if root == "." {
		return name
	}
	prefix := root + "/"
	if strings.HasPrefix(name, prefix) {
		return strings.TrimPrefix(name, prefix)
	}
	return ""
}

// @nimi-authority: rule.nimi.runtime.model-catalog.github-release-tar-model-archives
// Scan and verify the complete bounded archive before extracting anything.
func indexManagedModelTarArchive(path, root string, files []string, hashes map[string]string, budget int64, check func() error) (map[string]managedArchiveEntry, error) {
	r, e := openModelTar(path, budget, check)
	if e != nil {
		return nil, e
	}
	defer func() { _ = r.Close() }()
	wanted := map[string]bool{}
	for _, name := range files {
		wanted[name] = true
	}
	found := map[string]managedArchiveEntry{}
	seen := map[string]bool{}
	var total int64
	count := 0
	for {
		h, e := r.reader.Next()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, fmt.Errorf("read tar: %w", e)
		}
		count++
		if count > modelTarMaxEntries {
			return nil, fmt.Errorf("tar entry budget exceeded")
		}
		name, e := modelTarName(h)
		if e != nil {
			return nil, e
		}
		fold := strings.ToLower(name)
		if seen[fold] {
			return nil, fmt.Errorf("tar repeats or case-collides %q", name)
		}
		seen[fold] = true
		if h.Typeflag == tar.TypeDir {
			if h.Size != 0 {
				return nil, fmt.Errorf("tar directory has data")
			}
			continue
		}
		if h.Typeflag != tar.TypeReg && h.Typeflag != tar.TypeRegA {
			return nil, fmt.Errorf("tar entry %q is not regular", name)
		}
		if h.Size < 0 || h.Size > budget+modelTarMetadataBudget-total {
			return nil, fmt.Errorf("tar uncompressed size budget exceeded")
		}
		total += h.Size
		relative := tarPayloadRelative(name, root)
		if wanted[relative] {
			if h.Size <= 0 || h.Size > budget {
				return nil, fmt.Errorf("invalid tar payload size")
			}
			digest := sha256.New()
			n, e := io.Copy(digest, r.reader)
			if e != nil || n != h.Size {
				return nil, fmt.Errorf("tar payload incomplete: %v", e)
			}
			if hex.EncodeToString(digest.Sum(nil)) != expectedModelSHA256(hashes, relative) {
				return nil, fmt.Errorf("tar payload %q: %w", relative, errModelDownloadHashMismatch)
			}
			capturedName := name
			capturedSize := h.Size
			found[relative] = managedArchiveEntry{size: capturedSize, open: func() (io.ReadCloser, error) { return openModelTarMember(path, capturedName, budget, check) }}
		} else {
			if _, e := io.Copy(io.Discard, r.reader); e != nil {
				return nil, e
			}
		}
	}
	buffer := make([]byte, 65536)
	for {
		n, e := r.Read(buffer)
		for _, b := range buffer[:n] {
			if b != 0 {
				return nil, fmt.Errorf("tar has trailing content")
			}
		}
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, e
		}
		if n == 0 {
			return nil, io.ErrNoProgress
		}
	}
	if r.limited.N == 0 {
		return nil, fmt.Errorf("tar decompression budget exhausted")
	}
	var declaredTotal int64
	for _, name := range files {
		entry, ok := found[name]
		if !ok {
			return nil, fmt.Errorf("tar lacks declared file %q", name)
		}
		declaredTotal += entry.size
	}
	if declaredTotal != budget {
		return nil, fmt.Errorf("tar declared payload size differs from pinned total")
	}
	return found, nil
}

type modelTarMember struct{ archive *modelTarReader }

func (m *modelTarMember) Read(p []byte) (int, error) { return m.archive.reader.Read(p) }
func (m *modelTarMember) Close() error               { return m.archive.Close() }
func openModelTarMember(path, name string, budget int64, check func() error) (io.ReadCloser, error) {
	r, e := openModelTar(path, budget, check)
	if e != nil {
		return nil, e
	}
	for i := 0; i < modelTarMaxEntries; i++ {
		h, e := r.reader.Next()
		if e != nil {
			_ = r.Close()
			return nil, e
		}
		actual, e := modelTarName(h)
		if e != nil {
			_ = r.Close()
			return nil, e
		}
		if actual == name && h.Typeflag != tar.TypeDir {
			if h.Typeflag != tar.TypeReg && h.Typeflag != tar.TypeRegA {
				_ = r.Close()
				return nil, fmt.Errorf("tar member changed")
			}
			return &modelTarMember{archive: r}, nil
		}
	}
	_ = r.Close()
	return nil, fmt.Errorf("tar member budget exceeded")
}
