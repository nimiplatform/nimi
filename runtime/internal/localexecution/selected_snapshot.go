package localexecution

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// CloneSelectedLocalExecution copies one Runtime-private immutable execution
// snapshot. It never resolves current machine state or exposes a public target.
func CloneSelectedLocalExecution(input *SelectedLocalExecution) *SelectedLocalExecution {
	if input == nil {
		return nil
	}
	out := &SelectedLocalExecution{
		LoadoutID:                input.LoadoutID,
		CapabilityContract:       input.CapabilityContract,
		DisplayName:              input.DisplayName,
		RecipeID:                 input.RecipeID,
		RecipeRevision:           input.RecipeRevision,
		ModelContextWindowTokens: input.ModelContextWindowTokens,
		ExactBindings:            append([]ExactBinding(nil), input.ExactBindings...),
		SupportedFeatures:        append([]string(nil), input.SupportedFeatures...),
		Configured:               input.Configured,
	}
	if input.DriverIdentity != nil {
		out.DriverIdentity, _ = proto.Clone(input.DriverIdentity).(*runtimev1.CapabilityImplementationIdentity)
	}
	if input.PortableConfig != nil {
		out.PortableConfig, _ = proto.Clone(input.PortableConfig).(*structpb.Struct)
	}
	for _, custody := range input.RecipeCustody {
		if custody != nil {
			out.RecipeCustody = append(out.RecipeCustody, proto.Clone(custody).(*runtimev1.LoadoutRecipeCustodyReference))
		}
	}
	out.ExecutionTarget = input.ExecutionTarget.Clone()
	out.Requirements = make([]*runtimev1.LocalCapabilityRequirement, 0, len(input.Requirements))
	for _, requirement := range input.Requirements {
		if requirement == nil {
			out.Requirements = append(out.Requirements, nil)
			continue
		}
		cloned, _ := proto.Clone(requirement).(*runtimev1.LocalCapabilityRequirement)
		out.Requirements = append(out.Requirements, cloned)
	}
	return out
}

type selectedLocalExecutionContextKey struct{}

// WithSelectedLocalExecution carries an admission-captured snapshot between
// in-process Runtime owners. The snapshot is neither wire nor persistence data.
func WithSelectedLocalExecution(ctx context.Context, selected *SelectedLocalExecution) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, selectedLocalExecutionContextKey{}, CloneSelectedLocalExecution(selected))
}

// SelectedLocalExecutionFromContext returns a defensive copy only when the
// captured capability exactly matches the requested consumer.
func SelectedLocalExecutionFromContext(ctx context.Context, capabilityContract string) (*SelectedLocalExecution, bool) {
	if ctx == nil {
		return nil, false
	}
	selected, ok := ctx.Value(selectedLocalExecutionContextKey{}).(*SelectedLocalExecution)
	if !ok || selected == nil || selected.CapabilityContract != strings.TrimSpace(capabilityContract) {
		return nil, false
	}
	return CloneSelectedLocalExecution(selected), true
}
