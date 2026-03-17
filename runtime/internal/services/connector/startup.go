package connector

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

// CloudConnectorDef defines a cloud connector to auto-register from config.json.
type CloudConnectorDef struct {
	Provider string // canonical name: "deepseek", "gemini", ...
	Endpoint string // resolved endpoint URL
	APIKey   string // resolved API key value
	Label    string // display label: "Cloud DeepSeek"
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
			canonical == "media.diffusers" ||
			canonical == "sidecar" ||
			canonical == "nexa" {
			continue
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

			// Check if credential changed
			currentKey, _ := store.LoadCredential(connectorID)
			if currentKey != def.APIKey {
				apiKey := def.APIKey
				mutations.APIKey = &apiKey
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
			ConnectorID: connectorID,
			Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
			OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM,
			OwnerID:     "system",
			Provider:    canonical,
			Endpoint:    endpoint,
			Label:       label,
			Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		}
		if err := store.Create(rec, def.APIKey); err != nil {
			return fmt.Errorf("create cloud connector %s: %w", connectorID, err)
		}
	}
	return nil
}

// localConnectorDef defines a system local connector to ensure at startup.
type localConnectorDef struct {
	Category runtimev1.LocalConnectorCategory
	Label    string
}

var systemLocalConnectors = []localConnectorDef{
	{Category: runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_LLM, Label: "Local LLM"},
	{Category: runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_VISION, Label: "Local Vision"},
	{Category: runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_IMAGE, Label: "Local Image"},
	{Category: runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_TTS, Label: "Local TTS"},
	{Category: runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_STT, Label: "Local STT"},
	{Category: runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_CUSTOM, Label: "Local Custom"},
}

// EnsureLocalConnectors creates the 6 system local connectors if they don't already exist.
func EnsureLocalConnectors(store *ConnectorStore) error {
	records, err := store.Load()
	if err != nil {
		return fmt.Errorf("load connectors: %w", err)
	}

	existingCategories := make(map[runtimev1.LocalConnectorCategory]bool)
	for _, r := range records {
		if r.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL && r.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM {
			existingCategories[r.LocalCategory] = true
		}
	}

	for _, def := range systemLocalConnectors {
		if existingCategories[def.Category] {
			continue
		}
		rec := ConnectorRecord{
			ConnectorID:   ulid.Make().String(),
			Kind:          runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL,
			OwnerType:     runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM,
			OwnerID:       "system",
			Provider:      "local",
			Label:         def.Label,
			Status:        runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
			LocalCategory: def.Category,
		}
		if err := store.Create(rec, ""); err != nil {
			return fmt.Errorf("create local connector %s: %w", def.Label, err)
		}
	}
	return nil
}
