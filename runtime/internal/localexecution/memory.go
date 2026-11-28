package localexecution

import "strings"

// IsMemoryAllocationFailure recognizes explicit allocation failures from native
// inference engines. A CUDA function name alone may appear in ordinary logs.
func IsMemoryAllocationFailure(detail string) bool {
	text := strings.ToLower(detail)
	return strings.Contains(text, "out of memory") || strings.Contains(text, "cuda_error_out_of_memory") ||
		strings.Contains(text, "cudamalloc failed") || strings.Contains(text, "cudamalloc returned error 2") ||
		(strings.Contains(text, "ggml_backend_cuda_buffer_type_alloc_buffer") && strings.Contains(text, "failed to allocate"))
}
