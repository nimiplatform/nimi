package appaccess

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const MaxDeclarationItemBytes = 128

var supportedDomains = map[string]struct{}{
	"realm.data":      {},
	"runtime.consume": {},
	"agent.local":     {},
}

// ResolveDeclaration validates and preserves every raw item while activating
// only the current closed domain vocabulary. Unknown items are intentionally
// inert for this declaration generation.
func ResolveDeclaration(items []string) ([]string, []string, error) {
	raw := append([]string(nil), items...)
	activated := make([]string, 0, len(raw))
	seen := make(map[string]struct{}, len(raw))
	for index, item := range raw {
		if item == "" || item != strings.TrimSpace(item) || !utf8.ValidString(item) || len([]byte(item)) > MaxDeclarationItemBytes {
			return nil, nil, fmt.Errorf("invalid App access declaration item %d", index)
		}
		if _, duplicate := seen[item]; duplicate {
			return nil, nil, fmt.Errorf("duplicate App access declaration item %q", item)
		}
		seen[item] = struct{}{}
		if _, supported := supportedDomains[item]; supported {
			activated = append(activated, item)
		}
	}
	return raw, activated, nil
}

func IsSupportedDomain(domain string) bool {
	_, ok := supportedDomains[domain]
	return ok
}
