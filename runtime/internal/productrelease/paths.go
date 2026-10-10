package productrelease

import (
	"fmt"
	"path/filepath"
	"strings"
)

// This traversal is shared with the native ACL/reparse validator. Keeping the
// exact path arithmetic portable lets direct tests walk the real disk layout;
// the production caller still supplies only ProductRoot from KnownFolder.
func productPathChain(root, file string) (string, []string, error) {
	root, file = filepath.Clean(root), filepath.Clean(file)
	if !filepath.IsAbs(root) || !filepath.IsAbs(file) {
		return "", nil, fmt.Errorf("absolute product path required")
	}
	relative, err := filepath.Rel(root, file)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", nil, fmt.Errorf("product path outside fixed root")
	}
	parts := strings.Split(relative, string(filepath.Separator))
	if len(parts) < 2 {
		return "", nil, fmt.Errorf("product release root missing")
	}
	paths := []string{filepath.Dir(root), root}
	current := root
	for _, part := range parts {
		current = filepath.Join(current, part)
		paths = append(paths, current)
	}
	return filepath.Join(root, parts[0]), paths, nil
}
