//go:build !windows

package engine

func managedPythonBuildEnvironment(venvRoot string) (map[string]string, error) {
	return managedPythonRuntimeEnv(venvRoot), nil
}
