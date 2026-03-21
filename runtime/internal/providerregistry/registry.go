package providerregistry

import "sort"

var (
	cachedRemoteProviderSet = func() map[string]struct{} {
		set := make(map[string]struct{}, len(RemoteProviders))
		for _, provider := range RemoteProviders {
			set[provider] = struct{}{}
		}
		return set
	}()
	cachedSortedProviderIDs = func() []string {
		ids := make([]string, 0, len(Records))
		for providerID := range Records {
			ids = append(ids, providerID)
		}
		sort.Strings(ids)
		return ids
	}()
)

// Lookup returns the provider record when present.
func Lookup(providerID string) (ProviderRecord, bool) {
	record, ok := Records[providerID]
	return record, ok
}

// Contains returns true when providerID exists in the registry.
func Contains(providerID string) bool {
	_, ok := Records[providerID]
	return ok
}

// RemoteProviderSet returns a lookup set of remote provider IDs.
func RemoteProviderSet() map[string]struct{} {
	set := make(map[string]struct{}, len(cachedRemoteProviderSet))
	for providerID := range cachedRemoteProviderSet {
		set[providerID] = struct{}{}
	}
	return set
}

// SortedProviderIDs returns all provider IDs sorted lexicographically.
func SortedProviderIDs() []string {
	return append([]string(nil), cachedSortedProviderIDs...)
}
