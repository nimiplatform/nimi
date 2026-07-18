//go:build windows

package protectedlocal

import "strconv"

// PlatformLocalDevelopmentDiagnosticStage projects only bounded stage names;
// native causes can contain paths, identities, and token details and must not
// cross the protected transport.
func PlatformLocalDevelopmentDiagnosticStage(err error) (string, bool) {
	if stage, ok := WindowsProcessTrustStageFromError(err); ok {
		return "bind-process-trust-" + strconv.FormatUint(uint64(stage), 10), true
	}
	if stage, ok := WindowsPipeStageFromError(err); ok {
		return "bind-pipe-" + strconv.FormatUint(uint64(stage), 10), true
	}
	if stage, ok := WindowsLocalDevelopmentPolicyStageFromError(err); ok {
		return "bind-policy-" + string(stage), true
	}
	return "", false
}
