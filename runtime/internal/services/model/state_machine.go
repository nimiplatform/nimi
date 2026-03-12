package model

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

var allowedModelTransitions = map[runtimev1.ModelStatus]map[runtimev1.ModelStatus]bool{
	runtimev1.ModelStatus_MODEL_STATUS_INSTALLED: {
		runtimev1.ModelStatus_MODEL_STATUS_PULLING: true,
		runtimev1.ModelStatus_MODEL_STATUS_REMOVED: true,
	},
	runtimev1.ModelStatus_MODEL_STATUS_PULLING: {
		runtimev1.ModelStatus_MODEL_STATUS_INSTALLED: true,
		runtimev1.ModelStatus_MODEL_STATUS_FAILED:    true,
	},
	runtimev1.ModelStatus_MODEL_STATUS_FAILED: {
		runtimev1.ModelStatus_MODEL_STATUS_PULLING: true,
		runtimev1.ModelStatus_MODEL_STATUS_REMOVED: true,
	},
}

func canTransitionModel(from runtimev1.ModelStatus, to runtimev1.ModelStatus) bool {
	targets := allowedModelTransitions[from]
	return targets[to]
}
