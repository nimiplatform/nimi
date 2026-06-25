package connector

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// CloudConnectorDef defines a cloud connector to auto-register from config.json.
type CloudConnectorDef struct {
	Provider  string // canonical name: "deepseek", "gemini", ...
	Endpoint  string // resolved endpoint URL
	APIKey    string // resolved API key value
	APIKeyEnv string // source env var when APIKey was resolved from env
	Label     string // display label: "Cloud DeepSeek"
}

// SystemCloudConnectorID returns the stable connector ID for a cloud provider.
func SystemCloudConnectorID(provider string) string {
	return "sys-cloud-" + strings.ToLower(strings.TrimSpace(provider))
}

// EnsureCloudConnectorsFromConfig creates or updates system cloud connectors from config.json.
// Idempotent: existing connectors are updated if endpoint/credential changed.
func EnsureCloudConnectorsFromConfig(store *ConnectorStore, defs []CloudConnectorDef) error {
	records, err := store.Load()
	if err != nil {
		return fmt.Errorf("load connectors: %w", err)
	}

	existing := make(map[string]ConnectorRecord)
	for _, r := range records {
		if r.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM &&
			r.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED {
			existing[r.ConnectorID] = r
		}
	}

	for _, def := range defs {
		if def.APIKey == "" {
			continue // skip providers without credentials
		}
		canonical := strings.TrimSpace(def.Provider)
		if canonical == "" ||
			canonical == "local" ||
			canonical == "llama" ||
			canonical == "media" ||
			canonical == "speech" ||
			canonical == "sidecar" {
			continue
		}
		if !IsKnownProvider(canonical) {
			return fmt.Errorf("cloud connector provider %q is not in the canonical provider catalog", canonical)
		}

		connectorID := SystemCloudConnectorID(canonical)
		endpoint := strings.TrimSpace(def.Endpoint)
		label := strings.TrimSpace(def.Label)
		if label == "" {
			label = "Cloud " + canonical
		}

		if rec, ok := existing[connectorID]; ok {
			// Already exists — check if endpoint or credential changed
			var mutations ConnectorMutations
			hasChange := false

			if rec.Endpoint != endpoint {
				mutations.Endpoint = &endpoint
				hasChange = true
			}
			if label != "" && rec.Label != label {
				mutations.Label = &label
				hasChange = true
			}

			apiKeyEnv := strings.TrimSpace(def.APIKeyEnv)
			if apiKeyEnv != "" {
				if strings.TrimSpace(rec.CredentialEnv) != apiKeyEnv || !rec.HasCredential {
					mutations.CredentialEnv = &apiKeyEnv
					hasChange = true
				}
			} else {
				// Check if credential changed. Env-backed connectors intentionally
				// do not compare resolved key material or write it into the OS keychain.
				currentKey := ""
				if strings.TrimSpace(rec.CredentialEnv) == "" {
					currentKey, _ = store.LoadCredential(connectorID)
				}
				if strings.TrimSpace(rec.CredentialEnv) != "" || currentKey != def.APIKey {
					apiKey := def.APIKey
					mutations.SecretPayload = &apiKey
					hasChange = true
				}
			}
			authKind := runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY
			if normalizeAuthKind(rec.AuthKind) != authKind {
				mutations.AuthKind = &authKind
				hasChange = true
			}
			if rec.ProviderAuthProfile != "" {
				emptyProfile := ""
				mutations.ProviderAuthProfile = &emptyProfile
				hasChange = true
			}

			if hasChange {
				if _, err := store.Update(connectorID, mutations); err != nil {
					return fmt.Errorf("update cloud connector %s: %w", connectorID, err)
				}
			}
			continue
		}

		// Create new system cloud connector with stable ID
		rec := ConnectorRecord{
			ConnectorID:   connectorID,
			Kind:          runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
			OwnerType:     runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM,
			OwnerID:       "system",
			Provider:      canonical,
			Endpoint:      endpoint,
			Label:         label,
			Status:        runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
			AuthKind:      runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY,
			CredentialEnv: strings.TrimSpace(def.APIKeyEnv),
		}
		secretPayload := def.APIKey
		if strings.TrimSpace(def.APIKeyEnv) != "" {
			secretPayload = ""
		}
		if _, err := store.Create(rec, secretPayload); err != nil {
			return fmt.Errorf("create cloud connector %s: %w", connectorID, err)
		}
	}
	return nil
}

// EnsureLocalConnectors is retained for startup call-site stability only.
// Runtime Target Identity v2 retires local connectors; local assets/profiles are
// surfaced by RuntimeLocalService and AIProfile target refs instead.
func EnsureLocalConnectors(store *ConnectorStore) error {
	_ = store
	return nil
}
