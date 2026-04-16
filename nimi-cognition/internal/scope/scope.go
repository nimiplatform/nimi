// Package scope provides agent scope isolation for per-agent
// cognition storage and operations.
package scope

import (
	"errors"
	"fmt"
	"regexp"
)

// validScopePattern matches valid scope IDs: alphanumeric + underscore
// + hyphen, 1-128 chars.
var validScopePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

// ID is a validated agent scope identifier. Each agent's cognition
// state is isolated under its own scope.
type ID string

// Validate checks that a scope ID is well-formed.
func Validate(id string) error {
	if id == "" {
		return errors.New("scope: id is required")
	}
	if !validScopePattern.MatchString(id) {
		return fmt.Errorf("scope: invalid id %q: must match [a-zA-Z0-9_-]{1,128}", id)
	}
	return nil
}

// MustValidate panics if the scope ID is invalid. Use only in tests.
func MustValidate(id string) ID {
	if err := Validate(id); err != nil {
		panic(err)
	}
	return ID(id)
}
