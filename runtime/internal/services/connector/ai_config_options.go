package connector

import (
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type AIConfigCloudConnectorOption struct {
	ConnectorRef string
	Label        string
	Provider     string
	State        runtimev1.AIConfigEffectiveState
	Reasons      []runtimev1.ReasonCode
}

type AIConfigCloudTargetOption struct {
	ConnectorRef      string
	Label             string
	Capability        string
	Implementation    *runtimev1.CapabilityImplementationIdentity
	ProviderTarget    *structpb.Struct
	SupportedFeatures []string
	State             runtimev1.AIConfigEffectiveState
	Reasons           []runtimev1.ReasonCode
}

// @nimi-authority: rule.nimi.platform.core-protocol.p-caiex-006
// AIConfigEffectiveFailureState distinguishes an exact resource problem from
// a Runtime dependency failure while preserving the original reason separately.
func AIConfigEffectiveFailureState(err error) runtimev1.AIConfigEffectiveState {
	if err == nil {
		return runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY
	}
	if code := status.Code(err); code == codes.Internal || code == codes.Unavailable {
		return runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		if reason == runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND {
			return runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_MISSING
		}
		return runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED
	}
	return runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE
}

func aiConfigCloudImplementation(provider string, capabilityContract string) (*runtimev1.CapabilityImplementationIdentity, bool) {
	provider = strings.TrimSpace(provider)
	providerCapability, supported := ProviderCapabilities[provider]
	if !supported || providerCapability.RuntimePlane != "remote" || !providerCapability.ManagedSupported ||
		strings.TrimSpace(providerCapability.ExecutionModule) == "" {
		return nil, false
	}
	if capabilityContract == "realtime.interact" {
		if provider != "dashscope" {
			return nil, false
		}
		return &runtimev1.CapabilityImplementationIdentity{
			ImplementationId: "cloud.realtime.interact.dashscope",
			DriverId:         "nimi.runtime.driver.dashscope",
			DriverDialect:    "dashscope/realtime/v1",
		}, true
	}
	return &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: provider,
		DriverId:         providerCapability.ExecutionModule,
		DriverDialect:    provider,
	}, true
}

// ValidateAIConfigCloudSelection closes the safe configuration boundary for
// one exact Connector, capability, implementation, and provider-model target.
// It performs no credential projection, provider probe, routing, or fallback.
func ValidateAIConfigCloudSelection(
	store *ConnectorStore,
	modelCatalog *aicatalog.Resolver,
	accountID string,
	capabilityContract string,
	implementation *runtimev1.CapabilityImplementationIdentity,
	ref RemoteModelCatalogRef,
) (ConnectorRecord, *RemoteModelCatalogBinding, error) {
	record, binding, err := ResolveExactAccountConnectorBinding(store, modelCatalog, accountID, ref)
	if err != nil {
		return ConnectorRecord{}, nil, err
	}
	expected, supported := aiConfigCloudImplementation(record.Provider, capabilityContract)
	if binding == nil || !supported || !containsExact(binding.Capabilities, strings.TrimSpace(capabilityContract)) ||
		!proto.Equal(implementation, expected) {
		return ConnectorRecord{}, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	return record, binding, nil
}

func ListAIConfigCloudConnectorOptions(
	store *ConnectorStore,
	modelCatalog *aicatalog.Resolver,
	accountID string,
	capabilityContract string,
	search string,
	limit int,
) ([]AIConfigCloudConnectorOption, bool, error) {
	accountID = strings.TrimSpace(accountID)
	capabilityContract = strings.TrimSpace(capabilityContract)
	search = strings.ToLower(strings.TrimSpace(search))
	if store == nil || modelCatalog == nil || accountID == "" || capabilityContract == "" || limit <= 0 {
		return nil, false, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	providers := make(map[string]aicatalog.CatalogProviderRecord)
	for _, provider := range modelCatalog.ListProvidersForSubject(accountID) {
		providers[strings.TrimSpace(provider.Provider)] = provider
	}
	records, err := store.Load()
	if err != nil {
		return nil, false, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
	options := make([]AIConfigCloudConnectorOption, 0)
	for _, record := range records {
		provider := strings.TrimSpace(record.Provider)
		catalogProvider, found := providers[provider]
		providerCapability, supported := ProviderCapabilities[provider]
		if !found || !supported || providerCapability.RuntimePlane != "remote" || !providerCapability.ManagedSupported ||
			record.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED ||
			record.OwnerType != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER || record.OwnerID != accountID ||
			!containsExact(catalogProvider.Capabilities, capabilityContract) {
			continue
		}
		label := strings.TrimSpace(record.Label)
		if label == "" {
			label = provider
		}
		if search != "" && !strings.Contains(strings.ToLower(label+" "+provider), search) {
			continue
		}
		state := runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY
		reasons := []runtimev1.ReasonCode{}
		if record.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
			state = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED
			reasons = append(reasons, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)
		}
		if !record.HasCredential {
			state = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED
			reasons = append(reasons, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
		}
		options = append(options, AIConfigCloudConnectorOption{
			ConnectorRef: record.ConnectorID, Label: label, Provider: provider, State: state, Reasons: reasons,
		})
	}
	sort.Slice(options, func(i, j int) bool {
		if options[i].Label == options[j].Label {
			return options[i].ConnectorRef < options[j].ConnectorRef
		}
		return options[i].Label < options[j].Label
	})
	if len(options) > limit {
		return options[:limit], true, nil
	}
	return options, false, nil
}

func ListAIConfigCloudTargetOptions(
	store *ConnectorStore,
	modelCatalog *aicatalog.Resolver,
	accountID string,
	capabilityContract string,
	connectorRef string,
	search string,
	limit int,
) ([]AIConfigCloudTargetOption, bool, error) {
	accountID = strings.TrimSpace(accountID)
	capabilityContract = strings.TrimSpace(capabilityContract)
	connectorRef = strings.TrimSpace(connectorRef)
	search = strings.ToLower(strings.TrimSpace(search))
	if store == nil || modelCatalog == nil || accountID == "" || capabilityContract == "" || connectorRef == "" || limit <= 0 {
		return nil, false, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	record, found, err := store.Get(connectorRef)
	if err != nil {
		return nil, false, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
	provider := strings.TrimSpace(record.Provider)
	providerCapability, supported := ProviderCapabilities[provider]
	if !found || !supported || providerCapability.RuntimePlane != "remote" || !providerCapability.ManagedSupported ||
		record.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED ||
		record.OwnerType != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER || record.OwnerID != accountID {
		return nil, false, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	models, _, err := modelCatalog.ListModelsForProviderForSubject(accountID, provider)
	if err != nil {
		return nil, false, err
	}
	providerRecord := catalogProviderRecordForSubject(modelCatalog, accountID, provider)
	state := runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY
	reasons := []runtimev1.ReasonCode{}
	if record.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
		state = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED
		reasons = append(reasons, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)
	}
	if !record.HasCredential {
		state = runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED
		reasons = append(reasons, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}
	options := make([]AIConfigCloudTargetOption, 0)
	for _, model := range models {
		if !containsExact(model.Model.Capabilities, capabilityContract) {
			continue
		}
		providerModelID := catalogProviderModelID(model.Model)
		label := strings.TrimSpace(model.Model.ModelID)
		if label == "" {
			label = providerModelID
		}
		if search != "" && !strings.Contains(strings.ToLower(label+" "+providerModelID+" "+provider), search) {
			continue
		}
		identity := remoteModelCatalogIdentityForConnector(record, providerRecord, model)
		target, err := structpb.NewStruct(map[string]any{
			"provider": provider, "providerModelId": providerModelID,
			"remoteModelCatalogId": identity.remoteModelCatalogID,
		})
		if err != nil {
			return nil, false, err
		}
		implementation, implementationSupported := aiConfigCloudImplementation(provider, capabilityContract)
		if !implementationSupported {
			continue
		}
		options = append(options, AIConfigCloudTargetOption{
			ConnectorRef: connectorRef, Label: label, Capability: capabilityContract,
			Implementation: implementation,
			ProviderTarget: target, SupportedFeatures: append([]string(nil), model.Model.Features...),
			State: state, Reasons: append([]runtimev1.ReasonCode(nil), reasons...),
		})
	}
	sort.Slice(options, func(i, j int) bool { return options[i].Label < options[j].Label })
	if len(options) > limit {
		return options[:limit], true, nil
	}
	return options, false, nil
}

func containsExact(values []string, expected string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == expected {
			return true
		}
	}
	return false
}
