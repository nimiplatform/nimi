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
// Runtime service. The returned path locates registered App release inputs;
// it does not add App declaration coverage.
func sourceLocalDevelopmentPlatformAppResources() (string, error) {
	root := strings.TrimSpace(os.Getenv("NIMI_SOURCE_RUNTIME_REPO_ROOT"))
	if root == "" || !filepath.IsAbs(root) {
		return "", fmt.Errorf("source Runtime repository root is unavailable")
	}
	canonical, err := filepath.EvalSymlinks(filepath.Clean(root))
	if err != nil || !sameDaemonPath(canonical, root) {
		return "", fmt.Errorf("source Runtime repository root is not canonical")
	}
	bundledAppsRoot := filepath.Join(canonical, "apps")
	appsInfo, appsErr := os.Lstat(bundledAppsRoot)
	if appsErr != nil || appsInfo == nil || !appsInfo.IsDir() || appsInfo.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("source Runtime formal App resources are unavailable")
	}
	return bundledAppsRoot, nil
}

func sameDaemonPath(left string, right string) bool {
	left = filepath.Clean(left)
	right = filepath.Clean(right)
	if goruntime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}
