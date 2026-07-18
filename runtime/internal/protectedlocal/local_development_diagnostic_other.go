//go:build !windows

package protectedlocal

// PlatformLocalDevelopmentDiagnosticStage deliberately has no portable
// fallback. Each admitted native carrier must project its own closed stage
// vocabulary instead of inheriting Windows implementation details.
func PlatformLocalDevelopmentDiagnosticStage(error) (string, bool) {
	return "", false
}
