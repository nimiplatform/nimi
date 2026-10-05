package ai

import "github.com/nimiplatform/nimi/runtime/internal/nimillm"

// Delegate to nimillm exports.
var (
	mapProviderRequestError = nimillm.MapProviderRequestError
	mapProviderHTTPError    = nimillm.MapProviderHTTPError
)
