package daemon

import "github.com/nimiplatform/nimi/runtime/internal/engine"

func (d *Daemon) detectMediaHostSupport() (engine.MediaHostSupport, string) {
	if d != nil && d.detectMediaHostSupportFn != nil {
		return d.detectMediaHostSupportFn()
	}
	return engine.DetectMediaHostSupport()
}

func (d *Daemon) detectManagedImageSupervised() bool {
	if d != nil && d.detectManagedImageSupervisedFn != nil {
		return d.detectManagedImageSupervisedFn()
	}
	return engine.LlamaImageSupervisedPlatformSupported()
}
