package connector

import "github.com/nimiplatform/nimi/runtime/internal/providerregistry"

// ProviderCatalogEntry defines default endpoint and requirements for a provider.
type ProviderCatalogEntry struct {
	DefaultEndpoint          string
	RequiresExplicitEndpoint bool
}

// ProviderCapability defines runtime plane and execution module for a provider.
type ProviderCapability struct {
	RuntimePlane     string // "local" or "remote"
	ExecutionModule  string // "local-model" or "nimillm"
	ManagedSupported bool
	InlineSupported  bool
}

// ProviderCatalog maps canonical provider IDs to their catalog entries.
var ProviderCatalog = buildProviderCatalog()

// ProviderCapabilities maps canonical provider IDs to their runtime capabilities.
var ProviderCapabilities = buildProviderCapabilities()

func buildProviderCatalog() map[string]ProviderCatalogEntry {
	out := make(map[string]ProviderCatalogEntry, len(providerregistry.RemoteProviders))
	for _, providerID := range providerregistry.RemoteProviders {
		record, ok := providerregistry.Lookup(providerID)
		if !ok {
			continue
		}
		out[providerID] = ProviderCatalogEntry{
			DefaultEndpoint:          record.DefaultEndpoint,
			RequiresExplicitEndpoint: record.RequiresExplicitEndpoint,
		}
	}
	return out
}

func buildProviderCapabilities() map[string]ProviderCapability {
	out := make(map[string]ProviderCapability, len(providerregistry.AllProviders))
	for _, providerID := range providerregistry.AllProviders {
		record, ok := providerregistry.Lookup(providerID)
		if !ok {
			continue
		}
		executionModule := "nimillm"
		if record.RuntimePlane == "local" {
			executionModule = "local-model"
		}
		out[providerID] = ProviderCapability{
			RuntimePlane:     record.RuntimePlane,
			ExecutionModule:  executionModule,
			ManagedSupported: record.ManagedConnectorSupported,
			InlineSupported:  record.InlineSupported,
		}
	}
	return out
}

// ResolveEndpoint returns the effective endpoint for a provider and optional user endpoint.
func ResolveEndpoint(provider string, userEndpoint string) string {
	if userEndpoint != "" {
		return userEndpoint
	}
	if entry, ok := ProviderCatalog[provider]; ok {
		return entry.DefaultEndpoint
	}
	return ""
}

// IsKnownProvider returns true if provider is in the catalog.
func IsKnownProvider(provider string) bool {
	_, ok := ProviderCatalog[provider]
	if ok {
		return true
	}
	_, ok = ProviderCapabilities[provider]
	return ok
}
