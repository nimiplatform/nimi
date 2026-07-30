//go:build darwin && !cgo

package localservice

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func validateProductControlRootPlatform(_ string, security ProductControlDataRootSecurityBinding) error {
	if security.InteractiveUserUID != 0 || security.RuntimeServiceUID != 0 {
		return fmt.Errorf("macOS Product Control security validation requires cgo")
	}
	return nil
}

func validateProductControlDataRootPlatform(root string, security ProductControlDataRootSecurityBinding) error {
	if security.InteractiveUserUID != 0 || security.RuntimeServiceUID != 0 {
		return fmt.Errorf("macOS Product Control data-root security validation requires cgo")
	}
	cleaned := filepath.Clean(strings.TrimSpace(root))
	if cleaned == "." || !filepath.IsAbs(cleaned) || cleaned == string(filepath.Separator) {
		return fmt.Errorf("data root must be an absolute non-root path")
	}
	current := string(filepath.Separator)
	for _, component := range strings.Split(strings.TrimPrefix(cleaned, string(filepath.Separator)), string(filepath.Separator)) {
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
