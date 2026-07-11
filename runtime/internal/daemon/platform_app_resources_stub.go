//go:build !windows

package daemon

func protectedPlatformAppResourceBindings() (string, string, error) {
	return "", "", nil
}
