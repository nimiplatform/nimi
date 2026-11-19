//go:build darwin && !nimi_macos_source_local_development

package daemon

import (
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func TestFixedMacOSBundledAppsStayInSelectedDesktop(t *testing.T) {
	for _, root := range []string{"/Applications/Nimi.app", "/Applications/Nimi Dev.app"} {
		resource := filepath.Join(root, "Contents", "Resources", "nimi-apps")
		_, err := validateMacOSProtectedResourcePath(resource, true)
		if root != protectedlocal.MacOSDesktopApplicationPath && err == nil {
			t.Fatalf("accepted bundled apps from another fixed Desktop: %s", root)
		}
	}
}
