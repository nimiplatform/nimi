package capabilitydriver

import (
	"log/slog"
	"regexp"
)

var providerErrorCodePattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,96}$`)

// logProviderStreamErrorEvent records, for diagnostics, a provider error that
// arrived inside an accepted response stream: only the route and the
// provider's own error code, never its message or any content.
func logProviderStreamErrorEvent(route string, code string) {
	if !providerErrorCodePattern.MatchString(code) {
		code = ""
	}
	slog.Warn("provider stream error event", "route", route, "provider_error_code", code)
}
