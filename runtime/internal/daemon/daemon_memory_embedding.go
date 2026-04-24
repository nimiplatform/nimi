package daemon

import (
	"context"
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/httpserver"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

func selectManagedEmbeddingProfile(assets []*runtimev1.LocalAssetRecord) *runtimev1.MemoryEmbeddingProfile {
	if len(assets) == 0 {
		return nil
	}
	filtered := make([]*runtimev1.LocalAssetRecord, 0, len(assets))
	for _, asset := range assets {
		if asset == nil || asset.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
			continue
		}
		filtered = append(filtered, asset)
	}
	if len(filtered) == 0 {
		return nil
	}
	sort.Slice(filtered, func(i, j int) bool {
		assetIDI := strings.TrimSpace(filtered[i].GetAssetId())
		assetIDJ := strings.TrimSpace(filtered[j].GetAssetId())
		if assetIDI != assetIDJ {
			return assetIDI < assetIDJ
		}
		return strings.TrimSpace(filtered[i].GetLocalAssetId()) < strings.TrimSpace(filtered[j].GetLocalAssetId())
	})
	selected := filtered[0]
	modelID := strings.TrimSpace(selected.GetAssetId())
	if modelID == "" {
		modelID = strings.TrimSpace(selected.GetLocalAssetId())
	}
	if modelID == "" {
		return nil
	}
	version := modelID
	timestamp := strings.TrimSpace(selected.GetUpdatedAt())
	if timestamp == "" {
		timestamp = strings.TrimSpace(selected.GetInstalledAt())
	}
	if timestamp != "" {
		version = modelID + "@" + timestamp
	}
	return &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         modelID,
		Dimension:       256,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         version,
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	}
}
func (d *Daemon) bindCanonicalMemoryStandard(ctx context.Context, agentID string) (httpserver.CanonicalBindResult, error) {
	memorySvc := d.grpc.MemoryService()
	if memorySvc == nil {
		return httpserver.CanonicalBindResult{}, fmt.Errorf("memory service is unavailable")
	}
	if err := d.refreshManagedEmbeddingProfile(ctx); err != nil {
		return httpserver.CanonicalBindResult{}, err
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: strings.TrimSpace(agentID)},
		},
	}
	ensured, err := memorySvc.EnsureCanonicalBank(ctx, locator, "", nil)
	if err != nil {
		return httpserver.CanonicalBindResult{}, err
	}
	if ensured.GetEmbeddingProfile() != nil {
		return httpserver.CanonicalBindResult{
			AlreadyBound: true,
			Bank:         ensured,
		}, nil
	}
	bound, err := memorySvc.BindCanonicalBankEmbeddingProfile(ctx, locator)
	if err != nil {
		return httpserver.CanonicalBindResult{}, err
	}
	return httpserver.CanonicalBindResult{
		AlreadyBound: false,
		Bank:         bound,
	}, nil
}
func memoryEmbeddingIntentSnapshotFromHTTP(input *httpserver.MemoryEmbeddingBindingIntentSnapshot) *memoryservice.MemoryEmbeddingBindingIntentSnapshot {
	if input == nil {
		return nil
	}
	return &memoryservice.MemoryEmbeddingBindingIntentSnapshot{
		SourceKind: memoryservice.MemoryEmbeddingBindingSourceKind(strings.TrimSpace(input.SourceKind)),
		CloudBinding: func() *memoryservice.MemoryEmbeddingCloudBindingRef {
			if input.CloudBinding == nil {
				return nil
			}
			return &memoryservice.MemoryEmbeddingCloudBindingRef{
				ConnectorID: strings.TrimSpace(input.CloudBinding.ConnectorID),
				ModelID:     strings.TrimSpace(input.CloudBinding.ModelID),
			}
		}(),
		LocalBinding: func() *memoryservice.MemoryEmbeddingLocalBindingRef {
			if input.LocalBinding == nil {
				return nil
			}
			return &memoryservice.MemoryEmbeddingLocalBindingRef{
				LocalModelID: strings.TrimSpace(input.LocalBinding.TargetID),
			}
		}(),
		RevisionToken: strings.TrimSpace(input.RevisionToken),
	}
}
func runtimeAgentBankLocator(agentID string) *runtimev1.MemoryBankLocator {
	return &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: strings.TrimSpace(agentID)},
		},
	}
}
func (d *Daemon) inspectMemoryEmbeddingForAgent(ctx context.Context, req httpserver.MemoryEmbeddingAgentRequest) (httpserver.MemoryEmbeddingInspectResult, error) {
	memorySvc := d.grpc.MemoryService()
	if memorySvc == nil {
		return httpserver.MemoryEmbeddingInspectResult{}, fmt.Errorf("memory service is unavailable")
	}
	if err := d.refreshManagedEmbeddingProfile(ctx); err != nil {
		return httpserver.MemoryEmbeddingInspectResult{}, err
	}
	state, err := memorySvc.InspectMemoryEmbeddingState(ctx, memoryservice.InspectMemoryEmbeddingStateRequest{
		Locator:               runtimeAgentBankLocator(req.TargetRef.AgentID),
		BindingIntentSnapshot: memoryEmbeddingIntentSnapshotFromHTTP(req.BindingIntentSnapshot),
	})
	if err != nil {
		return httpserver.MemoryEmbeddingInspectResult{}, err
	}
	result := httpserver.MemoryEmbeddingInspectResult{
		BindingIntentPresent:    state.BindingIntentPresent,
		BindingSourceKind:       strings.TrimSpace(string(state.BindingSourceKind)),
		ResolutionState:         strings.TrimSpace(state.ResolutionState),
		ResolvedProfileIdentity: memoryserviceProfileIdentity(state.ResolvedProfileIdentity),
		CanonicalBankStatus:     strings.TrimSpace(state.CanonicalBankStatus),
		BlockedReasonCode:       reasonCodeString(state.BlockedReasonCode),
	}
	result.OperationReadiness.BindAllowed = state.OperationReadiness.BindAllowed
	result.OperationReadiness.CutoverAllowed = state.OperationReadiness.CutoverAllowed
	return result, nil
}
func (d *Daemon) requestMemoryEmbeddingBindForAgent(ctx context.Context, req httpserver.MemoryEmbeddingAgentRequest) (httpserver.MemoryEmbeddingBindResult, error) {
	memorySvc := d.grpc.MemoryService()
	if memorySvc == nil {
		return httpserver.MemoryEmbeddingBindResult{}, fmt.Errorf("memory service is unavailable")
	}
	if err := d.refreshManagedEmbeddingProfile(ctx); err != nil {
		return httpserver.MemoryEmbeddingBindResult{}, err
	}
	result, err := memorySvc.RequestCanonicalMemoryEmbeddingBind(ctx, memoryservice.RequestCanonicalMemoryEmbeddingBindRequest{
		Locator:               runtimeAgentBankLocator(req.TargetRef.AgentID),
		BindingIntentSnapshot: memoryEmbeddingIntentSnapshotFromHTTP(req.BindingIntentSnapshot),
	})
	if err != nil {
		return httpserver.MemoryEmbeddingBindResult{}, err
	}
	return httpserver.MemoryEmbeddingBindResult{
		Outcome:                  strings.TrimSpace(result.Outcome),
		BlockedReasonCode:        reasonCodeString(result.BlockedReasonCode),
		CanonicalBankStatusAfter: strings.TrimSpace(result.CanonicalBankStatusAfter),
		PendingCutover:           result.PendingCutover,
	}, nil
}
func (d *Daemon) requestMemoryEmbeddingCutoverForAgent(ctx context.Context, req httpserver.MemoryEmbeddingAgentRequest) (httpserver.MemoryEmbeddingCutoverResult, error) {
	memorySvc := d.grpc.MemoryService()
	if memorySvc == nil {
		return httpserver.MemoryEmbeddingCutoverResult{}, fmt.Errorf("memory service is unavailable")
	}
	if err := d.refreshManagedEmbeddingProfile(ctx); err != nil {
		return httpserver.MemoryEmbeddingCutoverResult{}, err
	}
	result, err := memorySvc.RequestMemoryEmbeddingCutover(ctx, memoryservice.RequestMemoryEmbeddingCutoverRequest{
		Locator:               runtimeAgentBankLocator(req.TargetRef.AgentID),
		BindingIntentSnapshot: memoryEmbeddingIntentSnapshotFromHTTP(req.BindingIntentSnapshot),
	})
	if err != nil {
		return httpserver.MemoryEmbeddingCutoverResult{}, err
	}
	return httpserver.MemoryEmbeddingCutoverResult{
		Outcome:                  strings.TrimSpace(result.Outcome),
		BlockedReasonCode:        reasonCodeString(result.BlockedReasonCode),
		CanonicalBankStatusAfter: strings.TrimSpace(result.CanonicalBankStatusAfter),
	}, nil
}
func reasonCodeString(value runtimev1.ReasonCode) string {
	if value == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return ""
	}
	return value.String()
}
func memoryserviceProfileIdentity(profile *runtimev1.MemoryEmbeddingProfile) string {
	if profile == nil {
		return ""
	}
	version := strings.TrimSpace(profile.GetVersion())
	modelID := strings.TrimSpace(profile.GetModelId())
	provider := strings.TrimSpace(profile.GetProvider())
	if version != "" {
		return strings.TrimSpace(strings.Join([]string{provider, modelID, version}, ":"))
	}
	return strings.TrimSpace(strings.Join([]string{provider, modelID}, ":"))
}
