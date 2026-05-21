package appinstallgateway

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
)

// ArchiveUnpacker is the concrete Unpacker. It materializes a verified artifact
// into the release root, supporting tar.gz and zip archive payloads. It
// detects the archive format by content sniffing and fails closed on an
// unsupported format or on any entry that escapes the release root.
type ArchiveUnpacker struct {
	maxEntryBytes  int64
	maxTotalBytes  int64
	maxEntryCount  int
}

// UnpackerOption configures an ArchiveUnpacker.
type UnpackerOption func(*ArchiveUnpacker)

const (
	defaultMaxEntryBytes = int64(1) << 30
	defaultMaxTotalBytes = int64(2) << 30
	defaultMaxEntryCount = 200000
)

var (
	// ErrUnsupportedArchiveFormat reports an artifact that is neither tar.gz
	// nor zip.
	ErrUnsupportedArchiveFormat = errors.New("app install artifact is not a supported archive (tar.gz or zip)")
	// ErrArchiveEntryEscapesRoot reports an archive entry whose target path
	// escapes the release root.
	ErrArchiveEntryEscapesRoot = errors.New("app install archive entry escapes release root")
	// ErrArchiveEntrySymlink reports a symlink entry, which is not admitted.
	ErrArchiveEntrySymlink = errors.New("app install archive symlink entries are not admitted")
	// ErrArchiveEntryTooLarge reports an entry exceeding the per-entry cap.
	ErrArchiveEntryTooLarge = errors.New("app install archive entry exceeds maximum size")
	// ErrArchiveTooLarge reports a decompressed total exceeding the cap.
	ErrArchiveTooLarge = errors.New("app install archive decompressed total exceeds maximum size")
	// ErrArchiveTooManyEntries reports an archive with too many entries.
	ErrArchiveTooManyEntries = errors.New("app install archive has too many entries")
)

// NewArchiveUnpacker constructs an ArchiveUnpacker.
func NewArchiveUnpacker(options ...UnpackerOption) *ArchiveUnpacker {
	unpacker := &ArchiveUnpacker{
		maxEntryBytes: defaultMaxEntryBytes,
		maxTotalBytes: defaultMaxTotalBytes,
		maxEntryCount: defaultMaxEntryCount,
	}
	for _, option := range options {
		if option != nil {
			option(unpacker)
		}
	}
	return unpacker
}

// WithMaxEntryBytes overrides the per-entry size cap.
func WithMaxEntryBytes(maxBytes int64) UnpackerOption {
	return func(u *ArchiveUnpacker) {
		if maxBytes > 0 {
			u.maxEntryBytes = maxBytes
		}
	}
}

// WithMaxTotalBytes overrides the decompressed total cap.
func WithMaxTotalBytes(maxBytes int64) UnpackerOption {
	return func(u *ArchiveUnpacker) {
		if maxBytes > 0 {
			u.maxTotalBytes = maxBytes
		}
	}
}

// Unpack materializes the verified artifact into plan.ReleaseRoot. The release
// root must already be materialized by the gateway; Unpack writes the archive
// payload into it.
func (u *ArchiveUnpacker) Unpack(_ context.Context, artifact VerifiedArtifact, plan appstorage.Plan) error {
	releaseRoot := strings.TrimSpace(plan.ReleaseRoot)
	if releaseRoot == "" {
		return errors.New("appinstallgateway unpack: release root is empty")
	}
	if isGzip(artifact.Payload) {
		return u.unpackTarGz(artifact.Payload, releaseRoot)
	}
	if isZip(artifact.Payload) {
		return u.unpackZip(artifact.Payload, releaseRoot)
	}
	return fmt.Errorf("appinstallgateway unpack: %w", ErrUnsupportedArchiveFormat)
}

func isGzip(payload []byte) bool {
	return len(payload) >= 2 && payload[0] == 0x1f && payload[1] == 0x8b
}

func isZip(payload []byte) bool {
	return len(payload) >= 4 && payload[0] == 'P' && payload[1] == 'K' &&
		(payload[2] == 0x03 || payload[2] == 0x05 || payload[2] == 0x07) &&
		(payload[3] == 0x04 || payload[3] == 0x06 || payload[3] == 0x08)
}

func (u *ArchiveUnpacker) unpackTarGz(payload []byte, releaseRoot string) error {
	gzReader, err := gzip.NewReader(bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("appinstallgateway unpack: open gzip: %w", err)
	}
	defer func() { _ = gzReader.Close() }()

	tarReader := tar.NewReader(gzReader)
	var total int64
	var entries int
	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("appinstallgateway unpack: read tar entry: %w", err)
		}
		entries++
		if entries > u.maxEntryCount {
			return fmt.Errorf("appinstallgateway unpack: %w", ErrArchiveTooManyEntries)
		}
		if header.Typeflag == tar.TypeSymlink || header.Typeflag == tar.TypeLink {
			return fmt.Errorf("appinstallgateway unpack: %w: %q", ErrArchiveEntrySymlink, header.Name)
		}
		target, err := safeJoin(releaseRoot, header.Name)
		if err != nil {
			return err
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return fmt.Errorf("appinstallgateway unpack: mkdir %q: %w", target, err)
			}
		case tar.TypeReg:
			if header.Size > u.maxEntryBytes {
				return fmt.Errorf("appinstallgateway unpack: %w: %q", ErrArchiveEntryTooLarge, header.Name)
			}
			total += header.Size
			if total > u.maxTotalBytes {
				return fmt.Errorf("appinstallgateway unpack: %w", ErrArchiveTooLarge)
			}
			if err := writeArchiveFile(target, tarReader, header.Size, fileMode(header.FileInfo())); err != nil {
				return err
			}
		default:
			// Skip non-regular, non-directory entries (devices, fifos).
			continue
		}
	}
	return nil
}

func (u *ArchiveUnpacker) unpackZip(payload []byte, releaseRoot string) error {
	zipReader, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return fmt.Errorf("appinstallgateway unpack: open zip: %w", err)
	}
	if len(zipReader.File) > u.maxEntryCount {
		return fmt.Errorf("appinstallgateway unpack: %w", ErrArchiveTooManyEntries)
	}
	var total int64
	for _, entry := range zipReader.File {
		if entry.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("appinstallgateway unpack: %w: %q", ErrArchiveEntrySymlink, entry.Name)
		}
		target, err := safeJoin(releaseRoot, entry.Name)
		if err != nil {
			return err
		}
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return fmt.Errorf("appinstallgateway unpack: mkdir %q: %w", target, err)
			}
			continue
		}
		size := int64(entry.UncompressedSize64)
		if size > u.maxEntryBytes {
			return fmt.Errorf("appinstallgateway unpack: %w: %q", ErrArchiveEntryTooLarge, entry.Name)
		}
		total += size
		if total > u.maxTotalBytes {
			return fmt.Errorf("appinstallgateway unpack: %w", ErrArchiveTooLarge)
		}
		reader, err := entry.Open()
		if err != nil {
			return fmt.Errorf("appinstallgateway unpack: open zip entry %q: %w", entry.Name, err)
		}
		err = writeArchiveFile(target, io.LimitReader(reader, u.maxEntryBytes+1), size, entry.Mode())
		_ = reader.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

// safeJoin joins name onto root and fails closed when the entry name carries a
// parent-directory segment or absolute path, or when the resolved target
// escapes root. Traversal is rejected, not silently sanitized.
func safeJoin(root string, name string) (string, error) {
	slashed := filepath.ToSlash(name)
	if strings.HasPrefix(slashed, "/") {
		return "", fmt.Errorf("appinstallgateway unpack: %w: %q", ErrArchiveEntryEscapesRoot, name)
	}
	for _, segment := range strings.Split(slashed, "/") {
		if segment == ".." {
			return "", fmt.Errorf("appinstallgateway unpack: %w: %q", ErrArchiveEntryEscapesRoot, name)
		}
	}
	target := filepath.Join(root, filepath.FromSlash(slashed))
	rel, err := filepath.Rel(root, target)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("appinstallgateway unpack: %w: %q", ErrArchiveEntryEscapesRoot, name)
	}
	return target, nil
}

func writeArchiveFile(target string, src io.Reader, size int64, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return fmt.Errorf("appinstallgateway unpack: mkdir parent %q: %w", target, err)
	}
	if mode == 0 {
		mode = 0o644
	}
	file, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode.Perm())
	if err != nil {
		return fmt.Errorf("appinstallgateway unpack: create %q: %w", target, err)
	}
	written, err := io.Copy(file, src)
	if closeErr := file.Close(); closeErr != nil && err == nil {
		err = closeErr
	}
	if err != nil {
		return fmt.Errorf("appinstallgateway unpack: write %q: %w", target, err)
	}
	if size >= 0 && written != size {
		return fmt.Errorf("appinstallgateway unpack: %w: %q", ErrArchiveEntryTooLarge, target)
	}
	return nil
}

func fileMode(info os.FileInfo) os.FileMode {
	if info == nil {
		return 0o644
	}
	return info.Mode()
}
