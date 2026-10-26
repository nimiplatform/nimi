package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aitelemetry"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-ai-execution
func (s *Service) SetAIObservationStore(owner *aitelemetry.Store) {
	s.aiObservation = owner
	if owner == nil {
		return
	}
	// These are execution-source coverage declarations, not model/provider
	// availability. Actual attempts still enter only at the captured Hosts or
	// Realtime response boundaries; unknown response association records a gap.
	for _, source := range []string{"home", "app", "direct-runtime", "local-agent", "agent-background", "realtime"} {
		owner.SetSourceCoverage(source, true, true)
	}
}

func observedSource(ctx context.Context, appID, operationID string) aitelemetry.Source {
	source, exists := aitelemetry.SourceFromContext(ctx)
	if !exists {
		source = aitelemetry.Source{Kind: "direct-runtime", ID: appID, Label: appID}
		if decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); ok {
			source.Kind = "app"
			source.ID = decision.RegisteredAppSubject
			if decision.AppID == envelope.ProtectedDesktopAppID {
				source.Kind = "home"
				source.Label = "Nimi Home"
			}
		}
	}
	if source.ParentID == "" && source.Kind != "local-agent" && source.Kind != "agent-background" {
		source.ParentID = operationID
		source.ParentKind = "scenario-job"
	}
	return source
}

func (s *Service) aiObservationFacts(ctx context.Context, accountID, appID, operationID, capability string, models []*runtimev1.DesktopAIExecutionModel, route runtimev1.DesktopAIExecutionRoute) aitelemetry.Facts {
	facts := aitelemetry.Facts{AccountID: accountID, OperationID: operationID, Source: observedSource(ctx, appID, operationID), Capability: capability, Models: models, Route: route}
	if route == runtimev1.DesktopAIExecutionRoute_DESKTOP_AI_EXECUTION_ROUTE_CLOUD && len(models) == 1 && s.speechCatalog != nil {
		if model, err := s.speechCatalog.ResolveModelEntryForSubject(accountID, models[0].GetProviderId(), models[0].GetModelId()); err == nil {
			price := model.Pricing
			facts.Price = aitelemetry.Price{Unit: price.Unit, Input: price.Input, Output: price.Output, Currency: price.Currency, AsOf: price.AsOf}
		}
	}
	return facts
}

// Requirement display labels name slots (for example an encoder), not the
// adopted model. Capture the exact asset owner's display name independently.
func (s *Service) aiObservedModelName(ctx context.Context, modelAssetID string) string {
	reader, ok := s.localExecution.(interface {
		GetModelAsset(context.Context, *runtimev1.GetModelAssetRequest) (*runtimev1.GetModelAssetResponse, error)
	})
	if ok {
		if response, err := reader.GetModelAsset(ctx, &runtimev1.GetModelAssetRequest{ModelAssetId: modelAssetID}); err == nil && response.GetAsset().GetModelAssetId() == modelAssetID {
			if name := strings.TrimSpace(response.GetAsset().GetDisplayName()); name != "" {
				return name
			}
		}
	}
	return modelAssetID
}

func (s *Service) scenarioObservationContext(ctx context.Context, jobID string) context.Context {
	if s.aiObservation == nil {
		return ctx
	}
	job, ok := s.scenarioJobs.get(jobID)
	if !ok || job.GetHead() == nil {
		return ctx
	}
	var models []*runtimev1.DesktopAIExecutionModel
	var connectorRef string
	route := runtimev1.DesktopAIExecutionRoute_DESKTOP_AI_EXECUTION_ROUTE_UNSPECIFIED
	if assembly, ok := s.scenarioJobs.resolvedAssembly(jobID); ok {
		route = runtimev1.DesktopAIExecutionRoute_DESKTOP_AI_EXECUTION_ROUTE_LOCAL
		for _, axis := range assembly.ModelAxes {
			if axis.ModelAssetID == "" {
				continue
			}
			label := s.aiObservedModelName(ctx, axis.ModelAssetID)
			models = append(models, &runtimev1.DesktopAIExecutionModel{ModelId: axis.ModelAssetID, DisplayName: label, Role: axis.RequirementRole.String()})
		}
	} else if assembly, ok := s.scenarioJobs.cloudResolvedAssembly(jobID); ok {
		connectorRef = assembly.Connector.ConnectorID
		target := &structpb.Struct{}
		if protojson.Unmarshal(assembly.ProviderModelTarget, target) == nil {
			provider := target.GetFields()["provider"].GetStringValue()
			model := target.GetFields()["providerModelId"].GetStringValue()
			if provider != "" && model != "" {
				route = runtimev1.DesktopAIExecutionRoute_DESKTOP_AI_EXECUTION_ROUTE_CLOUD
				models = []*runtimev1.DesktopAIExecutionModel{{ModelId: model, DisplayName: model, ProviderId: provider, Role: "primary"}}
			}
		}
	}
	facts := s.aiObservationFacts(ctx, job.GetHead().GetSubjectUserId(), job.GetHead().GetAppId(), jobID, scenarioTargetCapability(job.GetScenarioType()), models, route)
	facts.ConnectorRef = connectorRef
	return aitelemetry.WithInvocation(ctx, s.aiObservation, facts)
}
