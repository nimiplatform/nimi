package firstpartymigration

import "fmt"

var allowedMigrationTransitions = map[MigrationState]map[MigrationState]bool{
	MigrationStatePending: {
		MigrationStateInventoryBuilt:    true,
		MigrationStateBlockedMasterGate: true,
		MigrationStateFailedTerminal:    true,
	},
	MigrationStateInventoryBuilt: {
		MigrationStateUserConfirmed:     true,
		MigrationStateBlockedMasterGate: true,
		MigrationStateFailedTerminal:    true,
	},
	MigrationStateUserConfirmed: {
		MigrationStateInProgress:        true,
		MigrationStateBlockedMasterGate: true,
		MigrationStateFailedTerminal:    true,
	},
	MigrationStateInProgress: {
		MigrationStateCompleted:         true,
		MigrationStateFailedRecoverable: true,
		MigrationStateFailedTerminal:    true,
	},
	MigrationStateFailedRecoverable: {
		MigrationStateInProgress:     true,
		MigrationStateRolledBack:     true,
		MigrationStateFailedTerminal: true,
	},
	MigrationStateBlockedMasterGate: {
		MigrationStatePending:        true,
		MigrationStateFailedTerminal: true,
	},
}

// Transition advances the migration state. Avatar migrations require
// AvatarMasterGateAcked=true; if false, the only admissible non-terminal
// next state is BlockedMasterGate. Failed-recoverable requires
// RecoveryPath before any in-progress retry.
func Transition(m *Migration, next MigrationState, atUnix int64, detail string) (*Migration, error) {
	if m == nil {
		return nil, fmt.Errorf("firstpartymigration Transition: %w", ErrMigrationRequired)
	}
	if !next.Valid() {
		return nil, fmt.Errorf("firstpartymigration Transition: %w: %q", ErrMigrationUnknownState, string(next))
	}
	if m.State.IsTerminal() {
		return nil, fmt.Errorf("firstpartymigration Transition (%q→%q): %w",
			string(m.State), string(next), ErrMigrationTerminalLocked)
	}
	if m.Kind == MigrationKindAvatarStandalone && !m.AvatarMasterGateAcked {
		if next != MigrationStateBlockedMasterGate && next != MigrationStateFailedTerminal {
			return nil, fmt.Errorf("firstpartymigration Transition (avatar %q→%q): %w",
				string(m.State), string(next), ErrMigrationAvatarMasterGateBlock)
		}
	}
	if m.State == MigrationStateFailedRecoverable && next == MigrationStateInProgress && m.RecoveryPath == "" {
		return nil, fmt.Errorf("firstpartymigration Transition (%q→%q): %w",
			string(m.State), string(next), ErrMigrationRecoveryRequired)
	}
	allowed, ok := allowedMigrationTransitions[m.State]
	if !ok || !allowed[next] {
		return nil, fmt.Errorf("firstpartymigration Transition (%q→%q): %w",
			string(m.State), string(next), ErrMigrationInvalidTransition)
	}
	clone := *m
	clone.State = next
	clone.LastTransition = atUnix
	clone.Detail = detail
	return &clone, nil
}

// CanonicalMigrationStates returns the canonical enum in catalog order.
func CanonicalMigrationStates() []MigrationState {
	return []MigrationState{
		MigrationStatePending,
		MigrationStateInventoryBuilt,
		MigrationStateUserConfirmed,
		MigrationStateInProgress,
		MigrationStateCompleted,
		MigrationStateFailedRecoverable,
		MigrationStateFailedTerminal,
		MigrationStateRolledBack,
		MigrationStateBlockedMasterGate,
	}
}
