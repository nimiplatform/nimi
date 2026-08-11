package localservice

import (
	"path/filepath"
	"runtime"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

// dependencyProfileExecutionHostIdentity is an in-process equality proof for
// a resident private Host. It deliberately includes both the canonical root
// and its immutable digest so a new selected profile can never reuse a worker
// merely because its capability, Driver, and port are unchanged.
func dependencyProfileExecutionHostIdentity(profileRoot string, acceleratorPlane string, driverIdentity string) string {
	root := filepath.Clean(strings.TrimSpace(profileRoot))
	if root == "." || !filepath.IsAbs(root) {
		return ""
	}
	if runtime.GOOS == "windows" {
		root = strings.ToLower(root)
	}
	digest := strings.TrimSpace(filepath.Base(root))
	plane := strings.ToLower(strings.TrimSpace(acceleratorPlane))
	driver := strings.TrimSpace(driverIdentity)
	if digest == "" || plane == "" || driver == "" {
		return ""
	}
	return strings.Join([]string{
		"profile_root=" + root,
		"profile_digest=" + digest,
		"accelerator_plane=" + plane,
		"driver=" + driver,
	}, "\n")
}

func speechExecutionHostIdentity(capabilityContract string, driverID string, cfg engine.EngineConfig) string {
	driverIdentity := "speech:" + strings.TrimSpace(capabilityContract) + ":" + strings.TrimSpace(driverID)
	return dependencyProfileExecutionHostIdentity(
		cfg.SpeechHostPackageSetRoot,
		cfg.SpeechHostAcceleratorPlane,
		driverIdentity,
	)
}

func mediaExecutionHostIdentity(cfg engine.EngineConfig) string {
	driverIdentity := "media:media_server.py:" + strings.TrimSpace(string(cfg.MediaMode))
	return dependencyProfileExecutionHostIdentity(
		cfg.MediaHostPackageSetRoot,
		cfg.MediaHostAcceleratorPlane,
		driverIdentity,
	)
}
