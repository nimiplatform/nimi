//go:build darwin && nimi_macos_source_local_development

package protectedlocal

import (
	"github.com/nimiplatform/nimi/runtime/internal/devenv"
	"os"
	"path/filepath"
)

const (
	MacOSRequiredArchitecture                     = "arm64"
	MacOSRuntimeServiceLabel                      = "ai.nimi.runtime.source-local-development"
	MacOSRuntimeAccountName                       = ""
	MacOSDesktopExecutablePath                    = ""
	MacOSDesktopApplicationPath                   = ""
	MacOSLocalAppHostPath                         = ""
	MacOSDesktopSocketActivationName              = "DesktopControlSourceLocalDevelopment"
	MacOSLocalAppSocketActivationName             = "LocalAppHostSourceLocalDevelopment"
	MacOSRuntimeSigningIdentifier                 = ""
	MacOSDesktopSigningIdentifier                 = ""
	MacOSLocalAppHostIdentifier                   = ""
	macOSSourceLocalDevelopmentStateDirectoryName = "RuntimeLocalDevelopment"
	macOSSourceLocalDevelopmentDesktopSocketFile  = "runtime-desktop.sock"
	macOSSourceLocalDevelopmentLocalAppSocketFile = "runtime-local-app.sock"
)

var (
	MacOSRuntimeStateRoot      = macOSSourceLocalDevelopmentStateRootCandidate()
	MacOSDesktopSocketPath     = filepath.Join(filepath.Dir(MacOSRuntimeStateRoot), "run", macOSSourceLocalDevelopmentDesktopSocketFile)
	MacOSLocalAppSocketPath    = filepath.Join(filepath.Dir(MacOSRuntimeStateRoot), "run", macOSSourceLocalDevelopmentLocalAppSocketFile)
	MacOSRuntimeExecutablePath = macOSSourceLocalDevelopmentExecutableCandidate()
)

func macOSSourceLocalDevelopmentStateRootCandidate() string {
	home, err := os.UserHomeDir()
	if err != nil || !filepath.IsAbs(home) {
		return ""
	}
	root, err := devenv.StateRoot(filepath.Join(filepath.Clean(home), "Library", "Application Support", "Nimi", macOSSourceLocalDevelopmentStateDirectoryName))
	if err != nil {
		return ""
	}
	return root
}

func macOSSourceLocalDevelopmentExecutableCandidate() string {
	executable, err := os.Executable()
	if err != nil || !filepath.IsAbs(executable) {
		return ""
	}
	canonical, err := filepath.EvalSymlinks(executable)
	if err != nil {
		return ""
	}
	return filepath.Clean(canonical)
}
