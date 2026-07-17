//go:build !windows

package engine

func managedCommandEnvironmentValue(value string) string {
	return value
}

func managedCommandPreferredPath(value string) string {
	return value
}

func managedCommandArguments(arguments []string) []string {
	return arguments
}

func managedCommandExecutablePath(path string) string {
	return path
}
