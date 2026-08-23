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

// @nimi-authority: definition.nimi.runtime.rpc-foundations.target-identity-plane
// @nimi-authority: rule.nimi.runtime.rpc-foundations.r015
// Intent is one immutable capability-scoped AIConfig snapshot. Local is
// route-only until admission captures machine-selected execution inputs.
// LocalLoadoutRef is reserved for Runtime-private already-captured callers and
// is never populated by AIConfig conversion. Cloud keeps implementation and
// Driver-owned target intent; Runtime opens custody later for the separately
// committed exact Connector reference.
type Intent struct {
	CapabilityContract  string
	RequiredFeatures    []string
	Defaults            *structpb.Struct
	Route               runtimev1.RoutePolicy
	LocalLoadoutRef     string
	ConnectorRef        string
	CloudImplementation *runtimev1.CapabilityImplementationIdentity
	ProviderModelTarget *structpb.Struct
	// CloudTarget remains for Runtime-private non-AIConfig callers that already
	// captured a connector/catalog binding. AIConfig conversion never writes it.
	CloudTarget *runtimeidentity.CloudTarget
}

func (i Intent) IsLocal() bool {
	return i.Route == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL && i.CloudTarget == nil
}

func (i Intent) IsCloud() bool {
	if i.Route != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
		return false
	}
	if i.CloudImplementation != nil && len(i.ProviderModelTarget.GetFields()) > 0 {
		return strings.TrimSpace(i.ConnectorRef) != "" && exactImplementation(i.CloudImplementation)
	}
	return i.CloudTarget != nil && i.CloudTarget.Valid()
}

func (i Intent) IsAIConfigCloud() bool {
	return i.Route == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD &&
		strings.TrimSpace(i.ConnectorRef) != "" &&
		i.CloudImplementation != nil && exactImplementation(i.CloudImplementation) &&
		len(i.ProviderModelTarget.GetFields()) > 0
}

func (i Intent) ModelID() string {
	if model, ok := exactTargetText(i.ProviderModelTarget, "providerModelId"); ok {
		return model
	}
	if i.CloudTarget == nil {
		return ""
	}
	return strings.TrimSpace(i.CloudTarget.ProviderModelID)
}

func (i Intent) ConnectorID() string {
	if ref := strings.TrimSpace(i.ConnectorRef); ref != "" {
		return ref
	}
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
		LocalLoadoutRef:    strings.TrimSpace(input.LocalLoadoutRef),
		ConnectorRef:       strings.TrimSpace(input.ConnectorRef),
		CloudTarget:        input.CloudTarget.Clone(),
	}
	if input.Defaults != nil {
		out.Defaults, _ = proto.Clone(input.Defaults).(*structpb.Struct)
	}
	if input.CloudImplementation != nil {
		out.CloudImplementation, _ = proto.Clone(input.CloudImplementation).(*runtimev1.CapabilityImplementationIdentity)
	}
	if input.ProviderModelTarget != nil {
		out.ProviderModelTarget, _ = proto.Clone(input.ProviderModelTarget).(*structpb.Struct)
	}
	return out
}

// FromCapability converts canonical AIConfig intent into the closed private
// execution carrier. The exact Connector reference is retained while
// credential custody stays outside this value.
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
		if route.Local == nil || len(route.Local.ProtoReflect().GetUnknown()) != 0 {
			return Intent{}, fmt.Errorf("AIConfig Local route marker is invalid")
		}
		out.Route = runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
		return out, nil
	case *runtimev1.AIConfigCapabilityIntent_Cloud:
		if route.Cloud == nil || !exactImplementation(route.Cloud.GetImplementation()) ||
			strings.TrimSpace(route.Cloud.GetConnectorRef()) == "" ||
			strings.TrimSpace(route.Cloud.GetConnectorRef()) != route.Cloud.GetConnectorRef() ||
			route.Cloud.GetProviderModelTarget() == nil || len(route.Cloud.GetProviderModelTarget().GetFields()) == 0 {
			return Intent{}, fmt.Errorf("AIConfig Cloud connector, implementation, and provider-model target are required")
		}
		out.Route = runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD
		out.ConnectorRef = route.Cloud.GetConnectorRef()
		out.CloudImplementation, _ = proto.Clone(route.Cloud.GetImplementation()).(*runtimev1.CapabilityImplementationIdentity)
		out.ProviderModelTarget, _ = proto.Clone(route.Cloud.GetProviderModelTarget()).(*structpb.Struct)
		return out, nil
	default:
		return Intent{}, fmt.Errorf("AIConfig capability route is required")
	}
}

func exactImplementation(value *runtimev1.CapabilityImplementationIdentity) bool {
	if value == nil {
		return false
	}
	for _, text := range []string{value.GetImplementationId(), value.GetDriverId(), value.GetDriverDialect()} {
		if text == "" || text != strings.TrimSpace(text) {
			return false
		}
	}
	return true
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
