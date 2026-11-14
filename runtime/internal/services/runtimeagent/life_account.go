package runtimeagent

import (
	"context"
	"errors"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

var errLifeAccountChanged = errors.New("LocalAgent account scope changed")

type lifeAccountGenerationOwner interface {
	BindAuthenticatedRuntimeGeneration(context.Context) (*runtimev1.AccountProjection, uint64, <-chan struct{}, bool)
	CommitAuthenticatedRuntimeGeneration(context.Context, string, string, uint64, func() error) (bool, error)
}

type lifeAccountScope struct {
	realmID     string
	generation  uint64
	invalidated <-chan struct{}
}

func (s *Service) currentLifeAccount(ctx context.Context) (*runtimev1.AccountProjection, lifeAccountScope, bool) {
	if owner, ok := s.runtimeAccountProjection.(lifeAccountGenerationOwner); ok {
		projection, generation, invalidated, ready := owner.BindAuthenticatedRuntimeGeneration(ctx)
		return projection, lifeAccountScope{realmID: projection.GetRealmEnvironmentId(), generation: generation, invalidated: invalidated}, ready
	}
	projection, ready := s.runtimeAccountProjection.AuthenticatedRuntimeProjection(ctx)
	return projection, lifeAccountScope{}, ready
}

func (scope lifeAccountScope) cancelOnReplacement(work *agentBackgroundExecution) func() {
	if scope.invalidated == nil {
		return func() {}
	}
	stop := make(chan struct{})
	select {
	case <-scope.invalidated:
		work.cancel()
	default:
		go func() {
			select {
			case <-scope.invalidated:
				work.cancel()
			case <-work.ctx.Done():
			case <-stop:
			}
		}()
	}
	return func() { close(stop) }
}

// The same Runtime Account fence guards publication of personal and shared life.
func (s *Service) commitLifeAccount(ctx context.Context, accountID string, scope lifeAccountScope, commit func(context.Context) error) error {
	owner, ok := s.runtimeAccountProjection.(lifeAccountGenerationOwner)
	if !ok {
		projection, ready := s.runtimeAccountProjection.AuthenticatedRuntimeProjection(ctx)
		if !ready || projection.GetAccountId() != accountID || ctx.Err() != nil {
			return errLifeAccountChanged
		}
		return commit(ctx)
	}
	return s.backend.WithSerializedWriter(ctx, func(writerCtx context.Context) error {
		accepted, err := owner.CommitAuthenticatedRuntimeGeneration(writerCtx, accountID, scope.realmID, scope.generation, func() error { return commit(writerCtx) })
		if err != nil {
			return err
		}
		if !accepted {
			return errLifeAccountChanged
		}
		return nil
	})
}
