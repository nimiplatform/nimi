package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func repeatedLocalAssetResponses(n int, assets ...*runtimev1.LocalAssetRecord) []*runtimev1.ListLocalAssetsResponse {
	responses := make([]*runtimev1.ListLocalAssetsResponse, 0, n)
	for i := 0; i < n; i++ {
		responses = append(responses, &runtimev1.ListLocalAssetsResponse{
			Assets: assets,
		})
	}
	return responses
}
