//go:build !windows

package localservice

import "testing"

func TestStatfsAvailBytesRejectsOverflowAndInvalidBlockSize(t *testing.T) {
	if got := statfsAvailBytes(10, 0); got != 0 {
		t.Fatalf("statfsAvailBytes invalid block size = %d, want 0", got)
	}
	maxInt64 := int64(^uint64(0) >> 1)
	if got := statfsAvailBytes(uint64(maxInt64), 2); got != 0 {
		t.Fatalf("statfsAvailBytes overflow case = %d, want 0", got)
	}
	if got := statfsAvailBytes(4, 1024); got != 4096 {
		t.Fatalf("statfsAvailBytes normal case = %d, want 4096", got)
	}
}
