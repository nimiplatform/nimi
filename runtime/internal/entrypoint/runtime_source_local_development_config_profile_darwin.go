//go:build darwin && cgo && nimi_macos_source_local_development

package entrypoint

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

const macOSSourceLocalDevelopmentDefaultRealmBaseURL = "http://127.0.0.1:3002"

// loadMacOSProtectedRealmBaseURL resolves only the source-workspace local
// Realm authority inherited from the Desktop source-local-development coordinator. localhost is
// canonicalized to 127.0.0.1 so OAuth and every Realm-backed owner use one
// explicit loopback origin. Missing source configuration uses the existing
// local-development default; malformed or non-loopback input fails closed.
func loadMacOSProtectedRealmBaseURL() (string, error) {
	raw, present := os.LookupEnv("NIMI_REALM_URL")
	if !present || strings.TrimSpace(raw) == "" {
		return macOSSourceLocalDevelopmentDefaultRealmBaseURL, nil
	}
	if raw != strings.TrimSpace(raw) {
		return "", fmt.Errorf("source local development Realm URL is not exact")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "http" || parsed.Port() != "3002" ||
		(parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") ||
		parsed.User != nil || parsed.Opaque != "" || (parsed.Path != "" && parsed.Path != "/") ||
		parsed.RawPath != "" || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" ||
		parsed.RawFragment != "" {
		return "", fmt.Errorf("source local development Realm URL must be local loopback HTTP on port 3002")
	}
	return macOSSourceLocalDevelopmentDefaultRealmBaseURL, nil
}
