//go:build darwin && arm64 && cgo

package managedimagebackend

/*
#include <stdint.h>
*/
import "C"

import "runtime/cgo"

//export nimiSDVideoProgress
func nimiSDVideoProgress(handle C.uintptr_t, step, total C.int) {
	callback := cgo.Handle(handle).Value().(func(VideoGenerateProgress))
	callback(VideoGenerateProgress{CurrentStep: int32(step), TotalSteps: int32(total)})
}
