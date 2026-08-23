package connector

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func mapCatalogProviderSource(source aicatalog.ProviderSource) runtimev1.ModelCatalogProviderSource {
	switch source {
	case aicatalog.ProviderSourceOverridden:
		return runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_OVERRIDDEN
	case aicatalog.ProviderSourceCustom:
		return runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_CUSTOM
	default:
		return runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_BUILTIN
	}
}

func mapCatalogModelSource(source aicatalog.ModelSource) runtimev1.CatalogModelSource {
	switch source {
	case aicatalog.ModelSourceCustom:
		return runtimev1.CatalogModelSource_CATALOG_MODEL_SOURCE_CUSTOM
	case aicatalog.ModelSourceOverridden:
		return runtimev1.CatalogModelSource_CATALOG_MODEL_SOURCE_OVERRIDDEN
	default:
		return runtimev1.CatalogModelSource_CATALOG_MODEL_SOURCE_BUILTIN
	}
}

func modelCatalogProviderEntryFromRecord(record aicatalog.CatalogProviderRecord) *runtimev1.ModelCatalogProviderEntry {
	entry := ProviderCatalog[record.Provider]
	cap := ProviderCapabilities[record.Provider]
	return &runtimev1.ModelCatalogProviderEntry{
		Provider:                 record.Provider,
		Version:                  int32(record.Version),
		CatalogVersion:           record.CatalogVersion,
		Source:                   mapCatalogProviderSource(record.Source),
		ModelCount:               uint32(record.ModelCount),
		VoiceCount:               uint32(record.VoiceCount),
		Yaml:                     record.YAML,
		DefaultTextModel:         record.DefaultTextModel,
		Capabilities:             append([]string(nil), record.Capabilities...),
		HasOverlay:               record.HasOverlay,
		CustomModelCount:         uint32(record.CustomModelCount),
		OverriddenModelCount:     uint32(record.OverriddenModelCount),
		OverlayUpdatedAt:         record.OverlayUpdatedAt,
		EffectiveYaml:            record.EffectiveYAML,
		DefaultEndpoint:          entry.DefaultEndpoint,
		RequiresExplicitEndpoint: entry.RequiresExplicitEndpoint,
		RuntimePlane:             cap.RuntimePlane,
		ExecutionModule:          cap.ExecutionModule,
		ManagedSupported:         cap.ManagedSupported,
		InventoryMode:            entry.InventoryMode,
	}
}

func (s *Service) listCatalogConnectorModels(subjectUserID string, provider string, rec ConnectorRecord) ([]*runtimev1.ConnectorModelDescriptor, error) {
	modelCatalog := s.modelCatalogResolver()
	if modelCatalog == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
			ActionHint: "configure_runtime_model_catalog_custom_dir",
		})
	}

	provider = strings.TrimSpace(provider)
	models, _, err := modelCatalog.ListModelsForProviderForSubject(subjectUserID, provider)
	if err != nil {
		if errors.Is(err, aicatalog.ErrProviderUnsupported) {
			return []*runtimev1.ConnectorModelDescriptor{}, nil
		}
		return nil, s.internalProviderError("list_connector_models.catalog_models", err)
	}
	providerRecord := catalogProviderRecordForSubject(modelCatalog, subjectUserID, provider)

	descriptors := make([]*runtimev1.ConnectorModelDescriptor, 0, len(models))
	descriptorByProviderModelID := make(map[string]int, len(models))
	for _, model := range models {
		providerModelID := catalogProviderModelID(model.Model)
		identity := remoteModelCatalogIdentityForConnector(rec, providerRecord, model)
		candidate := &runtimev1.ConnectorModelDescriptor{
			ModelLabel:           model.Model.ModelID,
			Available:            true,
			Capabilities:         catalogConnectorModelCapabilities(modelCatalog, subjectUserID, provider, model.Model.ModelID, model.Model.Capabilities),
			RemoteModelCatalogId: identity.remoteModelCatalogID,
			ProviderModelId:      providerModelID,
			Provider:             provider,
			ConnectorSnapshotId:  identity.connectorSnapshotID,
			EndpointProfileId:    identity.endpointProfileID,
			InventorySnapshotId:  identity.inventorySnapshotID,
		}
		if index, ok := descriptorByProviderModelID[providerModelID]; ok {
			existing := descriptors[index]
			existing.Capabilities = mergeConnectorModelCapabilities(existing.GetCapabilities(), candidate.GetCapabilities())
			continue
		}
		descriptorByProviderModelID[providerModelID] = len(descriptors)
		descriptors = append(descriptors, candidate)
	}
	return descriptors, nil
}

func mergeConnectorModelCapabilities(left, right []string) []string {
	merged := make([]string, 0, len(left)+len(right))
	seen := make(map[string]struct{}, len(left)+len(right))
	for _, capabilities := range [][]string{left, right} {
		for _, capability := range capabilities {
			normalized := strings.TrimSpace(capability)
			if normalized == "" {
				continue
			}
			if _, ok := seen[normalized]; ok {
				continue
			}
			seen[normalized] = struct{}{}
			merged = append(merged, normalized)
		}
	}
	return merged
}

type remoteModelCatalogIdentity struct {
	remoteModelCatalogID string
	connectorSnapshotID  string
	endpointProfileID    string
	inventorySnapshotID  string
}

type RemoteModelCatalogRef struct {
	ConnectorID          string
	RemoteModelCatalogID string
	ProviderModelID      string
	Provider             string
}

type RemoteModelCatalogBinding struct {
	ConnectorID          string
	RemoteModelCatalogID string
	ProviderModelID      string
	Provider             string
	EndpointProfileID    string
	ConnectorSnapshotID  string
	InventorySnapshotID  string
	Capabilities         []string
}

// ResolveExactAccountConnectorBinding resolves only the exact account-owned
// Connector reference committed by AIConfig. It never searches for or
// substitutes another Connector.
func ResolveExactAccountConnectorBinding(
	store *ConnectorStore,
	modelCatalog *aicatalog.Resolver,
	accountID string,
	ref RemoteModelCatalogRef,
) (ConnectorRecord, *RemoteModelCatalogBinding, error) {
	accountID = strings.TrimSpace(accountID)
	provider := strings.TrimSpace(ref.Provider)
	connectorID := strings.TrimSpace(ref.ConnectorID)
	if store == nil || accountID == "" || provider == "" || connectorID == "" {
		return ConnectorRecord{}, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	remoteModelCatalogID := strings.TrimSpace(ref.RemoteModelCatalogID)
	if remoteModelCatalogID == "" {
		return ConnectorRecord{}, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	record, found, err := store.Get(connectorID)
	if err != nil {
		return ConnectorRecord{}, nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{Message: "connector registry could not be read"})
	}
	if !found || record.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED ||
		record.OwnerType != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER ||
		record.OwnerID != accountID || strings.TrimSpace(record.Provider) != provider {
		return ConnectorRecord{}, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	binding, err := ResolveRemoteModelCatalogBinding(modelCatalog, accountID, record, ref)
	if err != nil {
		return ConnectorRecord{}, nil, err
	}
	if record.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
		return ConnectorRecord{}, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)
	}
	if !record.HasCredential {
		return ConnectorRecord{}, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}
	return record, &binding, nil
}

func ResolveRemoteModelCatalogRef(modelCatalog *aicatalog.Resolver, subjectUserID string, rec ConnectorRecord, ref RemoteModelCatalogRef) (string, error) {
	binding, err := ResolveRemoteModelCatalogBinding(modelCatalog, subjectUserID, rec, ref)
	if err != nil {
		return "", err
	}
	return binding.ProviderModelID, nil
}

func ResolveRemoteModelCatalogBinding(modelCatalog *aicatalog.Resolver, subjectUserID string, rec ConnectorRecord, ref RemoteModelCatalogRef) (RemoteModelCatalogBinding, error) {
	remoteModelCatalogID := strings.TrimSpace(ref.RemoteModelCatalogID)
	if remoteModelCatalogID == "" {
		return RemoteModelCatalogBinding{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_ID_REQUIRED)
	}
	provider := strings.TrimSpace(ref.Provider)
	if provider == "" {
		provider = strings.TrimSpace(rec.Provider)
	}
	if !strings.EqualFold(provider, strings.TrimSpace(rec.Provider)) {
		return RemoteModelCatalogBinding{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE)
	}
	if connectorID := strings.TrimSpace(ref.ConnectorID); connectorID != "" && connectorID != strings.TrimSpace(rec.ConnectorID) {
		return RemoteModelCatalogBinding{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE)
	}
	providerModelID := strings.TrimSpace(ref.ProviderModelID)
	if providerModelID == "" {
		return RemoteModelCatalogBinding{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODEL_ID_REQUIRED)
	}
	if modelCatalog == nil {
		return RemoteModelCatalogBinding{}, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
			ActionHint: "configure_runtime_model_catalog_custom_dir",
		})
	}
	models, _, err := modelCatalog.ListModelsForProviderForSubject(subjectUserID, provider)
	if err != nil {
		if errors.Is(err, aicatalog.ErrProviderUnsupported) {
			return RemoteModelCatalogBinding{}, remoteModelCatalogStaleError(err)
		}
		return RemoteModelCatalogBinding{}, err
	}
	providerRecord := catalogProviderRecordForSubject(modelCatalog, subjectUserID, provider)
	for _, model := range models {
		identity := remoteModelCatalogIdentityForConnector(rec, providerRecord, model)
		if identity.remoteModelCatalogID != remoteModelCatalogID {
			continue
		}
		executableProviderModelID := catalogProviderModelID(model.Model)
		if executableProviderModelID != providerModelID {
			return RemoteModelCatalogBinding{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE)
		}
		return RemoteModelCatalogBinding{
			ConnectorID:          strings.TrimSpace(rec.ConnectorID),
			RemoteModelCatalogID: identity.remoteModelCatalogID,
			ProviderModelID:      executableProviderModelID,
			Provider:             provider,
			EndpointProfileID:    identity.endpointProfileID,
			ConnectorSnapshotID:  identity.connectorSnapshotID,
			InventorySnapshotID:  identity.inventorySnapshotID,
			Capabilities:         append([]string(nil), model.Model.Capabilities...),
		}, nil
	}
	return RemoteModelCatalogBinding{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE)
}

func catalogProviderModelID(model aicatalog.ModelEntry) string {
	if apiModelID := strings.TrimSpace(model.ApiModelID); apiModelID != "" {
		return apiModelID
	}
	return strings.TrimSpace(model.ModelID)
}

func catalogProviderRecordForSubject(modelCatalog *aicatalog.Resolver, subjectUserID string, provider string) aicatalog.CatalogProviderRecord {
	if modelCatalog == nil {
		return aicatalog.CatalogProviderRecord{Provider: strings.TrimSpace(provider)}
	}
	for _, record := range modelCatalog.ListProvidersForSubject(subjectUserID) {
		if strings.EqualFold(strings.TrimSpace(record.Provider), strings.TrimSpace(provider)) {
			return record
		}
	}
	return aicatalog.CatalogProviderRecord{Provider: strings.TrimSpace(provider)}
}

func remoteModelCatalogIdentityForConnector(rec ConnectorRecord, providerRecord aicatalog.CatalogProviderRecord, model aicatalog.CatalogModelRecord) remoteModelCatalogIdentity {
	provider := strings.TrimSpace(rec.Provider)
	providerModelID := catalogProviderModelID(model.Model)
	// Credential availability is live custody/admission state, not part of the
	// durable implementation-target identity selected by Nimi configuration.
	connectorSnapshotID := stableID("connector-snapshot",
		strings.TrimSpace(rec.ConnectorID),
		provider,
		strings.TrimSpace(rec.Endpoint),
		rec.AuthKind.String(),
		strings.TrimSpace(rec.ProviderAuthProfile),
	)
	endpointProfileID := stableID("endpoint-profile",
		provider,
		strings.TrimSpace(rec.Endpoint),
		rec.AuthKind.String(),
		strings.TrimSpace(rec.ProviderAuthProfile),
	)
	inventorySnapshotID := stableID("remote-inventory",
		provider,
		fmt.Sprintf("%d", providerRecord.Version),
		strings.TrimSpace(providerRecord.CatalogVersion),
		fmt.Sprintf("%s", providerRecord.Source),
		strings.TrimSpace(providerRecord.OverlayUpdatedAt),
	)
	return remoteModelCatalogIdentity{
		remoteModelCatalogID: stableID("remote-model-catalog",
			strings.TrimSpace(rec.ConnectorID),
			provider,
			providerModelID,
			connectorSnapshotID,
			endpointProfileID,
			inventorySnapshotID,
		),
		connectorSnapshotID: connectorSnapshotID,
		endpointProfileID:   endpointProfileID,
		inventorySnapshotID: inventorySnapshotID,
	}
}

func stableID(namespace string, values ...string) string {
	h := sha256.New()
	_, _ = h.Write([]byte(strings.TrimSpace(namespace)))
	for _, value := range values {
		_, _ = h.Write([]byte{0})
		_, _ = h.Write([]byte(strings.TrimSpace(value)))
	}
	sum := hex.EncodeToString(h.Sum(nil))
	return strings.TrimSpace(namespace) + "_" + sum[:32]
}

func catalogConnectorModelCapabilities(
	modelCatalog *aicatalog.Resolver,
	subjectUserID string,
	provider string,
	modelID string,
	baseCapabilities []string,
) []string {
	capabilities := append([]string(nil), baseCapabilities...)
	seen := make(map[string]struct{}, len(capabilities)+2)
	for _, capability := range capabilities {
		normalized := strings.TrimSpace(capability)
		if normalized != "" {
			seen[normalized] = struct{}{}
		}
	}
	appendIfSupported := func(scenarioType runtimev1.ScenarioType, capability string) {
		if _, ok := seen[capability]; ok || modelCatalog == nil {
			return
		}
		supported, err := modelCatalog.SupportsScenarioForSubject(subjectUserID, provider, modelID, scenarioType)
		if err != nil || !supported {
			return
		}
		seen[capability] = struct{}{}
		capabilities = append(capabilities, capability)
	}
	appendIfSupported(runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE, aicapabilities.VoiceCreate)
	return capabilities
}
