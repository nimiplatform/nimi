package localservice

import (
	"context"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func managedLocalModelColdDetail() string {
	return "managed local model available (cold)"
}

// Legacy LocalAsset warm/start leases no longer activate llama-server. Exact
// llama execution is admitted only through AIConfig + machine selection + the
// capability Driver invocation Host.
func (*Service) rejectLlamaLocalAssetResidency(
	_ context.Context,
	model *runtimev1.LocalAssetRecord,
	_ string,
) (*runtimev1.LocalAssetRecord, error) {
	if !isLlamaLocalAsset(model) {
		return model, nil
	}
	return nil, fmt.Errorf("llama LocalAsset residency is retired; select a configured Local Capability Configuration")
}
