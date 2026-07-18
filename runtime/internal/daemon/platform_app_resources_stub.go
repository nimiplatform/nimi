//go:build !windows && !darwin

package daemon

func protectedPlatformAppResourceBindings() (string, string, error) {
	return "", "", nil
}
