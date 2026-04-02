package daemon

import "github.com/nimiplatform/nimi/runtime/internal/engine"

func (d *Daemon) detectMediaHostSupport() (engine.MediaHostSupport, string) {
	if d != nil && d.detectMediaHostSupportFn != nil {
		return d.detectMediaHostSupportFn()
	}
	return engine.DetectMediaHostSupport()
}

func (d *Daemon) managedImageBootstrapSelection() (engine.ImageSupervisedMatrixSelection, bool) {
	if d != nil && d.imageBootstrapSelectionFn != nil {
		return d.imageBootstrapSelectionFn()
	}
	if d != nil && d.grpc != nil {
		if svc := d.grpc.LocalService(); svc != nil {
			return svc.ManagedSupervisedImageBootstrapSelection()
		}
	}
	return engine.ImageSupervisedMatrixSelection{}, false
}

func (d *Daemon) cacheImageMatrix() {
	if selection, ok := d.managedImageBootstrapSelection(); ok {
		d.resolvedImageMatrix = &selection
		return
	}
	d.resolvedImageMatrix = nil
}
