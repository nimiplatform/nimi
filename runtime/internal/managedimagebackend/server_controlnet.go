package managedimagebackend

import (
	"regexp"
	"slices"
)

var nativeImageJobID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func validManagedControlType(value string) bool {
	return slices.Contains([]string{"openpose", "depth", "scribble", "canny", "normal", "segment", "tile", "repaint"}, value)
}
