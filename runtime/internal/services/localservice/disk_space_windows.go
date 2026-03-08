//go:build windows

package localservice

func diskFreeBytes(string) int64 {
	return 0
}
