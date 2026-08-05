// Package executionintent carries caller-owned AIConfig execution intent
// between in-process Runtime owners. It is not a public wire or persistence
// contract.
package executionintent

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// Intent is one immutable capability-scoped AIConfig snapshot. Local carries
// no execution identity; Cloud carries one exact connector/catalog target.
type Intent struct {
	CapabilityContract string
	RequiredFeatures   []string
	Defaults           *structpb.Struct
	Route              runtimev1.RoutePolicy
	CloudTarget        *runtimeidentity.CloudTarget
}

func (i Intent) IsLocal() bool {
	return i.Route == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL && i.CloudTarget == nil
}

func (i Intent) IsCloud() bool {
	return i.Route == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD && i.CloudTarget != nil && i.CloudTarget.Valid()
}

func (i Intent) ModelID() string {
	if i.CloudTarget == nil {
		return ""
	}
	return strings.TrimSpace(i.CloudTarget.ProviderModelID)
}

func (i Intent) ConnectorID() string {
	if i.CloudTarget == nil {
		return ""
	}
	return strings.TrimSpace(i.CloudTarget.ConnectorID)
}

func Clone(input Intent) Intent {
	out := Intent{
		CapabilityContract: strings.TrimSpace(input.CapabilityContract),
		RequiredFeatures:   append([]string(nil), input.RequiredFeatures...),
		Route:              input.Route,
		CloudTarget:        input.CloudTarget.Clone(),
	}
	if input.Defaults != nil {
		out.Defaults, _ = proto.Clone(input.Defaults).(*structpb.Struct)
	}
	return out
}

// FromCapability converts canonical AIConfig intent into the closed private
// execution carrier. Cloud execution requires all connector/catalog facts;
// omission fails rather than deriving them from model text or provider order.
func FromCapability(capability *runtimev1.AIConfigCapabilityIntent) (Intent, error) {
	if capability == nil || strings.TrimSpace(capability.GetCapabilityContract()) == "" {
		return Intent{}, fmt.Errorf("AIConfig capability intent is required")
	}
	out := Intent{
		CapabilityContract: strings.TrimSpace(capability.GetCapabilityContract()),
		RequiredFeatures:   append([]string(nil), capability.GetRequiredFeatures()...),
	}
	if capability.GetDefaults() != nil {
		out.Defaults, _ = proto.Clone(capability.GetDefaults()).(*structpb.Struct)
	}
	switch route := capability.GetRoute().(type) {
	case *runtimev1.AIConfigCapabilityIntent_Local:
		if route.Local == nil {
			return Intent{}, fmt.Errorf("AIConfig Local route marker is required")
		}
		out.Route = runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
		return out, nil
	case *runtimev1.AIConfigCapabilityIntent_Cloud:
		if route.Cloud == nil {
			return Intent{}, fmt.Errorf("AIConfig Cloud intent is required")
		}
		target := route.Cloud.GetProviderModelTarget()
		provider, ok := exactTargetText(target, "provider")
		if !ok {
			return Intent{}, fmt.Errorf("AIConfig Cloud provider is required")
		}
		providerModelID, providerModelPresent := exactTargetText(target, "providerModelId")
		model, modelPresent := exactTargetText(target, "model")
		if providerModelPresent && modelPresent && providerModelID != model {
			return Intent{}, fmt.Errorf("AIConfig Cloud model identities conflict")
		}
		if !providerModelPresent {
			providerModelID = model
		}
		remoteModelCatalogID, ok := exactTargetText(target, "remoteModelCatalogId")
		if !ok || providerModelID == "" {
			return Intent{}, fmt.Errorf("AIConfig Cloud catalog target is incomplete")
		}
		connectorID := strings.TrimSpace(route.Cloud.GetConnectorGrantId())
		if connectorID == "" || connectorID != route.Cloud.GetConnectorGrantId() {
			return Intent{}, fmt.Errorf("AIConfig Cloud connector grant is required")
		}
		out.Route = runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD
		out.CloudTarget = &runtimeidentity.CloudTarget{
			ConnectorID:          connectorID,
			RemoteModelCatalogID: remoteModelCatalogID,
			ProviderModelID:      providerModelID,
			Provider:             provider,
		}
		return out, nil
	default:
		return Intent{}, fmt.Errorf("AIConfig capability route is required")
	}
}

func exactTargetText(target *structpb.Struct, key string) (string, bool) {
	if target == nil {
		return "", false
	}
	value, exists := target.GetFields()[key]
	if !exists || value == nil {
		return "", false
	}
	if _, ok := value.GetKind().(*structpb.Value_StringValue); !ok {
		return "", false
	}
	text := strings.TrimSpace(value.GetStringValue())
	return text, text != "" && text == value.GetStringValue()
}

type contextKey struct{}

func WithIntent(ctx context.Context, intent Intent) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, contextKey{}, Clone(intent))
}

func FromContext(ctx context.Context) (Intent, bool) {
	if ctx == nil {
		return Intent{}, false
	}
	intent, ok := ctx.Value(contextKey{}).(Intent)
	if !ok {
		return Intent{}, false
	}
	return Clone(intent), true
}
