package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func parseOCIImageReference(imageRef string) (ociImageReference, error) {
	trimmed := strings.TrimSpace(imageRef)
	if trimmed == "" {
		return ociImageReference{}, fmt.Errorf("OCI image reference is required")
	}
	firstSlash := strings.Index(trimmed, "/")
	if firstSlash <= 0 || firstSlash == len(trimmed)-1 {
		return ociImageReference{}, fmt.Errorf("invalid OCI image reference %q", imageRef)
	}
	registry := strings.TrimSpace(trimmed[:firstSlash])
	remainder := strings.TrimSpace(trimmed[firstSlash+1:])
	if registry == "" || remainder == "" {
		return ociImageReference{}, fmt.Errorf("invalid OCI image reference %q", imageRef)
	}
	lastColon := strings.LastIndex(remainder, ":")
	if lastColon <= 0 || lastColon == len(remainder)-1 {
		return ociImageReference{}, fmt.Errorf("OCI image tag is required in %q", imageRef)
	}
	repository := strings.TrimSpace(remainder[:lastColon])
	reference := strings.TrimSpace(remainder[lastColon+1:])
	if repository == "" || reference == "" {
		return ociImageReference{}, fmt.Errorf("invalid OCI image reference %q", imageRef)
	}
	return ociImageReference{
		Registry:   registry,
		Repository: repository,
		Reference:  reference,
	}, nil
}

func fetchOCIManifest(ctx context.Context, ref ociImageReference) (ociDistributionManifest, error) {
	url := fmt.Sprintf("https://%s/v2/%s/manifests/%s", ref.Registry, ref.Repository, ref.Reference)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return ociDistributionManifest{}, fmt.Errorf("build OCI manifest request: %w", err)
	}
	req.Header.Set("User-Agent", "nimi-runtime/0.1")
	req.Header.Set("Accept", ociManifestMediaTypeV2)
	resp, err := doOCIRegistryRequestWithRetry(ctx, url, req, 5*time.Minute)
	if err != nil {
		return ociDistributionManifest{}, fmt.Errorf("request OCI manifest %s: %w", ref.Reference, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return ociDistributionManifest{}, fmt.Errorf("request OCI manifest %s: HTTP %d", ref.Reference, resp.StatusCode)
	}
	var manifest ociDistributionManifest
	if err := json.NewDecoder(resp.Body).Decode(&manifest); err != nil {
		return ociDistributionManifest{}, fmt.Errorf("decode OCI manifest %s: %w", ref.Reference, err)
	}
	if manifest.SchemaVersion != 2 {
		return ociDistributionManifest{}, fmt.Errorf("unsupported OCI schema version %d for %s", manifest.SchemaVersion, ref.Reference)
	}
	return manifest, nil
}

func downloadOCIImageBlobToFile(ctx context.Context, ref ociImageReference, digest string, destPath string) (string, error) {
	trimmedDigest := normalizeOCIContentDigest(digest)
	if trimmedDigest == "" {
		return "", fmt.Errorf("OCI blob digest is required")
	}
	url := fmt.Sprintf("https://%s/v2/%s/blobs/%s", ref.Registry, ref.Repository, trimmedDigest)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("build OCI blob request: %w", err)
	}
	req.Header.Set("User-Agent", "nimi-runtime/0.1")
	resp, err := doOCIRegistryRequestWithRetry(ctx, url, req, 30*time.Minute)
	if err != nil {
		return "", fmt.Errorf("request OCI blob %s: %w", trimmedDigest, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("request OCI blob %s: HTTP %d", trimmedDigest, resp.StatusCode)
	}
	out, err := os.Create(destPath)
	if err != nil {
		return "", fmt.Errorf("create OCI blob temp file: %w", err)
	}
	shouldRemove := true
	defer func() {
		_ = out.Close()
		if shouldRemove {
			_ = os.Remove(destPath)
		}
	}()
	hasher := sha256.New()
	if _, err := io.Copy(io.MultiWriter(out, hasher), resp.Body); err != nil {
		return "", fmt.Errorf("write OCI blob %s: %w", trimmedDigest, err)
	}
	if err := out.Close(); err != nil {
		return "", fmt.Errorf("close OCI blob %s: %w", trimmedDigest, err)
	}
	actualDigest := "sha256:" + hex.EncodeToString(hasher.Sum(nil))
	if !strings.EqualFold(trimmedDigest, actualDigest) {
		return "", fmt.Errorf("%w: OCI blob digest mismatch: expected=%s actual=%s", ErrEngineBinaryHashMismatch, trimmedDigest, actualDigest)
	}
	shouldRemove = false
	return destPath, nil
}

func normalizeOCIContentDigest(value string) string {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	if strings.HasPrefix(trimmed, "sha256:") && len(trimmed) == len("sha256:")+64 {
		return trimmed
	}
	return ""
}

func doOCIRegistryRequestWithRetry(ctx context.Context, sourceURL string, req *http.Request, timeout time.Duration) (*http.Response, error) {
	client := newEngineDownloadHTTPClient(sourceURL, nil, timeout)
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		cloned := req.Clone(ctx)
		resp, err := client.Do(cloned)
		if err == nil {
			return resp, nil
		}
		lastErr = err
		if attempt == 2 {
			break
		}
		delay := time.Duration(attempt+1) * 250 * time.Millisecond
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, lastErr
}
