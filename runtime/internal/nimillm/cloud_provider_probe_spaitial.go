package nimillm

import (
	"context"
	"net/http"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r025
// The native authenticated model-list GET is a bounded connection diagnostic.
// It does not hydrate inventory, select a model, or establish a World route.
func (p *CloudProvider) probeSpaitialConnector(ctx context.Context, endpoint, apiKey string) error {
	cfg := MediaAdapterConfig{BaseURL: endpoint, APIKey: apiKey, AllowLoopbackEndpoint: p.allowLoopbackEndpoint}
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	ctx, cancel := context.WithTimeout(ctx, p.probeTimeout())
	defer cancel()
	response := map[string]any{}
	return spaitialJSON(ctx, cfg, http.MethodGet, "/v1/models", nil, "", &response)
}
