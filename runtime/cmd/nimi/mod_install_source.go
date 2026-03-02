package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func resolveInstallSource(
	source string,
	apiBase string,
	token string,
	modCircleRepo string,
	modCircleRef string,
	modCircleStrictID bool,
) (resolvedInstallSource, error) {
	if localSourceDir, ok := resolveExistingDir(source); ok {
		return resolvedInstallSource{
			sourceDir:        localSourceDir,
			normalizedSource: source,
			verified:         false,
			cleanup:          func() {},
		}, nil
	}

	if owner, repo, subpath, err := parseGitHubRepoReference(source); err == nil {
		tempDir, tempErr := os.MkdirTemp("", "nimi-mod-install-*")
		if tempErr != nil {
			return resolvedInstallSource{}, fmt.Errorf("prepare install temp dir: %w", tempErr)
		}
		cleanup := func() {
			_ = os.RemoveAll(tempDir)
		}

		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		sourceDir, downloadErr := downloadGitHubModSource(ctx, strings.TrimSpace(apiBase), token, owner, repo, subpath, tempDir)
		if downloadErr != nil {
			cleanup()
			return resolvedInstallSource{}, downloadErr
		}

		normalized := "github:" + owner + "/" + repo
		if strings.TrimSpace(subpath) != "" {
			normalized += "/" + strings.Trim(strings.TrimSpace(subpath), "/")
		}
		return resolvedInstallSource{
			sourceDir:        sourceDir,
			normalizedSource: normalized,
			verified:         false,
			cleanup:          cleanup,
		}, nil
	}

	modCircleSelector, isModCircleSource := parseModCircleInstallSelector(source)
	if !isModCircleSource {
		return resolvedInstallSource{}, fmt.Errorf(
			"MOD_INSTALL_SOURCE_UNSUPPORTED: actionHint=use_local_dir_or_github_owner_repo_or_mod-circle_id",
		)
	}

	entry, err := resolveModCircleEntry(
		strings.TrimSpace(apiBase),
		token,
		modCircleRepo,
		modCircleRef,
		modCircleSelector,
		modCircleStrictID,
	)
	if err != nil {
		return resolvedInstallSource{}, err
	}

	repoOwner, repoName, repoSubpath, err := parseGitHubRepoReference(entry.Repo)
	if err != nil {
		return resolvedInstallSource{}, fmt.Errorf(
			"MOD_INSTALL_MOD_CIRCLE_ENTRY_INVALID: actionHint=check_mod_circle_index_entry repo=%s: %w",
			entry.Repo,
			err,
		)
	}

	tempDir, err := os.MkdirTemp("", "nimi-mod-install-*")
	if err != nil {
		return resolvedInstallSource{}, fmt.Errorf("prepare install temp dir: %w", err)
	}
	cleanup := func() {
		_ = os.RemoveAll(tempDir)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	sourceDir, err := downloadGitHubModSource(
		ctx,
		strings.TrimSpace(apiBase),
		token,
		repoOwner,
		repoName,
		repoSubpath,
		tempDir,
	)
	if err != nil {
		cleanup()
		return resolvedInstallSource{}, err
	}

	normalized := "mod-circle:" + entry.ID
	return resolvedInstallSource{
		sourceDir:        sourceDir,
		normalizedSource: normalized,
		verified:         entry.Verified,
		cleanup:          cleanup,
	}, nil
}

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
	downloadURL := fmt.Sprintf("%s/repos/%s/%s/tarball", normalizedAPIBase, owner, repo)

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
			if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
				return err
			}
			file, err := os.OpenFile(targetPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
			if err != nil {
				return err
			}
			if _, err := io.Copy(file, tarReader); err != nil {
				_ = file.Close()
				return err
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

func parseModCircleInstallSelector(source string) (string, bool) {
	trimmed := strings.TrimSpace(source)
	if trimmed == "" {
		return "", false
	}
	lowered := strings.ToLower(trimmed)
	for _, prefix := range []string{"mod-circle:", "circle:", "mod:"} {
		if strings.HasPrefix(lowered, prefix) {
			selector := strings.TrimSpace(trimmed[len(prefix):])
			if selector == "" {
				return "", false
			}
			return selector, true
		}
	}
	if strings.HasPrefix(trimmed, "world.") {
		return trimmed, true
	}
	return "", false
}

func resolveModCircleEntry(
	apiBase string,
	token string,
	modCircleRepo string,
	modCircleRef string,
	selector string,
	strictID bool,
) (modCircleEntry, error) {
	owner, repo, _, err := parseGitHubRepoReference(modCircleRepo)
	if err != nil {
		return modCircleEntry{}, fmt.Errorf("invalid mod-circle-repo: %w", err)
	}
	ref := strings.TrimSpace(modCircleRef)
	if ref == "" {
		ref = "main"
	}

	client := newGitHubRESTClient(apiBase, token)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	items, err := client.listDirectory(ctx, owner, repo, "mods", ref)
	if err != nil {
		return modCircleEntry{}, fmt.Errorf(
			"MOD_INSTALL_MOD_CIRCLE_INDEX_UNAVAILABLE: actionHint=check_mod_circle_repo_and_network: %w",
			err,
		)
	}
	if len(items) == 0 {
		return modCircleEntry{}, fmt.Errorf("MOD_INSTALL_MOD_CIRCLE_INDEX_EMPTY: actionHint=check_mod_circle_repo_contents")
	}

	normalizedSelector := strings.Trim(strings.TrimSpace(selector), "/")
	normalizedSelectorNoExt := strings.TrimSuffix(normalizedSelector, ".json")
	byName := map[string]githubContentItem{}
	jsonItems := make([]githubContentItem, 0, len(items))
	for _, item := range items {
		if item.Type != "file" {
			continue
		}
		if !strings.HasSuffix(strings.ToLower(item.Name), ".json") {
			continue
		}
		jsonItems = append(jsonItems, item)
		byName[item.Name] = item
	}
	if len(jsonItems) == 0 {
		return modCircleEntry{}, fmt.Errorf("MOD_INSTALL_MOD_CIRCLE_INDEX_EMPTY: actionHint=check_mod_circle_repo_contents")
	}

	candidateNames := []string{
		normalizedSelector,
		normalizedSelector + ".json",
		normalizedSelectorNoExt + ".json",
	}
	for _, candidate := range candidateNames {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		item, ok := byName[candidate]
		if !ok {
			continue
		}
		entry, loadErr := loadModCircleEntryFile(ctx, client, owner, repo, item.Path, ref)
		if loadErr != nil {
			return modCircleEntry{}, loadErr
		}
		if strings.TrimSpace(entry.ID) == "" {
			entry.ID = normalizedSelectorNoExt
		}
		if strings.TrimSpace(entry.Repo) == "" {
			return modCircleEntry{}, fmt.Errorf(
				"MOD_INSTALL_MOD_CIRCLE_ENTRY_INVALID: actionHint=check_mod_circle_index_entry_missing_repo",
			)
		}
		return entry, nil
	}

	exactIDMatches := make([]modCircleEntry, 0, 2)
	fallbackMatches := make([]modCircleEntry, 0, 2)
	for _, item := range jsonItems {
		entry, loadErr := loadModCircleEntryFile(ctx, client, owner, repo, item.Path, ref)
		if loadErr != nil {
			continue
		}
		entryID := strings.TrimSpace(entry.ID)
		entryName := strings.TrimSpace(entry.Name)
		if entryID == "" {
			entryID = strings.TrimSuffix(item.Name, ".json")
			entry.ID = entryID
		}
		if entryID == normalizedSelector {
			exactIDMatches = append(exactIDMatches, entry)
			continue
		}
		if strictID {
			continue
		}
		if strings.EqualFold(entryName, normalizedSelector) {
			fallbackMatches = append(fallbackMatches, entry)
			continue
		}
		if strings.HasPrefix(normalizedSelector, "world.") && slugify(entryID) == slugify(normalizedSelector) {
			fallbackMatches = append(fallbackMatches, entry)
		}
	}

	if len(exactIDMatches) == 1 {
		entry := exactIDMatches[0]
		if strings.TrimSpace(entry.Repo) == "" {
			return modCircleEntry{}, fmt.Errorf(
				"MOD_INSTALL_MOD_CIRCLE_ENTRY_INVALID: actionHint=check_mod_circle_index_entry_missing_repo",
			)
		}
		return entry, nil
	}
	if len(exactIDMatches) > 1 {
		ids := make([]string, 0, len(exactIDMatches))
		for _, item := range exactIDMatches {
			ids = append(ids, item.ID)
		}
		sort.Strings(ids)
		return modCircleEntry{}, fmt.Errorf(
			"MOD_INSTALL_MOD_CIRCLE_AMBIGUOUS: actionHint=use_mod-circle:exact_mod_id matches=%s",
			strings.Join(ids, ","),
		)
	}
	if strictID {
		return modCircleEntry{}, fmt.Errorf(
			"MOD_INSTALL_MOD_CIRCLE_NOT_FOUND: actionHint=use_mod-circle:exact_mod_id selector=%s",
			normalizedSelector,
		)
	}
	if len(fallbackMatches) == 1 {
		entry := fallbackMatches[0]
		if strings.TrimSpace(entry.Repo) == "" {
			return modCircleEntry{}, fmt.Errorf(
				"MOD_INSTALL_MOD_CIRCLE_ENTRY_INVALID: actionHint=check_mod_circle_index_entry_missing_repo",
			)
		}
		return entry, nil
	}
	if len(fallbackMatches) > 1 {
		ids := make([]string, 0, len(fallbackMatches))
		for _, item := range fallbackMatches {
			ids = append(ids, item.ID)
		}
		sort.Strings(ids)
		return modCircleEntry{}, fmt.Errorf(
			"MOD_INSTALL_MOD_CIRCLE_AMBIGUOUS: actionHint=use_mod-circle:exact_mod_id matches=%s",
			strings.Join(ids, ","),
		)
	}
	return modCircleEntry{}, fmt.Errorf(
		"MOD_INSTALL_MOD_CIRCLE_NOT_FOUND: actionHint=use_mod-circle:exact_mod_id selector=%s",
		normalizedSelector,
	)
}

func loadModCircleEntryFile(
	ctx context.Context,
	client *githubRESTClient,
	owner string,
	repo string,
	path string,
	ref string,
) (modCircleEntry, error) {
	content, err := client.getFileContent(ctx, owner, repo, path, ref)
	if err != nil {
		return modCircleEntry{}, err
	}
	var entry modCircleEntry
	if err := json.Unmarshal(content, &entry); err != nil {
		return modCircleEntry{}, fmt.Errorf(
			"MOD_INSTALL_MOD_CIRCLE_ENTRY_INVALID: actionHint=check_mod_circle_index_entry_json path=%s: %w",
			path,
			err,
		)
	}
	return entry, nil
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
