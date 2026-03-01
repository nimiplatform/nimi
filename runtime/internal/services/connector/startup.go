package connector

import (
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

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
