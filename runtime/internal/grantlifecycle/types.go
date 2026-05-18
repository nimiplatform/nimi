// Package grantlifecycle implements the typed Runtime-local grant
// lifecycle state machine per
// `.nimi/spec/runtime/kernel/grant-service.md`. Per Wave 5 admission
// rule, this is the Runtime local custody portion; Realm cloud-side
// app-permission projection is BLOCKER-002 (out of this topic's scope).
//
// Per implementation doctrine: no false readiness — revocation during
// use fails closed for streaming and background work.
package grantlifecycle

import "errors"

// GrantState enumerates the canonical grant lifecycle states. The closed set
// must match P-PERM-003 and the SDK PermissionClient `GrantState` enum.
type GrantState string

const (
	GrantStatePending    GrantState = "pending"
	GrantStateGranted    GrantState = "granted"
	GrantStateDenied     GrantState = "denied"
	GrantStateExpired    GrantState = "expired"
	GrantStateRevoked    GrantState = "revoked"
	GrantStateSuperseded GrantState = "superseded"
)

func (s GrantState) Valid() bool {
	switch s {
	case GrantStatePending, GrantStateGranted, GrantStateDenied,
		GrantStateExpired, GrantStateRevoked, GrantStateSuperseded:
		return true
	}
	return false
}

// IsTerminal reports whether the state is terminal. Denied may transition to
// pending for a new request, but revoked / expired / superseded are terminal.
func (s GrantState) IsTerminal() bool {
	switch s {
	case GrantStateRevoked, GrantStateExpired, GrantStateSuperseded:
		return true
	}
	return false
}

// AllowsAccess reports whether a grant in this state authorizes access.
func (s GrantState) AllowsAccess() bool {
	return s == GrantStateGranted
}

// Grant is the typed Runtime-local grant record. The Realm cloud-side
// audit projection is BLOCKER-002 and consumed via a separate future
// topic.
type Grant struct {
	GrantID        string
	AppID          string
	SubjectUserID  string
	ScopeKey       string
	State          GrantState
	IssuedAt       int64
	ExpiresAt      int64
	LastTransition int64
	Detail         string
}

// Sentinel errors.
var (
	ErrGrantInvalidTransition = errors.New("grantlifecycle invalid state transition")
	ErrGrantUnknownState      = errors.New("grantlifecycle unknown state")
	ErrGrantTerminalLocked    = errors.New("grantlifecycle grant is in terminal state")
	ErrGrantRequired          = errors.New("grantlifecycle grant is required")
)
