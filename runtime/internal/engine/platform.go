package engine

import "runtime"

func currentGOOS() string {
	return runtime.GOOS
}

func currentGOARCH() string {
	return runtime.GOARCH
}

// CurrentGOOS returns the runtime OS for external callers.
func CurrentGOOS() string { return currentGOOS() }

// CurrentGOARCH returns the runtime architecture for external callers.
func CurrentGOARCH() string { return currentGOARCH() }
