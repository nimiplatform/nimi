package engine

import "runtime"

func currentGOOS() string {
	return runtime.GOOS
}

func currentGOARCH() string {
	return runtime.GOARCH
}
