//go:build !windows

package engine

func managedCommandExecutablePath(path string) string {
	return path
}
