package managedimagebackend

import (
	"strings"
	"testing"
)

func TestResidentAllocationFailureSurvivesBoundedLogAndClearsBetweenRequests(t *testing.T) {
	var capture managedImageLogCapture
	capture.Append("ggml_backend_cuda_buffer_type_alloc_buffer: failed to allocate device buffer")
	capture.Append(strings.Repeat("progress ", 1024))
	if len(capture.String()) > 4096 || !capture.takeAllocationFailure() {
		t.Fatal("allocation failure lost when progress filled the diagnostic buffer")
	}
	capture.Append("starting CUDA inference")
	if capture.takeAllocationFailure() {
		t.Fatal("a later request inherited an earlier allocation failure")
	}
}
