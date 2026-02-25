//go:build windows

package localruntime

func diskFreeBytes(string) int64 {
	return 0
}
