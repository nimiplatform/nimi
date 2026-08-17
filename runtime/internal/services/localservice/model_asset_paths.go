package localservice

import (
	"fmt"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
)

const localAssetManifestFileName = "asset.manifest.json"

func validateManagedLogicalModelID(logicalModelID string) error {
	value := strings.TrimSpace(logicalModelID)
	if value == "" || value != logicalModelID {
		return fmt.Errorf("logical_model_id must be a non-empty canonical relative identifier")
	}
	if strings.ContainsAny(value, "\\:\x00") || path.IsAbs(value) {
		return fmt.Errorf("logical_model_id must not contain an absolute or platform-specific path")
	}
	if path.Clean(value) != value {
		return fmt.Errorf("logical_model_id must not contain path traversal or non-canonical segments")
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == "" || segment == "." || segment == ".." || strings.HasSuffix(segment, ".") || strings.HasSuffix(segment, " ") || isWindowsReservedPathSegment(segment) {
			return fmt.Errorf("logical_model_id contains an invalid platform path segment")
		}
	}
	return nil
}

func isWindowsReservedPathSegment(segment string) bool {
	base := strings.ToUpper(strings.SplitN(segment, ".", 2)[0])
	switch base {
	case "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$":
		return true
	}
	return len(base) == 4 && (base[:3] == "COM" || base[:3] == "LPT") && base[3] >= '1' && base[3] <= '9'
}

func pathWithinBase(basePath string, candidatePath string, allowBase bool) bool {
	rel, err := filepath.Rel(basePath, candidatePath)
	if err != nil || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	return allowBase || (rel != "." && rel != "")
}

func resolveRuntimeManagedModelBundleDir(modelsRoot string, logicalModelID string) (string, error) {
	root := strings.TrimSpace(modelsRoot)
	if root == "" || !filepath.IsAbs(root) {
		return "", fmt.Errorf("runtime models root must be absolute")
	}
	if err := validateManagedLogicalModelID(logicalModelID); err != nil {
		return "", err
	}
	rootAbs, err := filepath.Abs(filepath.Clean(root))
	if err != nil {
		return "", fmt.Errorf("resolve runtime models root: %w", err)
	}
	resolvedRoot := filepath.Join(rootAbs, "resolved")
	target, err := filepath.Abs(filepath.Join(resolvedRoot, filepath.FromSlash(logicalModelID)))
	if err != nil || !pathWithinBase(resolvedRoot, target, false) {
		return "", fmt.Errorf("managed model bundle target must stay under resolved/")
	}
	canonicalRoot := rootAbs
	if resolved, resolveErr := filepath.EvalSymlinks(rootAbs); resolveErr == nil {
		canonicalRoot = resolved
	} else if !os.IsNotExist(resolveErr) {
		return "", fmt.Errorf("resolve runtime models root links: %w", resolveErr)
	}
	canonicalResolvedRoot := resolvedRoot
	if resolved, resolveErr := filepath.EvalSymlinks(resolvedRoot); resolveErr == nil {
		canonicalResolvedRoot = resolved
		if !pathWithinBase(canonicalRoot, canonicalResolvedRoot, false) {
			return "", fmt.Errorf("resolved models root escapes runtime models root")
		}
	} else if !os.IsNotExist(resolveErr) {
		return "", fmt.Errorf("resolve managed models directory links: %w", resolveErr)
	}
	current := resolvedRoot
	for _, segment := range strings.Split(logicalModelID, "/") {
		current = filepath.Join(current, segment)
		if _, statErr := os.Lstat(current); statErr != nil {
			if os.IsNotExist(statErr) {
				break
			}
			return "", fmt.Errorf("inspect managed model bundle target: %w", statErr)
		}
		resolvedCurrent, resolveErr := filepath.EvalSymlinks(current)
		if resolveErr != nil || !pathWithinBase(canonicalResolvedRoot, resolvedCurrent, true) {
			return "", fmt.Errorf("managed model bundle target escapes resolved/ through a link")
		}
	}
	return target, nil
}

func resolveManagedFileRepoPath(sourceRepo string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(sourceRepo))
	if err != nil {
		return "", err
	}
	value, err := url.PathUnescape(parsed.Path)
	if err != nil {
		return "", err
	}
	switch {
	case runtime.GOOS == "windows" && len(parsed.Host) == 2 && parsed.Host[1] == ':':
		value = parsed.Host + filepath.FromSlash(value)
	case parsed.Host != "" && parsed.Host != "localhost" && runtime.GOOS == "windows":
		value = `\\` + parsed.Host + filepath.FromSlash(value)
	case runtime.GOOS == "windows" && len(value) >= 3 && value[0] == '/' && value[2] == ':':
		value = value[1:]
	case parsed.Host != "" && parsed.Host != "localhost":
		value = string(filepath.Separator) + filepath.Join(parsed.Host, filepath.FromSlash(value))
	}
	return filepath.FromSlash(value), nil
}

func validateResolvedModelManifestPath(manifestPath string, modelsRoot string) error {
	manifest := filepath.Clean(strings.TrimSpace(manifestPath))
	root := filepath.Clean(strings.TrimSpace(modelsRoot))
	if manifest == "." || root == "." || !strings.EqualFold(filepath.Base(manifest), localAssetManifestFileName) {
		return fmt.Errorf("resolved ModelAsset manifest path is invalid")
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("models root invalid: %w", err)
		}
		resolvedRoot = root
	}
	resolvedManifest, err := filepath.EvalSymlinks(manifest)
	if err != nil {
		return fmt.Errorf("manifest path invalid: %w", err)
	}
	relative, err := filepath.Rel(resolvedRoot, resolvedManifest)
	if err != nil || relative == "." || relative == "" || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || !strings.HasPrefix(relative, "resolved"+string(filepath.Separator)) {
		return fmt.Errorf("manifest path must stay under runtime models root resolved/")
	}
	if parent := filepath.Dir(relative); parent == "resolved" || parent == "." {
		return fmt.Errorf("resolved manifest must live under a logical ModelAsset directory")
	}
	return nil
}
