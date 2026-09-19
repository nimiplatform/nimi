package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/appaccess"
	"gopkg.in/yaml.v3"
)

const formalAppManifestMaxBytes = 1 << 20

type manifestFormalAppReleaseResolver struct {
	releases          map[string]FormalAppRelease
	sourceDevelopment bool
}

// NewManifestFormalAppReleaseResolver loads the immutable registered-release
// inputs shipped under one Platform-owned App package root. Each direct child
// is one release root and its nimi.app.yaml is the only declaration source.
// Native profiles and process witnesses never contribute declaration domains.
func NewManifestFormalAppReleaseResolver(root string) (FormalAppReleaseResolver, error) {
	return newManifestFormalAppResolver(root, false)
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-appacc-001
// NewSourceDevelopmentAppResolver reads only canonical manifest inputs. A
// mutable workspace is not an immutable package and contributes no payload
// fingerprint, lineage, attestation, or execution-profile evidence.
func NewSourceDevelopmentAppResolver(root string) (FormalAppReleaseResolver, error) {
	return newManifestFormalAppResolver(root, true)
}

func newManifestFormalAppResolver(root string, sourceDevelopment bool) (FormalAppReleaseResolver, error) {
	canonicalRoot, err := canonicalFormalAppReleaseRoot(root)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(canonicalRoot)
	if err != nil {
		return nil, fmt.Errorf("read formal App release root: %w", err)
	}
	releases := make(map[string]FormalAppRelease)
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		releaseRoot := filepath.Join(canonicalRoot, entry.Name())
		manifestPath := filepath.Join(releaseRoot, "nimi.app.yaml")
		info, statErr := os.Lstat(manifestPath)
		if errors.Is(statErr, os.ErrNotExist) {
			continue
		}
		if statErr != nil || info == nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() > formalAppManifestMaxBytes {
			return nil, fmt.Errorf("formal App manifest %q is not a bounded regular file", manifestPath)
		}
		var release FormalAppRelease
		var loadErr error
		if sourceDevelopment {
			release, _, loadErr = readFormalAppManifest(releaseRoot, manifestPath)
		} else {
			release, loadErr = loadManifestFormalAppRelease(releaseRoot, manifestPath)
		}
		if loadErr != nil {
			return nil, loadErr
		}
		if _, duplicate := releases[release.AppID]; duplicate {
			return nil, fmt.Errorf("duplicate formal App release input for %q", release.AppID)
		}
		releases[release.AppID] = release
	}
	if len(releases) == 0 {
		return nil, errFormalAppReleaseUnavailable
	}
	return &manifestFormalAppReleaseResolver{releases: releases, sourceDevelopment: sourceDevelopment}, nil
}

func (resolver *manifestFormalAppReleaseResolver) ResolveFormalAppRelease(_ context.Context, appID string) (FormalAppRelease, error) {
	requestedAppID := appID
	appID = strings.TrimSpace(appID)
	if resolver == nil || appID == "" || appID != requestedAppID {
		return FormalAppRelease{}, errFormalAppReleaseUnavailable
	}
	release, ok := resolver.releases[appID]
	if !ok {
		return FormalAppRelease{}, errFormalAppReleaseUnavailable
	}
	if resolver.sourceDevelopment {
		current, _, err := readFormalAppManifest(release.InstallRoot, release.ManifestRef)
		if err != nil {
			return FormalAppRelease{}, err
		}
		if current.AppID != appID {
			return FormalAppRelease{}, errFormalAppReleaseUnavailable
		}
		return current, nil
	}
	release.Declaration = append([]string(nil), release.Declaration...)
	return release, nil
}

func canonicalFormalAppReleaseRoot(root string) (string, error) {
	root = strings.TrimSpace(root)
	if root == "" || !filepath.IsAbs(root) {
		return "", errFormalAppReleaseUnavailable
	}
	canonical, err := filepath.EvalSymlinks(filepath.Clean(root))
	if err != nil {
		return "", fmt.Errorf("canonicalize formal App release root: %w", err)
	}
	info, err := os.Stat(canonical)
	if err != nil || !info.IsDir() {
		return "", errFormalAppReleaseUnavailable
	}
	return filepath.Clean(canonical), nil
}

func loadManifestFormalAppRelease(releaseRoot string, manifestPath string) (FormalAppRelease, error) {
	release, raw, err := readFormalAppManifest(releaseRoot, manifestPath)
	if err != nil {
		return FormalAppRelease{}, err
	}
	payloadDigest, err := formalAppImmutablePayloadDigest(release.InstallRoot)
	if err != nil {
		return FormalAppRelease{}, fmt.Errorf("observe formal App release payload: %w", err)
	}
	after, err := os.ReadFile(release.ManifestRef)
	if err != nil || !bytes.Equal(raw, after) {
		return FormalAppRelease{}, fmt.Errorf("formal App release changed while observed")
	}
	manifestDigest := sha256.Sum256(raw)
	sourceHash := sha256.New()
	_, _ = sourceHash.Write([]byte("nimi.formal-app-release.v1\x00"))
	_, _ = sourceHash.Write([]byte(release.AppID))
	_, _ = sourceHash.Write([]byte{0})
	_, _ = sourceHash.Write(manifestDigest[:])
	_, _ = sourceHash.Write(payloadDigest[:])
	executionProfileDigest := sha256.Sum256([]byte("nimi.formal-app-execution-profile.v1\x00runtime-kind:native"))
	release.ImmutableLineageID = "ail_v1_" + base64.RawURLEncoding.EncodeToString(sourceHash.Sum(nil))
	release.ProvenanceAttestationRefs = []string{"paa_v1_" + base64.RawURLEncoding.EncodeToString(manifestDigest[:])}
	release.ProvenanceRevision = 1
	release.ExecutionProfileRef = "aep_v1_" + base64.RawURLEncoding.EncodeToString(executionProfileDigest[:])
	release.PayloadRootDigest = localDevelopmentDigestRef("payload", payloadDigest)
	return release, nil
}

func readFormalAppManifest(releaseRoot string, manifestPath string) (FormalAppRelease, []byte, error) {
	canonicalRoot, err := filepath.EvalSymlinks(filepath.Clean(releaseRoot))
	if err != nil {
		return FormalAppRelease{}, nil, fmt.Errorf("canonicalize formal App release: %w", err)
	}
	canonicalManifest, err := filepath.EvalSymlinks(filepath.Clean(manifestPath))
	if err != nil || canonicalManifest != filepath.Join(canonicalRoot, "nimi.app.yaml") {
		return FormalAppRelease{}, nil, errFormalAppReleaseUnavailable
	}
	info, err := os.Lstat(manifestPath)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() > formalAppManifestMaxBytes {
		return FormalAppRelease{}, nil, errFormalAppReleaseUnavailable
	}
	raw, err := os.ReadFile(canonicalManifest)
	if err != nil || len(raw) == 0 || len(raw) > formalAppManifestMaxBytes {
		return FormalAppRelease{}, nil, errFormalAppReleaseUnavailable
	}
	var manifest localAppManifest
	var shape map[string]any
	if err := yaml.Unmarshal(raw, &shape); err != nil {
		return FormalAppRelease{}, nil, fmt.Errorf("decode formal App manifest: %w", err)
	}
	if err := yaml.Unmarshal(raw, &manifest); err != nil {
		return FormalAppRelease{}, nil, fmt.Errorf("decode formal App release input: %w", err)
	}
	if _, legacy := shape["permissions"]; legacy || manifest.AppAccess == nil {
		return FormalAppRelease{}, nil, errFormalAppReleaseUnavailable
	}
	appID := firstNonEmpty(manifest.AppID, manifest.AppIDCamel)
	displayName := firstNonEmpty(manifest.DisplayName, manifest.DisplayNameCamel)
	if !safeLocalAppID(appID) || appID != strings.TrimSpace(appID) || displayName == "" || displayName != strings.TrimSpace(displayName) ||
		(manifest.AppID != "" && manifest.AppIDCamel != "" && manifest.AppID != manifest.AppIDCamel) ||
		(manifest.DisplayName != "" && manifest.DisplayNameCamel != "" && manifest.DisplayName != manifest.DisplayNameCamel) {
		return FormalAppRelease{}, nil, errFormalAppReleaseUnavailable
	}
	if _, _, err := appaccess.ResolveDeclaration(*manifest.AppAccess); err != nil {
		return FormalAppRelease{}, nil, fmt.Errorf("resolve formal App declaration: %w", err)
	}
	return FormalAppRelease{
		AppID:       appID,
		DisplayName: displayName,
		SourceRef:   "platform-app:" + appID,
		InstallRoot: canonicalRoot,
		ManifestRef: canonicalManifest,
		Declaration: append([]string(nil), (*manifest.AppAccess)...),
	}, raw, nil
}
