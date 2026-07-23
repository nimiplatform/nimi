// Package materializationreadiness implements the Runtime-owned
// readiness projection for factory AIProfile materialization per
// .nimi/spec/runtime/kernel/local-environment-materializers-contract.md.
//
// Activation states and reason codes are sourced from the canonical
// catalog at runtime/kernel/tables/activation-gate-reason-codes.yaml.
// Consumers may project the readiness but must not invent reason codes;
// this package enforces fail-closed semantics so unknown reason codes are
// rejected at construction time.
package materializationreadiness

import "errors"

// ActivationState enumerates Runtime activation states per
// activation-gate-reason-codes.yaml state_priority.
type ActivationState string

const (
	StateUnsupported     ActivationState = "unsupported"
	StateRepairRequired  ActivationState = "repair_required"
	StateFailed          ActivationState = "failed"
	StateCancelled       ActivationState = "cancelled"
	StateSetupInProgress ActivationState = "setup_in_progress"
	StateSetupRequired   ActivationState = "setup_required"
	StateReady           ActivationState = "ready"
)

// Valid reports whether the activation state is a canonical value.
func (s ActivationState) Valid() bool {
	switch s {
	case StateUnsupported, StateRepairRequired, StateFailed, StateCancelled,
		StateSetupInProgress, StateSetupRequired, StateReady:
		return true
	}
	return false
}

// IsTerminalNonReady reports whether the state is a terminal failure
// projection (must not be reported as active/ready). Per yaml rule:
// "non-ready activation states must not project active, degraded-ready,
// best-effort-ready, endpoint-ready, or import-ready".
func (s ActivationState) IsTerminalNonReady() bool {
	switch s {
	case StateUnsupported, StateFailed, StateCancelled, StateRepairRequired:
		return true
	}
	return false
}

// ReasonCode enumerates Runtime activation reason codes per
// runtime_activation_gate_reason_codes closed enum.
type ReasonCode string

const (
	ReasonEnginePackageMissing          ReasonCode = "engine_package_missing"
	ReasonModelAssetMissing             ReasonCode = "model_asset_missing"
	ReasonCompanionAssetMissing         ReasonCode = "companion_asset_missing"
	ReasonSelectedSourceRecordMissing   ReasonCode = "selected_source_record_missing"
	ReasonAcceleratorRuntimeMissing     ReasonCode = "accelerator_runtime_missing"
	ReasonAcceleratorRuntimeUnconfirmed ReasonCode = "accelerator_runtime_unconfirmed"
	ReasonUVMissing                     ReasonCode = "uv_missing"
	ReasonPythonRuntimeMissing          ReasonCode = "python_runtime_missing"
	ReasonPythonVenvMissing             ReasonCode = "python_venv_missing"
	ReasonPythonPackageSetMissing       ReasonCode = "python_package_set_missing"
	ReasonTorchWheelMissing             ReasonCode = "torch_wheel_missing"
	ReasonVulkanRuntimeUnavailable      ReasonCode = "vulkan_runtime_unavailable"
	ReasonMetalRuntimeUnavailable       ReasonCode = "metal_runtime_unavailable"
	ReasonUnsupported                   ReasonCode = "unsupported"
	ReasonRepairRequired                ReasonCode = "repair_required"
	ReasonFailed                        ReasonCode = "failed"
	ReasonCancelled                     ReasonCode = "cancelled"
	ReasonSetupInProgress               ReasonCode = "setup_in_progress"
	ReasonSetupRequired                 ReasonCode = "setup_required"
	ReasonReady                         ReasonCode = "ready"
)

// CanonicalReasonCodes returns the full canonical reason code enum in
// catalog order. Useful for tests and validators that must enumerate
// the closed enum without consulting yaml at runtime.
func CanonicalReasonCodes() []ReasonCode {
	return []ReasonCode{
		ReasonEnginePackageMissing,
		ReasonModelAssetMissing,
		ReasonCompanionAssetMissing,
		ReasonSelectedSourceRecordMissing,
		ReasonAcceleratorRuntimeMissing,
		ReasonAcceleratorRuntimeUnconfirmed,
		ReasonUVMissing,
		ReasonPythonRuntimeMissing,
		ReasonPythonVenvMissing,
		ReasonPythonPackageSetMissing,
		ReasonTorchWheelMissing,
		ReasonVulkanRuntimeUnavailable,
		ReasonMetalRuntimeUnavailable,
		ReasonUnsupported,
		ReasonRepairRequired,
		ReasonFailed,
		ReasonCancelled,
		ReasonSetupInProgress,
		ReasonSetupRequired,
		ReasonReady,
	}
}

// Valid reports whether the reason code is a canonical enum value.
func (r ReasonCode) Valid() bool {
	for _, canonical := range CanonicalReasonCodes() {
		if canonical == r {
			return true
		}
	}
	return false
}

// Readiness is the typed materialization readiness projection.
type Readiness struct {
	State          ActivationState
	Reason         ReasonCode
	Detail         string
	DependencyRefs []string
}

// IsReady reports whether the projection is the terminal ready state.
// Per contract, IsReady requires both State=ready and Reason=ready.
func (r Readiness) IsReady() bool {
	return r.State == StateReady && r.Reason == ReasonReady
}

// Sentinel errors returned by readiness constructors.
var (
	ErrUnknownReasonCode              = errors.New("materialization-readiness unknown reason code")
	ErrUnknownActivationState         = errors.New("materialization-readiness unknown activation state")
	ErrActiveReadyRequiresReasonReady = errors.New("materialization-readiness state=ready requires reason=ready")
	ErrNonReadyMustNotProjectActive   = errors.New("materialization-readiness non-ready state must not project active or degraded-ready")
	ErrNonReadyRequiresExplicitReason = errors.New("materialization-readiness non-ready state requires an explicit reason code")
)
