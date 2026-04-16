package storage

import "encoding/json"

// SchemaVersion is the current storage envelope version.
const SchemaVersion = 1

// Envelope wraps stored artifacts with schema versioning metadata.
type Envelope struct {
	SchemaVersion int             `json:"schema_version"`
	Kind          ArtifactKind    `json:"kind"`
	ItemID        string          `json:"item_id"`
	Data          json.RawMessage `json:"data"`
}
