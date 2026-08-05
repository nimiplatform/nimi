package runtimeidentity

import "errors"

var ErrInvalidDurableTargetRef = errors.New("invalid runtime durable target ref")

// ValidateDurableTargetRef validates the closed Runtime-private target shape.
func ValidateDurableTargetRef(targetRef *Target) error {
	if targetRef == nil || !targetRef.Valid() {
		return ErrInvalidDurableTargetRef
	}
	return nil
}
