//go:build !windows

package daemonctl

func shouldRetryFileRemove(error) bool {
	return false
}
