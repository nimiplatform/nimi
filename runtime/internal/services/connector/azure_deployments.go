package connector

import (
	"strings"
	"unicode"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

type AzureDeployment struct {
	ProviderModelID string `json:"provider_model_id"`
	DeploymentName  string `json:"deployment_name"`
}
type AzureDeploymentsConfig struct {
	Deployments []AzureDeployment `json:"deployments"`
}

func CloneAzureDeployments(value *AzureDeploymentsConfig) *AzureDeploymentsConfig {
	if value == nil {
		return nil
	}
	return &AzureDeploymentsConfig{Deployments: append([]AzureDeployment(nil), value.Deployments...)}
}

func ValidAzureDeployments(value *AzureDeploymentsConfig) bool {
	if value == nil || len(value.Deployments) == 0 || len(value.Deployments) > 128 {
		return false
	}
	models, names := map[string]bool{}, map[string]bool{}
	for _, binding := range value.Deployments {
		for _, v := range []string{binding.ProviderModelID, binding.DeploymentName} {
			if v == "" || len(v) > 256 || v != strings.TrimSpace(v) || !utf8.ValidString(v) || strings.ContainsFunc(v, unicode.IsControl) {
				return false
			}
		}
		if models[binding.ProviderModelID] || names[binding.DeploymentName] {
			return false
		}
		models[binding.ProviderModelID], names[binding.DeploymentName] = true, true
	}
	return true
}

// AzureDeploymentForModel reads an immutable, owner-validated binding set.
func AzureDeploymentForModel(value *AzureDeploymentsConfig, model string) string {
	if value != nil {
		for _, binding := range value.Deployments {
			if binding.ProviderModelID == model {
				return binding.DeploymentName
			}
		}
	}
	return ""
}

func azureDeploymentsProjection(value *AzureDeploymentsConfig) *runtimev1.ConnectorAzureDeployments {
	if value == nil {
		return nil
	}
	out := &runtimev1.ConnectorAzureDeployments{}
	for _, binding := range value.Deployments {
		out.Deployments = append(out.Deployments, &runtimev1.ConnectorAzureDeployment{ProviderModelId: binding.ProviderModelID, DeploymentName: binding.DeploymentName})
	}
	return out
}

// @nimi-authority: rule.nimi.runtime.ai-provider.azure-deployment-bindings
func (s *Service) resolveAzureDeployments(owner string, record ConnectorRecord, value *runtimev1.ConnectorAzureDeployments) (*AzureDeploymentsConfig, error) {
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	if record.Provider != "azure" || normalizeAuthKind(record.AuthKind) != runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY {
		return nil, invalid
	}
	if len(value.GetDeployments()) == 0 {
		return nil, nil
	}
	config := &AzureDeploymentsConfig{}
	for _, binding := range value.GetDeployments() {
		config.Deployments = append(config.Deployments, AzureDeployment{ProviderModelID: binding.GetProviderModelId(), DeploymentName: binding.GetDeploymentName()})
	}
	if !ValidAzureDeployments(config) {
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
	for _, binding := range config.Deployments {
		if !known[binding.ProviderModelID] {
			return nil, invalid
		}
	}
	return config, nil
}

func AzureDeploymentRequiredError() error {
	return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID, grpcerr.ReasonOptions{Message: "Configure an Azure deployment for the selected model in Home", ActionHint: "configure_azure_model_deployment"})
}
