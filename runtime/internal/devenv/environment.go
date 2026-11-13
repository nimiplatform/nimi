// Package devenv owns the source Runtime's selected Realm and state namespace.
package devenv

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
)

type Profile struct {
	APIOrigin, RealtimeOrigin, WebOrigin, EnvironmentID string
}

// @nimi-authority: rule.nimi.platform.core-protocol.development-topology
func Resolve(getenv func(string) string) (string, Profile, error) {
	name := getenv("NIMI_DEV_REALM")
	if name == "" {
		name = "official"
	}
	p, err := ProfileFor(name)
	if err != nil {
		return "", Profile{}, err
	}
	if name == "local" {
		for _, field := range []struct {
			key   string
			value *string
		}{
			{"NIMI_DEV_REALM_URL", &p.APIOrigin}, {"NIMI_DEV_REALTIME_URL", &p.RealtimeOrigin}, {"NIMI_DEV_WEB_URL", &p.WebOrigin},
		} {
			if value := getenv(field.key); value != "" {
				u, err := url.Parse(value)
				if err != nil || u.String() != value || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.Host == "" || u.Opaque != "" || u.ForceQuery ||
					(u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost"))) {
					return "", Profile{}, fmt.Errorf("invalid development origin: %s", field.key)
				}
				*field.value = value
			}
		}
		official, _ := ProfileFor("official")
		if p.APIOrigin == official.APIOrigin {
			return "", Profile{}, fmt.Errorf("official Realm requires the official environment")
		}
		if id := getenv("NIMI_DEV_REALM_ENVIRONMENT_ID"); id != "" {
			valid, _ := regexp.MatchString(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`, id)
			if !valid {
				return "", Profile{}, fmt.Errorf("invalid development Realm environment id")
			}
			p.EnvironmentID = id
		}
	}
	return name, p, nil
}

// StateRoot is selected before any custody, installation or product owner opens.
func StateRoot(base string) (string, error) {
	name, _, err := Resolve(os.Getenv)
	if err != nil {
		return "", err
	}
	return filepath.Join(base, name), nil
}
