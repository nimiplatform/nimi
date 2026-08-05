package ai

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

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

// localImageProfileResolver is asset materialization only. Local media
// execution must arrive through an admitted capability Driver rather than this
// profile surface.
type localImageProfileResolver interface {
	ResolveManagedAssetPath(context.Context, string) (string, error)
}
