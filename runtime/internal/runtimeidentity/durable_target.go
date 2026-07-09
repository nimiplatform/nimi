package runtimeidentity

import (
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

var ErrInvalidDurableTargetRef = errors.New("invalid runtime durable target ref")

// ValidateDurableTargetRef enforces the exact K-RTARGET-002 persisted identity
// grammar. It validates structure only; callers retain ownership of their
// domain-specific gRPC error mapping and target resolution.
func ValidateDurableTargetRef(targetRef *runtimev1.RuntimeDurableTargetRef) error {
	if targetRef == nil {
		return ErrInvalidDurableTargetRef
	}
	switch target := targetRef.GetTarget().(type) {
	case *runtimev1.RuntimeDurableTargetRef_LocalRuntime:
		if !validLocalTarget(target.LocalRuntime) {
			return ErrInvalidDurableTargetRef
		}
	case *runtimev1.RuntimeDurableTargetRef_Cloud:
		if !validCloudTarget(target.Cloud) {
			return ErrInvalidDurableTargetRef
		}
	default:
		return ErrInvalidDurableTargetRef
	}
	return nil
}

func validLocalTarget(target *runtimev1.RuntimeDurableLocalTargetRef) bool {
	if target == nil || target.GetVersion() != "v2" {
		return false
	}
	switch target.GetRef().(type) {
	case *runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId:
		return exactNonEmpty(target.GetProfileBindingId())
	case *runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef:
		return exactNonEmpty(target.GetReadinessRef())
	default:
		return false
	}
}

func validCloudTarget(target *runtimev1.RuntimeDurableCloudTargetRef) bool {
	return target != nil &&
		target.GetVersion() == "v2" &&
		exactNonEmpty(target.GetConnectorId()) &&
		exactNonEmpty(target.GetRemoteModelCatalogId()) &&
		exactNonEmpty(target.GetProviderModelId()) &&
		exactNonEmpty(target.GetProvider())
}

func exactNonEmpty(value string) bool {
	return value != "" && strings.TrimSpace(value) == value
}
