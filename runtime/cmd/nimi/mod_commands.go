package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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
		return movedToNimiModError("create")
	case "dev":
		return movedToNimiModError("dev")
	case "build":
		return movedToNimiModError("build")
	case "publish":
		return movedToNimiModError("publish")
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
