//go:build darwin && cgo && nimi_macos_source_local_development

package entrypoint

import (
	"github.com/nimiplatform/nimi/runtime/internal/devenv"
	"os"
)

// @nimi-authority: rule.nimi.platform.core-protocol.development-topology
func loadMacOSProtectedRealmEndpoints() (string, string, error) {
	_, realm, err := devenv.Resolve(os.Getenv)
	return realm.APIOrigin, realm.RealtimeOrigin, err
}
