//go:build (windows && nimi_windows_source_local_development) || (darwin && nimi_macos_source_local_development)

package daemon

import (
	"fmt"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
)

// sourceLocalDevelopmentPlatformAppResources binds the exact workspace
// selected and canonicalized by nimi-source-supervisor. It is compiled only
// into the isolated source-development Runtime and never into an installed
// Runtime service. The returned paths locate registered release inputs; they
// do not add App declaration coverage.
func sourceLocalDevelopmentPlatformAppResources() (string, string, error) {
	root := strings.TrimSpace(os.Getenv("NIMI_SOURCE_RUNTIME_REPO_ROOT"))
	if root == "" || !filepath.IsAbs(root) {
		return "", "", fmt.Errorf("source Runtime repository root is unavailable")
	}
	canonical, err := filepath.EvalSymlinks(filepath.Clean(root))
	if err != nil || !sameDaemonPath(canonical, root) {
		return "", "", fmt.Errorf("source Runtime repository root is not canonical")
	}
	identityProjection := filepath.Join(canonical, "config", "platform-nimi-app-identity-surfaces.yaml")
	bundledAppsRoot := filepath.Join(canonical, "apps")
	identityInfo, identityErr := os.Lstat(identityProjection)
	appsInfo, appsErr := os.Lstat(bundledAppsRoot)
	if identityErr != nil || identityInfo == nil || !identityInfo.Mode().IsRegular() || identityInfo.Mode()&os.ModeSymlink != 0 ||
		appsErr != nil || appsInfo == nil || !appsInfo.IsDir() || appsInfo.Mode()&os.ModeSymlink != 0 {
		return "", "", fmt.Errorf("source Runtime formal App resources are unavailable")
	}
	return identityProjection, bundledAppsRoot, nil
}

func sameDaemonPath(left string, right string) bool {
	left = filepath.Clean(left)
	right = filepath.Clean(right)
	if goruntime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}
