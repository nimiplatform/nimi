package ai

import "strings"

func routeMetadataRefForResolvedBinding(capability string, resolvedBindingRef string) string {
	ref := strings.TrimSpace(resolvedBindingRef)
	if ref != "" {
		return "route-metadata/" + ref
	}
	capability = strings.TrimSpace(capability)
	if capability == "" {
		capability = "unknown"
	}
	return "route-metadata/" + capability
}
