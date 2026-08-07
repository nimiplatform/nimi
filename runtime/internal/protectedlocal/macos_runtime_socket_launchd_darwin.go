//go:build darwin && cgo && !nimi_macos_source_local_development

package protectedlocal

import "net"

func openMacOSRuntimeSocket(name, expectedPath string, serviceUID uint32) (*net.UnixListener, error) {
	return activateMacOSLaunchdSocket(name, expectedPath, serviceUID)
}
