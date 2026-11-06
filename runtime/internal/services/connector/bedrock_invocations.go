package connector

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/bedrocktarget"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func normalizeBedrockEndpoint(raw string) (string, error) {
	endpoint, err := bedrocktarget.Endpoint(raw)
	if err != nil {
		return "", grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID, grpcerr.ReasonOptions{Message: err.Error(), ActionHint: "configure_bedrock_runtime_endpoint"})
	}
	return endpoint, nil
}

type BedrockInvocation struct {
	ProviderModelID   string `json:"provider_model_id"`
	InvocationModelID string `json:"invocation_model_id"`
}
type BedrockInvocationsConfig struct {
	Invocations []BedrockInvocation `json:"invocations"`
}

func CloneBedrockInvocations(value *BedrockInvocationsConfig) *BedrockInvocationsConfig {
	if value == nil {
		return nil
	}
	return &BedrockInvocationsConfig{Invocations: append([]BedrockInvocation(nil), value.Invocations...)}
}

func ValidBedrockInvocations(value *BedrockInvocationsConfig) bool {
	if value == nil || len(value.Invocations) == 0 || len(value.Invocations) > 128 {
		return false
	}
	models := map[string]bool{}
	for _, binding := range value.Invocations {
		if models[binding.ProviderModelID] || !bedrocktarget.ValidInvocation(binding.ProviderModelID, binding.InvocationModelID) {
			return false
		}
		models[binding.ProviderModelID] = true
	}
	return true
}

func BedrockInvocationForModel(value *BedrockInvocationsConfig, model string) string {
	if value != nil {
		for _, binding := range value.Invocations {
			if binding.ProviderModelID == model {
				return binding.InvocationModelID
			}
		}
	}
	return ""
}

func bedrockInvocationsProjection(value *BedrockInvocationsConfig) *runtimev1.ConnectorBedrockInvocations {
	if value == nil {
		return nil
	}
	out := &runtimev1.ConnectorBedrockInvocations{}
	for _, binding := range value.Invocations {
		out.Invocations = append(out.Invocations, &runtimev1.ConnectorBedrockInvocation{ProviderModelId: binding.ProviderModelID, InvocationModelId: binding.InvocationModelID})
	}
	return out
}

// @nimi-authority: rule.nimi.runtime.ai-provider.bedrock-native-routing
func (s *Service) resolveBedrockInvocations(owner string, record ConnectorRecord, value *runtimev1.ConnectorBedrockInvocations) (*BedrockInvocationsConfig, error) {
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	if record.Provider != "bedrock" || normalizeAuthKind(record.AuthKind) != runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY {
		return nil, invalid
	}
	if len(value.GetInvocations()) == 0 {
		return nil, nil
	}
	config := &BedrockInvocationsConfig{}
	for _, binding := range value.GetInvocations() {
		config.Invocations = append(config.Invocations, BedrockInvocation{ProviderModelID: binding.GetProviderModelId(), InvocationModelID: binding.GetInvocationModelId()})
	}
	if !ValidBedrockInvocations(config) {
		return nil, invalid
	}
	models, err := s.listCatalogConnectorModels(owner, record.Provider, record)
	if err != nil {
		return nil, err
	}
	known := map[string]bool{}
	for _, model := range models {
		known[model.GetProviderModelId()] = true
	}
	for _, binding := range config.Invocations {
		if !known[binding.ProviderModelID] || !bedrocktarget.InvocationRegionAllowed(record.Endpoint, binding.ProviderModelID, binding.InvocationModelID) {
			return nil, invalid
		}
	}
	return config, nil
}

func validBedrockInvocationRegions(endpoint string, config *BedrockInvocationsConfig) bool {
	if config != nil {
		for _, binding := range config.Invocations {
			if !bedrocktarget.InvocationRegionAllowed(endpoint, binding.ProviderModelID, binding.InvocationModelID) {
				return false
			}
		}
	}
	return true
}

func BedrockInvocationRequiredError() error {
	return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID, grpcerr.ReasonOptions{Message: "Configure the selected model's Bedrock invocation ID in Home", ActionHint: "configure_bedrock_model_invocation"})
}
