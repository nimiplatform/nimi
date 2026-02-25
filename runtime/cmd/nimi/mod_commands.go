package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
)

const (
	defaultModCircleRepo = "nimiplatform/mod-circle"
	defaultGitHubAPIBase = "https://api.github.com"
)

type modManifest struct {
	ID           string
	Name         string
	Version      string
	Description  string
	License      string
	Capabilities []string
}

type modInstallMetadata struct {
	Source      string `json:"source"`
	InstalledAt string `json:"installed_at"`
	Verified    bool   `json:"verified"`
}

type modListItem struct {
	ModID        string   `json:"mod_id"`
	Name         string   `json:"name"`
	Version      string   `json:"version"`
	Path         string   `json:"path"`
	Source       string   `json:"source,omitempty"`
	InstalledAt  string   `json:"installed_at,omitempty"`
	Verified     bool     `json:"verified"`
	Capabilities []string `json:"capabilities"`
}

type modPublishResult struct {
	Repo       string `json:"repo"`
	Branch     string `json:"branch"`
	PRNumber   int    `json:"pr_number"`
	PRURL      string `json:"pr_url"`
	IndexPath  string `json:"index_path"`
	BundleHash string `json:"bundle_hash"`
}

type resolvedInstallSource struct {
	sourceDir        string
	normalizedSource string
	verified         bool
	cleanup          func()
}

type modCircleEntry struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Author      string   `json:"author"`
	Repo        string   `json:"repo"`
	Tags        []string `json:"tags"`
	Verified    bool     `json:"verified"`
}

func runRuntimeMod(args []string) error {
	if len(args) == 0 {
		printRuntimeModUsage()
		return flag.ErrHelp
	}

	switch args[0] {
	case "list":
		return runRuntimeModList(args[1:])
	case "install":
		return runRuntimeModInstall(args[1:])
	case "create":
		return runRuntimeModCreate(args[1:])
	case "dev":
		return runRuntimeModDev(args[1:])
	case "build":
		return runRuntimeModBuild(args[1:])
	case "publish":
		return runRuntimeModPublish(args[1:])
	default:
		printRuntimeModUsage()
		return flag.ErrHelp
	}
}

func runRuntimeModList(args []string) error {
	fs := flag.NewFlagSet("nimi mod list", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	modsDirRaw := fs.String("mods-dir", "", "mods directory (required: --mods-dir or $NIMI_RUNTIME_MODS_DIR)")
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	modsDir, err := resolveModsDir(*modsDirRaw)
	if err != nil {
		return err
	}
	items, err := listInstalledMods(modsDir)
	if err != nil {
		return err
	}

	if *jsonOutput {
		return writeJSON(map[string]any{
			"mods_dir": modsDir,
			"mods":     items,
		})
	}

	if len(items) == 0 {
		fmt.Printf("no mods found in %s\n", modsDir)
		return nil
	}

	fmt.Printf("%-36s %-16s %-10s %-9s %s\n", "MOD_ID", "NAME", "VERSION", "VERIFIED", "SOURCE")
	for _, item := range items {
		verified := "no"
		if item.Verified {
			verified = "yes"
		}
		fmt.Printf("%-36s %-16s %-10s %-9s %s\n", item.ModID, item.Name, item.Version, verified, item.Source)
	}
	return nil
}

func runRuntimeModInstall(args []string) error {
	sourcePositional := ""
	normalizedArgs := append([]string(nil), args...)
	if len(normalizedArgs) > 0 && !strings.HasPrefix(normalizedArgs[0], "-") {
		sourcePositional = strings.TrimSpace(normalizedArgs[0])
		normalizedArgs = normalizedArgs[1:]
	}

	fs := flag.NewFlagSet("nimi mod install", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	modsDirRaw := fs.String("mods-dir", "", "mods directory (required: --mods-dir or $NIMI_RUNTIME_MODS_DIR)")
	sourceFlag := fs.String("source", "", "mod source: local dir, github:user/repo[/path], owner/repo[/path], mod-circle:<modId>, or world.nimi.*")
	modCircleRepoRaw := fs.String("mod-circle-repo", defaultModCircleRepo, "mod circle repo owner/name")
	modCircleRef := fs.String("mod-circle-ref", "main", "mod circle index git ref")
	strictID := fs.Bool("strict-id", false, "for mod-circle source, require exact mod id match (no name fallback)")
	apiBase := fs.String("api-base", resolveGitHubAPIBase(), "GitHub API base URL")
	tokenRaw := fs.String("token", "", "GitHub token (default: $GITHUB_TOKEN)")
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(normalizedArgs); err != nil {
		return err
	}

	source := strings.TrimSpace(*sourceFlag)
	if source == "" && sourcePositional != "" {
		source = sourcePositional
	}
	if source == "" && fs.NArg() > 0 {
		source = strings.TrimSpace(fs.Arg(0))
	}
	if source == "" {
		return fmt.Errorf("source is required")
	}
	token := strings.TrimSpace(*tokenRaw)
	if token == "" {
		token = strings.TrimSpace(os.Getenv("GITHUB_TOKEN"))
	}

	modsDir, err := resolveModsDir(*modsDirRaw)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(modsDir, 0o755); err != nil {
		return fmt.Errorf("create mods dir: %w", err)
	}

	targetName := deriveInstallTargetName(source)
	if targetName == "" {
		return fmt.Errorf("invalid source: %s", source)
	}
	targetDir := filepath.Join(modsDir, targetName)
	if _, err := os.Stat(targetDir); err == nil {
		return fmt.Errorf("target mod directory already exists: %s", targetDir)
	}

	resolved, err := resolveInstallSource(
		source,
		strings.TrimSpace(*apiBase),
		token,
		strings.TrimSpace(*modCircleRepoRaw),
		strings.TrimSpace(*modCircleRef),
		*strictID,
	)
	if err != nil {
		return err
	}
	defer resolved.cleanup()

	if err := copyDirectory(resolved.sourceDir, targetDir); err != nil {
		_ = os.RemoveAll(targetDir)
		return fmt.Errorf("copy mod source: %w", err)
	}

	manifest, err := loadManifest(targetDir)
	if err != nil {
		_ = os.RemoveAll(targetDir)
		return fmt.Errorf("MOD_INSTALL_MANIFEST_NOT_FOUND: actionHint=ensure_mod_manifest_exists_in_source: %w", err)
	}
	manifest = normalizeManifest(manifest, targetDir)
	source = resolved.normalizedSource

	installedAt := time.Now().UTC().Format(time.RFC3339Nano)
	metadata := modInstallMetadata{
		Source:      resolved.normalizedSource,
		InstalledAt: installedAt,
		Verified:    resolved.verified,
	}
	metadataRaw, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(targetDir, ".nimi-install.json"), metadataRaw, 0o644); err != nil {
		return fmt.Errorf("write install metadata: %w", err)
	}

	manifest = normalizeManifest(manifest, targetDir)
	if *jsonOutput {
		return writeJSON(map[string]any{
			"ok":           true,
			"mod_id":       manifest.ID,
			"name":         manifest.Name,
			"version":      manifest.Version,
			"source":       source,
			"verified":     metadata.Verified,
			"target_dir":   targetDir,
			"installed_at": installedAt,
		})
	}

	fmt.Printf("installed mod %s from %s -> %s\n", manifest.ID, source, targetDir)
	return nil
}

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

func runRuntimeModCreate(args []string) error {
	fs := flag.NewFlagSet("nimi mod create", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	dirRaw := fs.String("dir", ".", "target directory")
	name := fs.String("name", "My Mod", "display name")
	modID := fs.String("mod-id", "", "mod id, e.g. world.nimi.my-mod")
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	dir, err := filepath.Abs(strings.TrimSpace(*dirRaw))
	if err != nil {
		return err
	}
	if err := ensureDirEmptyOrMissing(dir); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		return fmt.Errorf("create src dir: %w", err)
	}

	normalizedName := strings.TrimSpace(*name)
	if normalizedName == "" {
		normalizedName = "My Mod"
	}
	normalizedID := strings.TrimSpace(*modID)
	if normalizedID == "" {
		normalizedID = "world.nimi." + slugify(normalizedName)
	}
	manifest := normalizeManifest(modManifest{
		ID:           normalizedID,
		Name:         normalizedName,
		Version:      "0.1.0",
		Description:  "Generated by nimi mod create",
		License:      "MIT",
		Capabilities: []string{"llm.text.generate"},
	}, dir)

	if err := writeManifestYAML(filepath.Join(dir, "mod.manifest.yaml"), manifest); err != nil {
		return fmt.Errorf("write manifest: %w", err)
	}

	packageJSON := map[string]any{
		"name":    slugify(manifest.Name),
		"private": true,
		"type":    "module",
		"version": manifest.Version,
		"scripts": map[string]any{
			"build": "nimi mod build --dir .",
			"dev":   "nimi mod dev --dir . --watch",
		},
	}
	if err := writeJSONFile(filepath.Join(dir, "package.json"), packageJSON); err != nil {
		return fmt.Errorf("write package.json: %w", err)
	}

	tsconfig := map[string]any{
		"compilerOptions": map[string]any{
			"target":           "ES2022",
			"module":           "ESNext",
			"moduleResolution": "Bundler",
			"strict":           true,
			"noEmit":           false,
			"outDir":           "dist",
		},
		"include": []string{"src/**/*.ts"},
	}
	if err := writeJSONFile(filepath.Join(dir, "tsconfig.json"), tsconfig); err != nil {
		return fmt.Errorf("write tsconfig.json: %w", err)
	}

	source := fmt.Sprintf("export const modId = '%s';\n\nexport function setup() {\n  return { ok: true, modId };\n}\n", manifest.ID)
	if err := os.WriteFile(filepath.Join(dir, "src", "index.ts"), []byte(source), 0o644); err != nil {
		return fmt.Errorf("write src/index.ts: %w", err)
	}

	if *jsonOutput {
		return writeJSON(map[string]any{
			"ok":       true,
			"mod_id":   manifest.ID,
			"name":     manifest.Name,
			"dir":      dir,
			"manifest": filepath.Join(dir, "mod.manifest.yaml"),
		})
	}

	fmt.Printf("created mod scaffold at %s (mod_id=%s)\n", dir, manifest.ID)
	return nil
}

func runRuntimeModDev(args []string) error {
	fs := flag.NewFlagSet("nimi mod dev", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	dirRaw := fs.String("dir", ".", "mod project directory")
	watch := fs.Bool("watch", false, "watch source and rebuild on change")
	intervalRaw := fs.String("interval", "1500ms", "watch polling interval")
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	dir, err := filepath.Abs(strings.TrimSpace(*dirRaw))
	if err != nil {
		return err
	}

	bundlePath, hash, _, err := buildModBundle(dir)
	if err != nil {
		return err
	}

	if !*watch {
		if *jsonOutput {
			return writeJSON(map[string]any{
				"ok":          true,
				"mode":        "oneshot",
				"dir":         dir,
				"bundle_path": bundlePath,
				"bundle_hash": "sha256:" + hash,
			})
		}
		fmt.Printf("dev build complete: %s (sha256:%s)\n", bundlePath, hash)
		return nil
	}

	interval, err := time.ParseDuration(*intervalRaw)
	if err != nil {
		return fmt.Errorf("parse interval: %w", err)
	}
	if interval < 200*time.Millisecond {
		interval = 200 * time.Millisecond
	}

	sourcePath, err := resolvePrimarySourceFile(dir)
	if err != nil {
		return err
	}
	currentSourceHash, err := readSHA256Hex(sourcePath)
	if err != nil {
		return err
	}

	if *jsonOutput {
		_ = writeJSON(map[string]any{
			"ok":          true,
			"mode":        "watch",
			"dir":         dir,
			"bundle_path": bundlePath,
			"bundle_hash": "sha256:" + hash,
			"source":      sourcePath,
			"interval":    interval.String(),
		})
	} else {
		fmt.Printf("watching %s every %s\n", sourcePath, interval)
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(sigCh)

	for {
		select {
		case <-sigCh:
			return nil
		case <-ticker.C:
			nextHash, hashErr := readSHA256Hex(sourcePath)
			if hashErr != nil {
				continue
			}
			if nextHash == currentSourceHash {
				continue
			}
			currentSourceHash = nextHash
			bundlePath, hash, _, err = buildModBundle(dir)
			if err != nil {
				fmt.Fprintf(os.Stderr, "rebuild failed: %v\n", err)
				continue
			}
			if *jsonOutput {
				_ = writeJSON(map[string]any{
					"ok":          true,
					"event":       "rebuilt",
					"bundle_path": bundlePath,
					"bundle_hash": "sha256:" + hash,
				})
			} else {
				fmt.Printf("rebuilt: %s (sha256:%s)\n", bundlePath, hash)
			}
		}
	}
}

func runRuntimeModBuild(args []string) error {
	fs := flag.NewFlagSet("nimi mod build", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	dirRaw := fs.String("dir", ".", "mod project directory")
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	dir, err := filepath.Abs(strings.TrimSpace(*dirRaw))
	if err != nil {
		return err
	}

	bundlePath, hash, bytesWritten, err := buildModBundle(dir)
	if err != nil {
		return err
	}

	if *jsonOutput {
		return writeJSON(map[string]any{
			"ok":            true,
			"dir":           dir,
			"bundle_path":   bundlePath,
			"bundle_hash":   "sha256:" + hash,
			"bytes_written": bytesWritten,
		})
	}

	fmt.Printf("built mod bundle: %s (sha256:%s)\n", bundlePath, hash)
	return nil
}

func runRuntimeModPublish(args []string) error {
	fs := flag.NewFlagSet("nimi mod publish", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	dirRaw := fs.String("dir", ".", "mod project directory")
	sourceRepoRaw := fs.String("source-repo", "", "source mod repo owner/name")
	author := fs.String("author", strings.TrimSpace(os.Getenv("GITHUB_ACTOR")), "mod author")
	modCircleRepoRaw := fs.String("mod-circle-repo", defaultModCircleRepo, "mod circle repo owner/name")
	base := fs.String("base", "main", "base branch")
	branchPrefix := fs.String("branch-prefix", "nimi-mod", "publish branch prefix")
	title := fs.String("title", "", "pull request title")
	body := fs.String("body", "", "pull request body")
	apiBase := fs.String("api-base", resolveGitHubAPIBase(), "GitHub API base URL")
	tokenRaw := fs.String("token", "", "GitHub token (default: $GITHUB_TOKEN)")
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	dir, err := filepath.Abs(strings.TrimSpace(*dirRaw))
	if err != nil {
		return err
	}
	sourceRepo := strings.TrimSpace(*sourceRepoRaw)
	if sourceRepo == "" {
		return fmt.Errorf("MOD_PUBLISH_SOURCE_REPO_REQUIRED: actionHint=pass_--source-repo_owner_repo")
	}
	if _, _, _, err := parseGitHubRepoReference(sourceRepo); err != nil {
		return fmt.Errorf("invalid source-repo: %w", err)
	}

	token := strings.TrimSpace(*tokenRaw)
	if token == "" {
		token = strings.TrimSpace(os.Getenv("GITHUB_TOKEN"))
	}
	if token == "" {
		return fmt.Errorf("MOD_PUBLISH_GITHUB_TOKEN_MISSING: actionHint=export_GITHUB_TOKEN_then_retry")
	}

	manifest, err := loadManifest(dir)
	if err != nil {
		return fmt.Errorf("load manifest: %w", err)
	}
	manifest = normalizeManifest(manifest, dir)

	_, bundleHash, _, err := buildModBundle(dir)
	if err != nil {
		return err
	}

	entry := map[string]any{
		"id":                manifest.ID,
		"name":              manifest.Name,
		"description":       manifest.Description,
		"author":            defaultString(strings.TrimSpace(*author), "unknown"),
		"repo":              "github:" + normalizeGitHubRepoToken(sourceRepo),
		"minDesktopVersion": "0.1.0",
		"capabilities":      manifest.Capabilities,
		"tags":              []string{},
		"license":           manifest.License,
		"verified":          false,
		"addedAt":           time.Now().UTC().Format("2006-01-02"),
	}
	entryRaw, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return err
	}

	owner, repo, _, err := parseGitHubRepoReference(*modCircleRepoRaw)
	if err != nil {
		return fmt.Errorf("invalid mod-circle-repo: %w", err)
	}

	prefix := strings.Trim(strings.TrimSpace(*branchPrefix), "/")
	if prefix == "" {
		prefix = "nimi-mod"
	}
	branch := fmt.Sprintf("%s/%s-%d", prefix, slugify(manifest.ID), time.Now().UTC().Unix())
	indexPath := fmt.Sprintf("mods/%s.json", manifest.ID)

	client := newGitHubRESTClient(strings.TrimSpace(*apiBase), token)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	baseSHA, err := client.getBranchSHA(ctx, owner, repo, strings.TrimSpace(*base))
	if err != nil {
		return err
	}
	if err := client.createBranch(ctx, owner, repo, branch, baseSHA); err != nil {
		return err
	}
	if err := client.putFile(ctx, owner, repo, indexPath, branch, "mod: add "+manifest.ID, entryRaw); err != nil {
		return err
	}

	prTitle := strings.TrimSpace(*title)
	if prTitle == "" {
		prTitle = fmt.Sprintf("mod: add %s", manifest.ID)
	}
	prBody := strings.TrimSpace(*body)
	if prBody == "" {
		prBody = fmt.Sprintf("source repo: github:%s\nmanifest: %s\nbundle hash: sha256:%s", normalizeGitHubRepoToken(sourceRepo), manifest.ID, bundleHash)
	}

	pr, err := client.createPullRequest(ctx, owner, repo, prTitle, branch, strings.TrimSpace(*base), prBody)
	if err != nil {
		return err
	}

	result := modPublishResult{
		Repo:       owner + "/" + repo,
		Branch:     branch,
		PRNumber:   pr.Number,
		PRURL:      pr.HTMLURL,
		IndexPath:  indexPath,
		BundleHash: "sha256:" + bundleHash,
	}

	if *jsonOutput {
		return writeJSON(result)
	}
	fmt.Printf("created mod circle PR: #%d %s\n", result.PRNumber, result.PRURL)
	return nil
}

func resolveModsDir(raw string) (string, error) {
	if value := strings.TrimSpace(raw); value != "" {
		return filepath.Clean(value), nil
	}
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_MODS_DIR")); value != "" {
		return filepath.Clean(value), nil
	}
	return "", fmt.Errorf("MODS_DIR_REQUIRED: actionHint=set_--mods-dir_or_NIMI_RUNTIME_MODS_DIR")
}

func resolveGitHubAPIBase() string {
	if value := strings.TrimSpace(os.Getenv("GITHUB_API_URL")); value != "" {
		return value
	}
	return defaultGitHubAPIBase
}

func listInstalledMods(modsDir string) ([]modListItem, error) {
	entries, err := os.ReadDir(modsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []modListItem{}, nil
		}
		return nil, fmt.Errorf("read mods dir: %w", err)
	}

	items := make([]modListItem, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		modPath := filepath.Join(modsDir, entry.Name())
		manifest, err := loadManifest(modPath)
		if err != nil {
			manifest = normalizeManifest(modManifest{Name: titleFromSlug(entry.Name())}, modPath)
		}
		metadata := readInstallMetadata(modPath)
		items = append(items, modListItem{
			ModID:        manifest.ID,
			Name:         manifest.Name,
			Version:      manifest.Version,
			Path:         modPath,
			Source:       metadata.Source,
			InstalledAt:  metadata.InstalledAt,
			Verified:     metadata.Verified,
			Capabilities: append([]string(nil), manifest.Capabilities...),
		})
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].ModID < items[j].ModID
	})
	return items, nil
}

func readInstallMetadata(modPath string) modInstallMetadata {
	path := filepath.Join(modPath, ".nimi-install.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return modInstallMetadata{}
	}
	var metadata modInstallMetadata
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return modInstallMetadata{}
	}
	return metadata
}

func ensureDirEmptyOrMissing(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if len(entries) > 0 {
		return fmt.Errorf("directory is not empty: %s", dir)
	}
	return nil
}

func buildModBundle(modDir string) (string, string, int, error) {
	if _, err := os.Stat(modDir); err != nil {
		return "", "", 0, fmt.Errorf("mod dir not found: %w", err)
	}
	manifest, err := loadManifest(modDir)
	if err != nil {
		return "", "", 0, fmt.Errorf("manifest required: %w", err)
	}
	manifest = normalizeManifest(manifest, modDir)

	sourcePath, err := resolvePrimarySourceFile(modDir)
	if err != nil {
		return "", "", 0, err
	}
	sourceRaw, err := os.ReadFile(sourcePath)
	if err != nil {
		return "", "", 0, fmt.Errorf("read source file: %w", err)
	}

	distDir := filepath.Join(modDir, "dist")
	if err := os.MkdirAll(distDir, 0o755); err != nil {
		return "", "", 0, fmt.Errorf("create dist dir: %w", err)
	}
	bundlePath := filepath.Join(distDir, "index.js")
	bundleRaw := []byte("// generated by nimi mod build\n" + string(sourceRaw))
	if err := os.WriteFile(bundlePath, bundleRaw, 0o644); err != nil {
		return "", "", 0, fmt.Errorf("write bundle: %w", err)
	}

	sum := sha256.Sum256(bundleRaw)
	hash := fmt.Sprintf("%x", sum[:])
	if err := updateManifestHash(modDir, hash); err != nil {
		return "", "", 0, fmt.Errorf("update manifest hash: %w", err)
	}

	buildMeta := map[string]any{
		"mod_id":      manifest.ID,
		"built_at":    time.Now().UTC().Format(time.RFC3339Nano),
		"bundle_path": bundlePath,
		"bundle_hash": "sha256:" + hash,
	}
	if err := writeJSONFile(filepath.Join(modDir, ".nimi-build.json"), buildMeta); err != nil {
		return "", "", 0, fmt.Errorf("write build metadata: %w", err)
	}

	return bundlePath, hash, len(bundleRaw), nil
}

func resolvePrimarySourceFile(modDir string) (string, error) {
	candidates := []string{
		filepath.Join(modDir, "src", "index.ts"),
		filepath.Join(modDir, "src", "main.ts"),
		filepath.Join(modDir, "index.ts"),
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("mod source file not found (expected src/index.ts)")
}

func loadManifest(modDir string) (modManifest, error) {
	jsonPath := filepath.Join(modDir, "mod.manifest.json")
	if raw, err := os.ReadFile(jsonPath); err == nil {
		manifest, parseErr := parseManifestJSON(raw)
		if parseErr != nil {
			return modManifest{}, parseErr
		}
		return normalizeManifest(manifest, modDir), nil
	}

	yamlCandidates := []string{
		filepath.Join(modDir, "mod.manifest.yaml"),
		filepath.Join(modDir, "mod.manifest.yml"),
	}
	for _, candidate := range yamlCandidates {
		if raw, err := os.ReadFile(candidate); err == nil {
			manifest := parseManifestYAML(raw)
			return normalizeManifest(manifest, modDir), nil
		}
	}
	return modManifest{}, fmt.Errorf("manifest not found in %s", modDir)
}

func parseManifestJSON(raw []byte) (modManifest, error) {
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return modManifest{}, fmt.Errorf("parse mod.manifest.json: %w", err)
	}
	manifest := modManifest{
		ID:          asManifestString(payload["id"]),
		Name:        asManifestString(payload["name"]),
		Version:     asManifestString(payload["version"]),
		Description: asManifestString(payload["description"]),
		License:     asManifestString(payload["license"]),
	}
	manifest.Capabilities = asManifestStringSlice(payload["capabilities"])
	return manifest, nil
}

func parseManifestYAML(raw []byte) modManifest {
	lines := strings.Split(string(raw), "\n")
	manifest := modManifest{}
	capabilities := make([]string, 0)
	inCapabilities := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		if strings.HasPrefix(trimmed, "capabilities:") {
			inCapabilities = true
			continue
		}
		if inCapabilities {
			if strings.HasPrefix(trimmed, "-") {
				item := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
				item = trimQuotes(item)
				if item != "" {
					capabilities = append(capabilities, item)
				}
				continue
			}
			if !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
				inCapabilities = false
			}
		}

		key, value, ok := strings.Cut(trimmed, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = trimQuotes(strings.TrimSpace(value))
		switch key {
		case "id":
			manifest.ID = value
		case "name":
			manifest.Name = value
		case "version":
			manifest.Version = value
		case "description":
			manifest.Description = value
		case "license":
			manifest.License = value
		}
	}

	manifest.Capabilities = capabilities
	return manifest
}

func normalizeManifest(manifest modManifest, modDir string) modManifest {
	fallbackName := titleFromSlug(filepath.Base(modDir))
	if strings.TrimSpace(manifest.Name) == "" {
		manifest.Name = fallbackName
	}
	if strings.TrimSpace(manifest.ID) == "" {
		manifest.ID = "world.nimi." + slugify(manifest.Name)
	}
	if strings.TrimSpace(manifest.Version) == "" {
		manifest.Version = "0.1.0"
	}
	if strings.TrimSpace(manifest.Description) == "" {
		manifest.Description = "Nimi mod"
	}
	if strings.TrimSpace(manifest.License) == "" {
		manifest.License = "MIT"
	}
	if manifest.Capabilities == nil {
		manifest.Capabilities = []string{}
	}
	return manifest
}

func writeManifestYAML(path string, manifest modManifest) error {
	manifest = normalizeManifest(manifest, filepath.Dir(path))
	lines := []string{
		"id: " + manifest.ID,
		"name: " + manifest.Name,
		"version: " + manifest.Version,
		"description: " + manifest.Description,
		"entry: ./dist/index.js",
		"license: " + manifest.License,
	}
	if len(manifest.Capabilities) > 0 {
		lines = append(lines, "capabilities:")
		for _, capability := range manifest.Capabilities {
			trimmed := strings.TrimSpace(capability)
			if trimmed == "" {
				continue
			}
			lines = append(lines, "  - "+trimmed)
		}
	}
	content := strings.Join(lines, "\n") + "\n"
	return os.WriteFile(path, []byte(content), 0o644)
}

func updateManifestHash(modDir string, hash string) error {
	jsonPath := filepath.Join(modDir, "mod.manifest.json")
	if raw, err := os.ReadFile(jsonPath); err == nil {
		var payload map[string]any
		if err := json.Unmarshal(raw, &payload); err != nil {
			return err
		}
		payload["hash"] = "sha256:" + hash
		return writeJSONFile(jsonPath, payload)
	}

	yamlCandidates := []string{
		filepath.Join(modDir, "mod.manifest.yaml"),
		filepath.Join(modDir, "mod.manifest.yml"),
	}
	for _, candidate := range yamlCandidates {
		raw, err := os.ReadFile(candidate)
		if err != nil {
			continue
		}
		lines := strings.Split(string(raw), "\n")
		replaced := false
		for idx, line := range lines {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "hash:") {
				lines[idx] = "hash: sha256:" + hash
				replaced = true
				break
			}
		}
		if !replaced {
			if len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
				lines = lines[:len(lines)-1]
			}
			lines = append(lines, "hash: sha256:"+hash)
		}
		updated := strings.Join(lines, "\n")
		if !strings.HasSuffix(updated, "\n") {
			updated += "\n"
		}
		return os.WriteFile(candidate, []byte(updated), 0o644)
	}
	return fmt.Errorf("manifest file not found for hash update")
}

func resolveExistingDir(value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", false
	}
	if strings.HasPrefix(trimmed, "github:") || strings.HasPrefix(trimmed, "https://github.com/") {
		return "", false
	}
	if strings.Contains(trimmed, "/") || strings.Contains(trimmed, "\\") {
		if info, err := os.Stat(trimmed); err == nil && info.IsDir() {
			abs, _ := filepath.Abs(trimmed)
			if abs != "" {
				return abs, true
			}
			return trimmed, true
		}
	}
	if info, err := os.Stat(trimmed); err == nil && info.IsDir() {
		abs, _ := filepath.Abs(trimmed)
		if abs != "" {
			return abs, true
		}
		return trimmed, true
	}
	return "", false
}

func copyDirectory(source string, destination string) error {
	return filepath.WalkDir(source, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		targetPath := filepath.Join(destination, rel)
		if d.IsDir() {
			return os.MkdirAll(targetPath, 0o755)
		}
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return err
		}
		return os.WriteFile(targetPath, data, 0o644)
	})
}

func deriveInstallTargetName(source string) string {
	if localDir, ok := resolveExistingDir(source); ok {
		return slugify(filepath.Base(localDir))
	}
	if modCircleSelector, ok := parseModCircleInstallSelector(source); ok {
		return slugify(modCircleSelector)
	}
	owner, repo, subpath, err := parseGitHubRepoReference(source)
	if err != nil {
		return ""
	}
	if subpath != "" {
		parts := strings.Split(subpath, "/")
		last := strings.TrimSpace(parts[len(parts)-1])
		if last != "" {
			return slugify(last)
		}
	}
	if repo != "" {
		return slugify(repo)
	}
	return slugify(owner)
}

func parseGitHubRepoReference(raw string) (string, string, string, error) {
	normalized := normalizeGitHubRepoToken(raw)
	parts := strings.Split(normalized, "/")
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		clean = append(clean, trimmed)
	}
	if len(clean) < 2 {
		return "", "", "", fmt.Errorf("invalid GitHub repo reference %q (expected owner/repo)", raw)
	}
	owner := clean[0]
	repo := strings.TrimSuffix(clean[1], ".git")
	subpath := ""
	if len(clean) > 2 {
		subpath = strings.Join(clean[2:], "/")
	}
	if owner == "" || repo == "" {
		return "", "", "", fmt.Errorf("invalid GitHub repo reference %q", raw)
	}
	return owner, repo, subpath, nil
}

func normalizeGitHubRepoToken(raw string) string {
	normalized := strings.TrimSpace(raw)
	normalized = strings.TrimPrefix(normalized, "github:")
	normalized = strings.TrimPrefix(normalized, "https://github.com/")
	normalized = strings.TrimPrefix(normalized, "http://github.com/")
	normalized = strings.TrimSuffix(normalized, ".git")
	normalized = strings.Trim(normalized, "/")
	return normalized
}

func writeJSON(value any) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(raw))
	return nil
}

func writeJSONFile(path string, value any) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o644)
}

func readSHA256Hex(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return fmt.Sprintf("%x", sum[:]), nil
}

func asManifestString(value any) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	default:
		return ""
	}
}

func asManifestStringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		if casted, ok := value.([]string); ok {
			out := make([]string, 0, len(casted))
			for _, item := range casted {
				trimmed := strings.TrimSpace(item)
				if trimmed == "" {
					continue
				}
				out = append(out, trimmed)
			}
			return out
		}
		return []string{}
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		trimmed := asManifestString(item)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}

func slugify(input string) string {
	trimmed := strings.ToLower(strings.TrimSpace(input))
	if trimmed == "" {
		return "mod"
	}
	replacer := strings.NewReplacer(
		" ", "-",
		"_", "-",
		"/", "-",
		"\\", "-",
		".", "-",
		":", "-",
	)
	trimmed = replacer.Replace(trimmed)
	builder := strings.Builder{}
	lastDash := false
	for _, char := range trimmed {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteRune('-')
			lastDash = true
		}
	}
	result := strings.Trim(builder.String(), "-")
	if result == "" {
		return "mod"
	}
	return result
}

func titleFromSlug(input string) string {
	parts := strings.Split(slugify(input), "-")
	words := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "" {
			continue
		}
		words = append(words, strings.ToUpper(part[:1])+part[1:])
	}
	if len(words) == 0 {
		return "My Mod"
	}
	return strings.Join(words, " ")
}

func trimQuotes(input string) string {
	trimmed := strings.TrimSpace(input)
	trimmed = strings.TrimPrefix(trimmed, `"`)
	trimmed = strings.TrimSuffix(trimmed, `"`)
	trimmed = strings.TrimPrefix(trimmed, "'")
	trimmed = strings.TrimSuffix(trimmed, "'")
	return strings.TrimSpace(trimmed)
}

func defaultString(input string, fallback string) string {
	if strings.TrimSpace(input) == "" {
		return fallback
	}
	return input
}

type githubRESTClient struct {
	baseURL string
	token   string
	client  *http.Client
}

type githubPullRequest struct {
	Number  int    `json:"number"`
	HTMLURL string `json:"html_url"`
}

type githubContentItem struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Type string `json:"type"`
}

type githubContentFile struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Content  string `json:"content"`
	Encoding string `json:"encoding"`
}

func newGitHubRESTClient(baseURL string, token string) *githubRESTClient {
	normalized := strings.TrimSpace(baseURL)
	if normalized == "" {
		normalized = defaultGitHubAPIBase
	}
	return &githubRESTClient{
		baseURL: strings.TrimRight(normalized, "/"),
		token:   strings.TrimSpace(token),
		client: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

func (c *githubRESTClient) getBranchSHA(ctx context.Context, owner string, repo string, branch string) (string, error) {
	var payload struct {
		Object struct {
			SHA string `json:"sha"`
		} `json:"object"`
	}
	if err := c.do(ctx, http.MethodGet, fmt.Sprintf("/repos/%s/%s/git/ref/heads/%s", owner, repo, branch), nil, &payload); err != nil {
		return "", fmt.Errorf("resolve base branch sha failed: %w", err)
	}
	if strings.TrimSpace(payload.Object.SHA) == "" {
		return "", fmt.Errorf("resolve base branch sha failed: empty sha")
	}
	return payload.Object.SHA, nil
}

func (c *githubRESTClient) createBranch(ctx context.Context, owner string, repo string, branch string, sha string) error {
	body := map[string]any{
		"ref": "refs/heads/" + branch,
		"sha": sha,
	}
	if err := c.do(ctx, http.MethodPost, fmt.Sprintf("/repos/%s/%s/git/refs", owner, repo), body, nil); err != nil {
		return fmt.Errorf("create publish branch failed: %w", err)
	}
	return nil
}

func (c *githubRESTClient) putFile(ctx context.Context, owner string, repo string, path string, branch string, message string, content []byte) error {
	body := map[string]any{
		"message": message,
		"content": base64.StdEncoding.EncodeToString(content),
		"branch":  branch,
	}
	if err := c.do(ctx, http.MethodPut, fmt.Sprintf("/repos/%s/%s/contents/%s", owner, repo, path), body, nil); err != nil {
		return fmt.Errorf("commit mod index file failed: %w", err)
	}
	return nil
}

func (c *githubRESTClient) createPullRequest(ctx context.Context, owner string, repo string, title string, head string, base string, body string) (githubPullRequest, error) {
	request := map[string]any{
		"title": title,
		"head":  head,
		"base":  base,
		"body":  body,
	}
	var response githubPullRequest
	if err := c.do(ctx, http.MethodPost, fmt.Sprintf("/repos/%s/%s/pulls", owner, repo), request, &response); err != nil {
		return githubPullRequest{}, fmt.Errorf("create mod circle pull request failed: %w", err)
	}
	if response.Number <= 0 || strings.TrimSpace(response.HTMLURL) == "" {
		return githubPullRequest{}, fmt.Errorf("create mod circle pull request failed: invalid response")
	}
	return response, nil
}

func (c *githubRESTClient) listDirectory(ctx context.Context, owner string, repo string, path string, ref string) ([]githubContentItem, error) {
	query := ""
	if strings.TrimSpace(ref) != "" {
		query = "?ref=" + url.QueryEscape(strings.TrimSpace(ref))
	}
	endpoint := fmt.Sprintf("/repos/%s/%s/contents/%s%s", owner, repo, strings.Trim(path, "/"), query)
	var response []githubContentItem
	if err := c.do(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, fmt.Errorf("list directory failed: %w", err)
	}
	return response, nil
}

func (c *githubRESTClient) getFileContent(ctx context.Context, owner string, repo string, path string, ref string) ([]byte, error) {
	query := ""
	if strings.TrimSpace(ref) != "" {
		query = "?ref=" + url.QueryEscape(strings.TrimSpace(ref))
	}
	endpoint := fmt.Sprintf("/repos/%s/%s/contents/%s%s", owner, repo, strings.Trim(path, "/"), query)
	var response githubContentFile
	if err := c.do(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, fmt.Errorf("fetch file content failed: %w", err)
	}
	if strings.TrimSpace(response.Encoding) != "base64" {
		return nil, fmt.Errorf("fetch file content failed: unsupported encoding=%s", response.Encoding)
	}
	normalized := strings.ReplaceAll(response.Content, "\n", "")
	normalized = strings.TrimSpace(normalized)
	content, err := base64.StdEncoding.DecodeString(normalized)
	if err != nil {
		return nil, fmt.Errorf("fetch file content failed: decode base64: %w", err)
	}
	return content, nil
}

func (c *githubRESTClient) do(ctx context.Context, method string, path string, requestBody any, responseBody any) error {
	var bodyReader io.Reader
	if requestBody != nil {
		raw, err := json.Marshal(requestBody)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(raw)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bodyReader)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if c.token != "" {
		request.Header.Set("Authorization", "Bearer "+c.token)
	}

	response, err := c.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("status=%d body=%s", response.StatusCode, strings.TrimSpace(string(raw)))
	}
	if responseBody == nil || len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, responseBody); err != nil {
		return err
	}
	return nil
}
