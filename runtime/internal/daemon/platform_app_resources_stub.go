//go:build !windows && !darwin

package daemon

func protectedPlatformAppResourceBindings() (string, error) {
	return "", nil
}
