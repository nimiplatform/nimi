package ai

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
)

type localAppArtifactOperation = runtimeartifact.LocalAppArtifactUse

const (
	localAppArtifactOperationInlineRead = runtimeartifact.LocalAppArtifactUseInlineRead
	localAppArtifactOperationInput      = runtimeartifact.LocalAppArtifactUseScenarioInput
	localAppArtifactOperationAdoption   = runtimeartifact.LocalAppArtifactUseAdoption
)

// openAuthorizedLocalAppArtifact is the single account-plus-registration
// authorizer for every strengthened Local App artifact consumer. AppID is
// deliberately absent from the comparison and remains producer metadata only.
// Missing, foreign, corrupt, and historical subject-unbound records share the
// same public result so selectors cannot be used as an existence oracle.
func (s *Service) openAuthorizedLocalAppArtifact(
	ctx context.Context,
	decision accountservice.LocalAppCallerDecision,
	artifactID string,
	operation localAppArtifactOperation,
) (*runtimeartifact.ArtifactSource, error) {
	forbidden := func() (*runtimeartifact.ArtifactSource, error) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	if s == nil {
		return forbidden()
	}
	source, err := runtimeartifact.OpenAuthorizedLocalAppArtifact(ctx, s.runtimeArtifacts, artifactID, runtimeartifact.LocalAppArtifactOwner{
		AccountID: decision.AccountID, RegisteredAppSubject: decision.RegisteredAppSubject,
	}, operation)
	if err != nil {
		return forbidden()
	}
	return source, nil
}
