package nimillm

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

// InputCleanupResult records observed storage disposition, never inference
// cancellation or immediate physical erasure. It contains no provider locator.
type InputCleanupResult struct {
	State                                string
	Deleted, Absent, Failed, Unconfirmed int
	ReasonCode                           runtimev1.ReasonCode
}

func (r InputCleanupResult) Outcome() ProviderTaskCleanupOutcome {
	if r.State == "deleted" || r.State == "not_required" {
		return ProviderTaskCleanupResourcesDeleted
	}
	if r.State == "failed" {
		return ProviderTaskCleanupFailed
	}
	return ProviderTaskCleanupUnconfirmed
}
