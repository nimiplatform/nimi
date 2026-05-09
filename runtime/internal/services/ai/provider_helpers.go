package ai

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

func preferredRoute(modelID string) runtimev1.RoutePolicy {
	lower := strings.ToLower(strings.TrimSpace(modelID))
	if strings.HasPrefix(lower, "cloud/") || strings.HasPrefix(lower, "token/") {
		return runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD
	}
	prefix, _, ok := strings.Cut(lower, "/")
	if ok {
		if record, found := providerregistry.Lookup(prefix); found && record.RuntimePlane == "remote" {
			return runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD
		}
	}
	return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
}

// Delegate to nimillm exports.
var (
	artifactUsage           = nimillm.ArtifactUsage
	mapProviderRequestError = nimillm.MapProviderRequestError
	mapProviderHTTPError    = nimillm.MapProviderHTTPError
)
