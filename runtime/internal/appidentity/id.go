// Package appidentity defines the public product identifier shared by Nimi App carriers.
package appidentity

import "regexp"

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-012b
const segment = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
const Pattern = segment + "(?:\\." + segment + ")+"

var canonical = regexp.MustCompile("^" + Pattern + "$")

func Valid(id string) bool {
	return len(id) >= 3 && len(id) <= 120 && canonical.MatchString(id)
}
