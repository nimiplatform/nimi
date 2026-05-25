package appinstallgateway

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/appreleasecatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
)

// BundledArtifactSource resolves and materializes a bundled-with-nimi app
// artifact from the atomic Nimi release bundle. A bundled descriptor never
// authorizes an external download (P-NAPP-014 / K-APP-011): its artifact is
// the first-party bundled app directory shipped inside the Nimi release.
//
// The bundled artifact for app <app-id> is the directory:
//
//	<bundled_apps_root>/<app-id>
//
// which is copied verbatim into the release root. The materialized release
// digest is a deterministic sha256 over the sorted (relative-path, content)
// tuples of the copied tree, recorded into install evidence as bundled-source
// verification.
type BundledArtifactSource struct {
	bundledAppsRoot string
}

var (
	// ErrBundledAppsRootRequired reports a missing bundled-apps root.
	ErrBundledAppsRootRequired = errors.New("app install bundled apps root is required")
	// ErrBundledArtifactNotFound reports a missing bundled app directory.
	ErrBundledArtifactNotFound = errors.New("app install bundled artifact directory not found")
	// ErrBundledArtifactNotDirectory reports a bundled artifact path that is
	// not a directory.
	ErrBundledArtifactNotDirectory = errors.New("app install bundled artifact path is not a directory")
	// ErrExternalDescriptorNotBundled rejects routing an external descriptor
	// through the bundled source.
	ErrExternalDescriptorNotBundled = errors.New("external immutable artifact descriptor must not use the bundled source")
	// ErrBundledArtifactSymlink rejects a symlink inside the bundled tree.
	ErrBundledArtifactSymlink = errors.New("app install bundled artifact contains a symlink")
)

// NewBundledArtifactSource constructs a BundledArtifactSource rooted at the
// runtime-local bundled-apps directory.
func NewBundledArtifactSource(bundledAppsRoot string) (*BundledArtifactSource, error) {
	root := strings.TrimSpace(bundledAppsRoot)
	if root == "" {
		return nil, ErrBundledAppsRootRequired
	}
	if !filepath.IsAbs(root) {
		return nil, fmt.Errorf("appinstallgateway bundled source: %w: root must be absolute", ErrBundledAppsRootRequired)
	}
	return &BundledArtifactSource{bundledAppsRoot: filepath.Clean(root)}, nil
}

// Resolve locates the bundled artifact directory for a bundled descriptor and
// returns a VerifiedArtifact whose SHA256 is the deterministic tree digest.
// The Payload is intentionally nil: a bundled artifact is materialized by
// MaterializeInto, not unpacked from a byte payload.
func (b *BundledArtifactSource) Resolve(_ context.Context, descriptor appreleasecatalog.Descriptor) (VerifiedArtifact, error) {
	if descriptor.DescriptorClass != appreleasecatalog.DescriptorClassBundledWithNimi {
		return VerifiedArtifact{}, fmt.Errorf("appinstallgateway bundled source: %w: %s", ErrExternalDescriptorNotBundled, descriptor.DescriptorClass)
	}
	artifactDir, err := b.artifactDir(descriptor.AppID)
	if err != nil {
		return VerifiedArtifact{}, err
	}
	digest, bytesTotal, err := treeDigest(artifactDir)
	if err != nil {
		return VerifiedArtifact{}, err
	}
	return VerifiedArtifact{
		DescriptorID: descriptor.DescriptorID,
		AppID:        descriptor.AppID,
		Version:      descriptor.Version,
		SHA256:       digest,
		Bytes:        bytesTotal,
		Payload:      nil,
	}, nil
}

// MaterializeInto copies the bundled artifact directory verbatim into the
// release root. The release root must already be materialized.
func (b *BundledArtifactSource) MaterializeInto(_ context.Context, descriptor appreleasecatalog.Descriptor, plan appstorage.Plan) error {
	releaseRoot := strings.TrimSpace(plan.ReleaseRoot)
	if releaseRoot == "" {
		return errors.New("appinstallgateway bundled source: release root is empty")
	}
	artifactDir, err := b.artifactDir(descriptor.AppID)
	if err != nil {
		return err
	}
	return copyTree(artifactDir, releaseRoot)
}

func (b *BundledArtifactSource) artifactDir(appID string) (string, error) {
	trimmed := strings.TrimSpace(appID)
	if trimmed == "" || strings.ContainsAny(trimmed, `/\`) || trimmed == "." || trimmed == ".." {
		return "", fmt.Errorf("appinstallgateway bundled source: %w: %q", ErrBundledArtifactNotFound, appID)
	}
	artifactDir := filepath.Join(b.bundledAppsRoot, trimmed)
	rel, err := filepath.Rel(b.bundledAppsRoot, artifactDir)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("appinstallgateway bundled source: %w: %q", ErrBundledArtifactNotFound, appID)
	}
	info, err := os.Lstat(artifactDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("appinstallgateway bundled source: %w: %q", ErrBundledArtifactNotFound, artifactDir)
		}
		return "", fmt.Errorf("appinstallgateway bundled source: stat %q: %w", artifactDir, err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("appinstallgateway bundled source: %w: %q", ErrBundledArtifactSymlink, artifactDir)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("appinstallgateway bundled source: %w: %q", ErrBundledArtifactNotDirectory, artifactDir)
	}
	return artifactDir, nil
}

// treeDigest computes a deterministic sha256 over the sorted relative-path and
// content of every regular file under root.
func treeDigest(root string) (string, int64, error) {
	type entry struct {
		rel  string
		path string
	}
	var entries []entry
	var bytesTotal int64
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("%w: %q", ErrBundledArtifactSymlink, path)
		}
		if d.IsDir() {
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		entries = append(entries, entry{rel: filepath.ToSlash(rel), path: path})
		return nil
	})
	if err != nil {
		return "", 0, fmt.Errorf("appinstallgateway bundled source: walk %q: %w", root, err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].rel < entries[j].rel })
	hasher := sha256.New()
	for _, item := range entries {
		if _, err := fmt.Fprintf(hasher, "path:%s\n", item.rel); err != nil {
			return "", 0, fmt.Errorf("appinstallgateway bundled source: hash path %q: %w", item.rel, err)
		}
		file, err := os.Open(item.path)
		if err != nil {
			return "", 0, fmt.Errorf("appinstallgateway bundled source: open %q: %w", item.path, err)
		}
		written, err := io.Copy(hasher, file)
		closeErr := file.Close()
		if err != nil {
			return "", 0, fmt.Errorf("appinstallgateway bundled source: hash %q: %w", item.path, err)
		}
		if closeErr != nil {
			return "", 0, fmt.Errorf("appinstallgateway bundled source: close %q: %w", item.path, closeErr)
		}
		bytesTotal += written
	}
	return hex.EncodeToString(hasher.Sum(nil)), bytesTotal, nil
}

// copyTree copies every regular file and directory under src into dst.
func copyTree(src string, dst string) error {
	return filepath.WalkDir(src, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("appinstallgateway bundled source: %w: %q", ErrBundledArtifactSymlink, path)
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return fmt.Errorf("appinstallgateway bundled source: mkdir %q: %w", target, err)
			}
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		source, err := os.Open(path)
		if err != nil {
			return fmt.Errorf("appinstallgateway bundled source: open %q: %w", path, err)
		}
		err = writeArchiveFile(target, source, info.Size(), info.Mode())
		_ = source.Close()
		return err
	})
}
