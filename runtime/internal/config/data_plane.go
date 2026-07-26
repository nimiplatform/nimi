package config

import (
	"path/filepath"
	"strings"
)

// DataPlaneRootID identifies a Runtime-managed root inside the user-selected
// nimi_data directory. The Runtime page Environment surface reads these roots
// as a read-only data model; it is not a second config authority. (K-CFG-018)
type DataPlaneRootID string

const (
	DataPlaneRootModels       DataPlaneRootID = "models"
	DataPlaneRootDependencies DataPlaneRootID = "dependencies"
	DataPlaneRootEnvironments DataPlaneRootID = "environments"
	DataPlaneRootApps         DataPlaneRootID = "apps"
	DataPlaneRootAccounts     DataPlaneRootID = "accounts"
	DataPlaneRootLogs         DataPlaneRootID = "logs"
	DataPlaneRootAudit        DataPlaneRootID = "audit"
)

// DataPlaneRoot is one Runtime-managed nimi_data directory entry. Owner and
// cleanup semantics mirror the nimi_data Directory Ownership table in the
// product manual.
type DataPlaneRoot struct {
	// ID is the stable directory identifier.
	ID DataPlaneRootID
	// Path is the absolute resolved filesystem path, or empty when nimi_data
	// has not been selected and the root cannot be resolved.
	Path string
	// Owner is the product owner of the directory contents.
	Owner string
	// Description is the product meaning of the directory.
	Description string
	// Resolved reports whether Path is a usable absolute path.
	Resolved bool
}

// DataPlaneModel is the typed, read-only projection of the nimi_data data
// plane that the Runtime page Environment section manages. It is derived from
// the Runtime config dataRootRef and managedRoots; it carries no mutable state
// and owns no config authority.
type DataPlaneModel struct {
	// DataRootRef is the absolute user-selected nimi_data root, or empty when
	// product setup has not recorded one.
	DataRootRef string
	// Roots are the seven Runtime-managed nimi_data roots in stable order.
	Roots []DataPlaneRoot
}

// dataPlaneRootMeta declares the static owner/description for each managed
// root, in the stable Environment-surface display order.
var dataPlaneRootMeta = []struct {
	id          DataPlaneRootID
	owner       string
	description string
}{
	{DataPlaneRootModels, "Runtime / model materializer", "Local model assets used by profiles and AIConfigs."},
	{DataPlaneRootDependencies, "Runtime dependency materializer", "Downloaded dependency payloads such as CUDA/Python/uv/package families."},
	{DataPlaneRootEnvironments, "Runtime environment materializer", "Nimi-managed executable environments."},
	{DataPlaneRootApps, "Runtime app package manager", "Installed Nimi App package data."},
	{DataPlaneRootAccounts, "Runtime account data manager", "Principal-scoped account data."},
	{DataPlaneRootLogs, "Runtime / product support", "Operational logs."},
	{DataPlaneRootAudit, "Runtime / Realm projection / product audit", "Local audit projections."},
}

// NewDataPlaneModel builds the read-only nimi_data data model from a resolved
// Config. Roots fall back to <dataRootRef>/<id> when managedRoots does not
// override them, matching resolveManagedRoots. When dataRootRef is empty the
// roots are reported unresolved rather than guessed.
func NewDataPlaneModel(cfg Config) DataPlaneModel {
	dataRoot := strings.TrimSpace(cfg.DataRootRef)
	managed := map[DataPlaneRootID]string{
		DataPlaneRootModels:       strings.TrimSpace(cfg.ManagedRoots.Models),
		DataPlaneRootDependencies: strings.TrimSpace(cfg.ManagedRoots.Dependencies),
		DataPlaneRootEnvironments: strings.TrimSpace(cfg.ManagedRoots.Environments),
		DataPlaneRootApps:         strings.TrimSpace(cfg.ManagedRoots.Apps),
		DataPlaneRootAccounts:     strings.TrimSpace(cfg.ManagedRoots.Accounts),
		DataPlaneRootLogs:         strings.TrimSpace(cfg.ManagedRoots.Logs),
		DataPlaneRootAudit:        strings.TrimSpace(cfg.ManagedRoots.Audit),
	}

	roots := make([]DataPlaneRoot, 0, len(dataPlaneRootMeta))
	for _, meta := range dataPlaneRootMeta {
		path := managed[meta.id]
		if path == "" && dataRoot != "" {
			path = filepath.Join(dataRoot, string(meta.id))
		}
		roots = append(roots, DataPlaneRoot{
			ID:          meta.id,
			Path:        path,
			Owner:       meta.owner,
			Description: meta.description,
			Resolved:    path != "" && filepath.IsAbs(path),
		})
	}

	return DataPlaneModel{
		DataRootRef: dataRoot,
		Roots:       roots,
	}
}
