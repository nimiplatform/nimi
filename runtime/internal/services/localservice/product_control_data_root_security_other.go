//go:build !windows

package localservice

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func validateProductControlDataRootPlatform(root string, _ ProductControlDataRootSecurityBinding) error {
	cleaned := filepath.Clean(strings.TrimSpace(root))
	if cleaned == "." || !filepath.IsAbs(cleaned) || cleaned == string(filepath.Separator) {
		return fmt.Errorf("data root must be an absolute non-root path")
	}
	volume := filepath.VolumeName(cleaned)
	current := volume + string(filepath.Separator)
	for _, component := range strings.Split(strings.TrimPrefix(cleaned, current), string(filepath.Separator)) {
		if component == "" {
			continue
		}
		current = filepath.Join(current, component)
		info, err := os.Lstat(current)
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("data root component is not a direct directory")
		}
	}
	return nil
}
