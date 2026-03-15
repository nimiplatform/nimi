package localservice

import (
	"runtime"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/localrouting"
)

func normalizeLocalRoutingCapability(capability string) string {
	return localrouting.NormalizeCapability(capability)
}

func localProviderPreferenceOrder(goos string, capability string) []string {
	return localrouting.PreferenceOrder(goos, capability)
}

func localProviderPreferenceRank(goos string, capability string, provider string) int {
	return localrouting.PreferenceRank(goos, capability, provider)
}

func localRuntimeGOOSFromProfile(profileOS string) string {
	if normalized := strings.ToLower(strings.TrimSpace(profileOS)); normalized != "" {
		return normalized
	}
	return runtime.GOOS
}
