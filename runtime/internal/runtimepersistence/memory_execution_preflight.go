package runtimepersistence

import (
	"errors"

	"github.com/nimiplatform/nimi/runtime/internal/storedformat"
)

// @nimi-authority: rule.nimi.runtime.service-operations.r092
// PreflightStoredMemoryExecution recognizes the same missing disposition
// evidence rejected by the ordinary backend, before schema initialization can
// write to the selected root. An absent table is a fresh schema, while an
// unreadable database remains an unclassified startup failure.
func PreflightStoredMemoryExecution(localStatePath string) *storedformat.Refusal {
	db, exists, err := OpenReadOnlyForClassification(localStatePath)
	if err != nil || !exists || db == nil {
		return nil
	}
	defer func() { _ = db.Close() }()
	var columns, dispositionColumns int
	if err := db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(lower(name) = 'payload_disposition'), 0)
		FROM pragma_table_info('runtime_cognition_memory_ai_job')`).Scan(&columns, &dispositionColumns); err != nil {
		return nil
	}
	if columns == 0 || dispositionColumns != 0 {
		return nil
	}
	return storedformat.Refuse("runtimepersistence.memory-execution", storedformat.OfflineRepair,
		errors.New("Memory execution payload storage lacks disposition evidence and requires explicit offline repair while Runtime is stopped"))
}
