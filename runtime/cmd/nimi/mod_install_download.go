package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	maxModArchiveEntries    = 4096
	maxModArchiveFileBytes  = 32 << 20
	maxModArchiveTotalBytes = 256 << 20
)

func downloadGitHubModSource(
	ctx context.Context,
	apiBase string,
	token string,
	owner string,
	repo string,
	subpath string,
	targetRoot string,
) (string, error) {
	normalizedAPIBase := strings.TrimRight(strings.TrimSpace(apiBase), "/")
	if normalizedAPIBase == "" {
		normalizedAPIBase = defaultGitHubAPIBase
	}
	downloadURL, err := buildGitHubAPIURL(normalizedAPIBase, "repos", owner, repo, "tarball")
	if err != nil {
		return "", fmt.Errorf("MOD_INSTALL_DOWNLOAD_FAILED: actionHint=use_source_owner_repo_valid_subpath: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "nimi-runtime-cli")
	if strings.TrimSpace(token) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	}

	client := &http.Client{Timeout: 45 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("MOD_INSTALL_DOWNLOAD_FAILED: actionHint=check_network_or_source_repo: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = response.Status
		}
		return "", fmt.Errorf(
			"MOD_INSTALL_DOWNLOAD_FAILED: actionHint=verify_repo_visibility_or_token status=%d detail=%s",
			response.StatusCode,
			message,
		)
	}

	if err := extractGitHubTarball(response.Body, targetRoot); err != nil {
		return "", err
	}
	return resolveInstallSourceDirFromExtracted(targetRoot, subpath)
}

func extractGitHubTarball(reader io.Reader, destination string) error {
	if err := os.MkdirAll(destination, 0o755); err != nil {
		return err
	}

	gzipReader, err := gzip.NewReader(reader)
	if err != nil {
		return fmt.Errorf("MOD_INSTALL_ARCHIVE_INVALID: actionHint=retry_with_valid_repo_source: %w", err)
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)
	totalBytes := int64(0)
	entryCount := 0
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("MOD_INSTALL_ARCHIVE_INVALID: actionHint=retry_with_valid_repo_source: %w", err)
		}
		if header == nil {
			continue
		}
		entryCount++
		if entryCount > maxModArchiveEntries {
			return fmt.Errorf("MOD_INSTALL_ARCHIVE_INVALID: actionHint=retry_with_valid_repo_source archive contains too many entries")
		}

		trimmedName := strings.Trim(strings.TrimSpace(header.Name), "/")
		if trimmedName == "" {
			continue
		}
		segments := strings.SplitN(trimmedName, "/", 2)
		if len(segments) < 2 {
			continue
		}
		relativePath := filepath.Clean(filepath.FromSlash(segments[1]))
		if relativePath == "." || strings.HasPrefix(relativePath, "..") {
			return fmt.Errorf("MOD_INSTALL_ARCHIVE_INVALID: actionHint=retry_with_valid_repo_source")
		}

		targetPath := filepath.Join(destination, relativePath)
		if !isPathWithin(destination, targetPath) {
			return fmt.Errorf("MOD_INSTALL_ARCHIVE_INVALID: actionHint=retry_with_valid_repo_source")
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(targetPath, 0o755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if header.Size < 0 || header.Size > maxModArchiveFileBytes {
				return fmt.Errorf("MOD_INSTALL_ARCHIVE_INVALID: actionHint=retry_with_valid_repo_source file exceeds size limit")
			}
			totalBytes += header.Size
			if totalBytes > maxModArchiveTotalBytes {
				return fmt.Errorf("MOD_INSTALL_ARCHIVE_INVALID: actionHint=retry_with_valid_repo_source archive exceeds size limit")
			}
			if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
				return err
			}
			file, err := os.OpenFile(targetPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
			if err != nil {
				return err
			}
			written, err := io.Copy(file, io.LimitReader(tarReader, header.Size))
			if err != nil {
				_ = file.Close()
				return err
			}
			if written != header.Size {
				_ = file.Close()
				return fmt.Errorf("MOD_INSTALL_ARCHIVE_INVALID: actionHint=retry_with_valid_repo_source short tar entry")
			}
			if err := file.Close(); err != nil {
				return err
			}
		default:
			continue
		}
	}
	return nil
}

func buildGitHubAPIURL(apiBase string, segments ...string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(apiBase))
	if err != nil {
		return "", fmt.Errorf("invalid github api base: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid github api base")
	}
	basePath := strings.TrimSuffix(parsed.EscapedPath(), "/")
	escapedSegments := make([]string, 0, len(segments))
	for _, segment := range segments {
		trimmed := strings.TrimSpace(segment)
		if trimmed == "" {
			return "", fmt.Errorf("invalid github api path segment")
		}
		escapedSegments = append(escapedSegments, url.PathEscape(trimmed))
	}
	parsed.Path = basePath + "/" + strings.Join(escapedSegments, "/")
	parsed.RawPath = parsed.Path
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func resolveInstallSourceDirFromExtracted(extractedRoot string, subpath string) (string, error) {
	if strings.TrimSpace(subpath) != "" {
		candidate := filepath.Join(extractedRoot, filepath.FromSlash(strings.Trim(strings.TrimSpace(subpath), "/")))
		if !isPathWithin(extractedRoot, candidate) {
			return "", fmt.Errorf("MOD_INSTALL_SUBPATH_INVALID: actionHint=use_source_owner_repo_valid_subpath")
		}
		info, err := os.Stat(candidate)
		if err != nil || !info.IsDir() {
			return "", fmt.Errorf("MOD_INSTALL_SUBPATH_NOT_FOUND: actionHint=use_source_owner_repo_valid_subpath")
		}
		if !dirHasModManifest(candidate) {
			return "", fmt.Errorf("MOD_INSTALL_MANIFEST_NOT_FOUND: actionHint=use_source_owner_repo_path_containing_manifest")
		}
		return candidate, nil
	}

	if dirHasModManifest(extractedRoot) {
		return extractedRoot, nil
	}

	manifestDirs, err := findManifestDirectories(extractedRoot)
	if err != nil {
		return "", err
	}
	switch len(manifestDirs) {
	case 0:
		return "", fmt.Errorf("MOD_INSTALL_MANIFEST_NOT_FOUND: actionHint=ensure_repo_contains_mod_manifest")
	case 1:
		return manifestDirs[0], nil
	default:
		return "", fmt.Errorf("MOD_INSTALL_MULTIPLE_MANIFESTS_FOUND: actionHint=use_source_owner_repo_subpath")
	}
}

func findManifestDirectories(root string) ([]string, error) {
	dirs := map[string]struct{}{}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			name := d.Name()
			if name == ".git" || name == "node_modules" || name == "dist" || name == "target" {
				return filepath.SkipDir
			}
			return nil
		}
		switch d.Name() {
		case "mod.manifest.json", "mod.manifest.yaml", "mod.manifest.yml":
			dirs[filepath.Dir(path)] = struct{}{}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(dirs))
	for dir := range dirs {
		result = append(result, dir)
	}
	sort.Strings(result)
	return result, nil
}

func dirHasModManifest(dir string) bool {
	candidates := []string{
		filepath.Join(dir, "mod.manifest.json"),
		filepath.Join(dir, "mod.manifest.yaml"),
		filepath.Join(dir, "mod.manifest.yml"),
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return true
		}
	}
	return false
}

func isPathWithin(base string, target string) bool {
	baseAbs, err := filepath.Abs(base)
	if err != nil {
		return false
	}
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(baseAbs, targetAbs)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	return !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != ".."
}
