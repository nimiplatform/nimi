package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localrouting"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
)

// localModelLister remains the exact non-llama LocalAsset lifecycle seam used
// by media/speech paths that already carry a durable v2 binding. It is never
// consulted to select or infer a text model.
func requestExplicitlyDeclaresLocalExecution(head *runtimev1.ScenarioRequestHead) bool {
	if head == nil {
		return false
	}
	if head.GetTargetRef().GetLocalRuntime() != nil {
		return true
	}
	return head.GetTargetRef().GetCloud() == nil && head.GetRoutePolicy() == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
}

func localExactMediaUnsupportedError(scenarioType runtimev1.ScenarioType) error {
	return grpcerr.WithReasonCodeOptions(
		codes.FailedPrecondition,
		runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
		grpcerr.ReasonOptions{
			Message:  "selected Local capability has no admitted execution Driver",
			Metadata: map[string]string{"scenario_type": scenarioType.String()},
		},
	)
}

type localModelLister interface {
	ListLocalAssets(context.Context, *runtimev1.ListLocalAssetsRequest) (*runtimev1.ListLocalAssetsResponse, error)
	WarmLocalAsset(context.Context, *runtimev1.WarmLocalAssetRequest) (*runtimev1.WarmLocalAssetResponse, error)
	StartLocalAsset(context.Context, *runtimev1.StartLocalAssetRequest) (*runtimev1.StartLocalAssetResponse, error)
	AcquireLocalAssetLease(context.Context, string, string) error
	ReleaseLocalAssetLease(context.Context, string, string) error
}

type durableLocalTargetResolver interface {
	ResolveDurableLocalTarget(context.Context, *runtimev1.RuntimeDurableLocalTargetRef, string) (*runtimev1.RuntimeResolvedLocalExecutionBinding, *runtimev1.LocalAssetRecord, error)
}

type localImageProfileResolver interface {
	ResolveManagedMediaImageProfile(context.Context, string, map[string]any) (string, map[string]any, map[string]any, error)
	ResolveManagedMediaImageProfileForLocalAsset(context.Context, string, map[string]any) (string, map[string]any, map[string]any, error)
	ResolveManagedMediaImageProfileForBinding(context.Context, string, string, map[string]any) (string, map[string]any, map[string]any, error)
	ResolveManagedMediaBackendTarget(context.Context) (string, string, error)
	ResolveManagedAssetPath(context.Context, string) (string, error)
	ResolveCanonicalImageSelection(context.Context, string) (engine.ImageSupervisedMatrixSelection, error)
	ResolveCanonicalImageSelectionForLocalAsset(context.Context, string) (engine.ImageSupervisedMatrixSelection, error)
	EnsureManagedMediaImageLoaded(context.Context, string, string, map[string]any, map[string]any, string) (*nimillm.ManagedMediaImageLoadDiagnostics, error)
	ReleaseManagedMediaImage(context.Context, string, string, map[string]any, map[string]any, string) error
	UpdateManagedMediaImageExecutionStatus(context.Context, string, bool, string) error
}

type localModelExecutionPlan struct {
	requestedModelID string
	resolvedModelID  string
	providerModelID  string
	modal            runtimev1.Modal
	selected         *runtimev1.LocalAssetRecord
	targetBinding    *runtimev1.RuntimeResolvedLocalExecutionBinding
}

func (p *localModelExecutionPlan) selectedLocalAssetID() string {
	if p == nil || p.selected == nil {
		return ""
	}
	return strings.TrimSpace(p.selected.GetLocalAssetId())
}

func (p *localModelExecutionPlan) resolvedProviderModelID(fallback string) string {
	if p != nil && strings.TrimSpace(p.providerModelID) != "" {
		return strings.TrimSpace(p.providerModelID)
	}
	return strings.TrimSpace(fallback)
}

func applyLocalExecutionPlanModelResolved(plan *localModelExecutionPlan, modelResolved string, remoteTarget *nimillm.RemoteTarget, selected provider) string {
	if plan == nil || remoteTarget != nil || selected == nil || selected.Route() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return strings.TrimSpace(modelResolved)
	}
	return plan.resolvedProviderModelID(modelResolved)
}

func (s *Service) prepareDurableLocalModelExecutionPlan(
	_ context.Context,
	requestedModelID string,
	binding *runtimev1.RuntimeResolvedLocalExecutionBinding,
	selected *runtimev1.LocalAssetRecord,
	modal runtimev1.Modal,
	_ map[string]any,
) (*localModelExecutionPlan, error) {
	if s == nil || binding == nil || selected == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	if strings.EqualFold(strings.TrimSpace(selected.GetEngine()), "llama") {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED, grpcerr.ReasonOptions{
			Message: "legacy durable llama targets are retired; text execution requires AIConfig plus machine selection",
		})
	}
	resolvedModelID := strings.TrimSpace(binding.GetResolvedModelId())
	if resolvedModelID == "" || strings.TrimSpace(requestedModelID) != resolvedModelID ||
		strings.TrimSpace(binding.GetLocalAssetId()) == "" ||
		strings.TrimSpace(binding.GetLocalAssetId()) != strings.TrimSpace(selected.GetLocalAssetId()) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_AI_CONFIG_MODEL_TARGET_MISMATCH)
	}
	status := selected.GetStatus()
	if status != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE &&
		!(modal == runtimev1.Modal_MODAL_IMAGE && status == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	providerModelID := strings.TrimSpace(selected.GetAssetId())
	if providerModelID == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	hydrateExactLocalProvider(s, selected, modal == runtimev1.Modal_MODAL_IMAGE)
	return &localModelExecutionPlan{
		requestedModelID: strings.TrimSpace(requestedModelID),
		resolvedModelID:  resolvedModelID,
		providerModelID:  providerModelID,
		modal:            modal,
		selected:         selected,
		targetBinding:    binding,
	}, nil
}

func hydrateExactLocalProvider(s *Service, model *runtimev1.LocalAssetRecord, allowInstalled bool) {
	if s == nil || model == nil {
		return
	}
	if model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE &&
		!(allowInstalled && model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED) {
		return
	}
	providerID := strings.ToLower(strings.TrimSpace(model.GetEngine()))
	endpoint := strings.TrimSpace(model.GetEndpoint())
	if endpoint == "" || providerID == "llama" || !localrouting.IsKnownProvider(providerID) {
		return
	}
	s.SetLocalProviderEndpoint(providerID, endpoint, "")
}

func (s *Service) acquireSelectedLocalModelLease(
	ctx context.Context,
	requestedModelID string,
	remoteTarget *nimillm.RemoteTarget,
	modal runtimev1.Modal,
	leaseReason string,
) (func(), error) {
	return s.acquireSelectedLocalModelLeaseWithPlan(ctx, nil, requestedModelID, remoteTarget, modal, leaseReason)
}

func (s *Service) acquireSelectedLocalModelLeaseWithPlan(
	ctx context.Context,
	plan *localModelExecutionPlan,
	requestedModelID string,
	remoteTarget *nimillm.RemoteTarget,
	modal runtimev1.Modal,
	leaseReason string,
) (func(), error) {
	_ = requestedModelID
	_ = modal
	if remoteTarget != nil {
		return func() {}, nil
	}
	if plan == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	localAssetID := plan.selectedLocalAssetID()
	if s == nil || s.localModel == nil || localAssetID == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	if err := s.localModel.AcquireLocalAssetLease(ctx, localAssetID, leaseReason); err != nil {
		return nil, err
	}
	return func() {
		_ = s.localModel.ReleaseLocalAssetLease(context.Background(), localAssetID, leaseReason+"_cleanup")
	}, nil
}

func localRoutingCapabilityForModal(modal runtimev1.Modal) string {
	switch modal {
	case runtimev1.Modal_MODAL_IMAGE:
		return "image.generate"
	case runtimev1.Modal_MODAL_VIDEO:
		return "video.generate"
	case runtimev1.Modal_MODAL_TTS:
		return "audio.synthesize"
	case runtimev1.Modal_MODAL_STT:
		return "audio.transcribe"
	case runtimev1.Modal_MODAL_MUSIC:
		return "music.generate"
	case runtimev1.Modal_MODAL_EMBEDDING:
		return "text.embed"
	default:
		return "text.generate"
	}
}
