// Package firstpartymigration implements the typed migration state
// machine for first-party Nimi App hardcut per
// `docs/authority/platform-product-lifecycle-rationale.md`.
//
// Per closed redesign first-party hardcut policy: migration preserves
// admitted user state or fails closed with recovery. Standalone
// ordinary-user truth is removed/blocked; developer-only paths must
// remain clearly marked.
package firstpartymigration

import "errors"

// MigrationState enumerates the canonical migration lifecycle states.
type MigrationState string

const (
	MigrationStatePending           MigrationState = "pending"
	MigrationStateInventoryBuilt    MigrationState = "inventory-built"
	MigrationStateUserConfirmed     MigrationState = "user-confirmed"
	MigrationStateInProgress        MigrationState = "in-progress"
	MigrationStateCompleted         MigrationState = "completed"
	MigrationStateFailedRecoverable MigrationState = "failed-recoverable"
	MigrationStateFailedTerminal    MigrationState = "failed-terminal"
	MigrationStateRolledBack        MigrationState = "rolled-back"
	MigrationStateBlockedMasterGate MigrationState = "blocked-by-master-gate"
)

func (s MigrationState) Valid() bool {
	switch s {
	case MigrationStatePending, MigrationStateInventoryBuilt, MigrationStateUserConfirmed,
		MigrationStateInProgress, MigrationStateCompleted, MigrationStateFailedRecoverable,
		MigrationStateFailedTerminal, MigrationStateRolledBack, MigrationStateBlockedMasterGate:
		return true
	}
	return false
}

func (s MigrationState) IsTerminal() bool {
	switch s {
	case MigrationStateCompleted, MigrationStateFailedTerminal, MigrationStateRolledBack:
		return true
	}
	return false
}

func (s MigrationState) IsBlocked() bool {
	return s == MigrationStateBlockedMasterGate
}

// MigrationKind enumerates the admitted first-party migration kinds.
type MigrationKind string

const (
	MigrationKindAvatarStandalone MigrationKind = "avatar-standalone-to-nimi-app"
)

func (k MigrationKind) Valid() bool {
	switch k {
	case MigrationKindAvatarStandalone:
		return true
	}
	return false
}

// Migration is a typed migration record. AvatarMasterGateAcked records
// whether the current Avatar master gate posture explicitly permits
// Avatar migration; when false, Avatar migrations are blocked.
type Migration struct {
	MigrationID           string
	Kind                  MigrationKind
	SubjectUserID         string
	State                 MigrationState
	InventoryItemsTotal   int
	InventoryItemsApplied int
	RecoveryPath          string
	StartedAt             int64
	LastTransition        int64
	Detail                string
	AvatarMasterGateAcked bool
}

var (
	ErrMigrationRequired              = errors.New("firstpartymigration migration is required")
	ErrMigrationUnknownState          = errors.New("firstpartymigration unknown state")
	ErrMigrationInvalidTransition     = errors.New("firstpartymigration invalid state transition")
	ErrMigrationTerminalLocked        = errors.New("firstpartymigration migration is in terminal state")
	ErrMigrationAvatarMasterGateBlock = errors.New("firstpartymigration avatar migration blocked by master gate; ack required")
	ErrMigrationRecoveryRequired      = errors.New("firstpartymigration failed-recoverable requires recovery path before transition")
)
