//go:build !windows

package engine

func managedCommandArguments(arguments []string) []string {
	return arguments
}

func managedCommandExecutablePath(path string) string {
	return path
}
