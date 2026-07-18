// Package realmsourcecontract owns the Runtime-internal persisted identity of
// the admitted Realm v3 source materialization state. Persistence and the
// RuntimeAgent semantic layer must compare the same constants; duplicating
// them would make restart/reset admission drift independently.
package realmsourcecontract

const (
	SnapshotSchemaVersion        = "nimi.runtime.local-agent-source-snapshot/v2"
	NormalizationVersion         = "nimi.runtime.source-materialization-normalization/v3"
	CompilerCompatibilityVersion = "realm-character-v3"
	RuntimeSourceRefPrefix       = "runtime-source:"
	RuntimeSourceRefV3Prefix     = "runtime-source:realm-v3:"
)
