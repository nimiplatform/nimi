package ai

import "github.com/nimiplatform/nimi/runtime/internal/nimillm"

// Delegate to nimillm exports.
var (
	artifactUsage           = nimillm.ArtifactUsage
	mapProviderRequestError = nimillm.MapProviderRequestError
	mapProviderHTTPError    = nimillm.MapProviderHTTPError
)
