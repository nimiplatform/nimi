package runtimeagent

import "github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"

type runtimeAgentStateRepository struct {
	backend *runtimepersistence.Backend
}

func newRuntimeAgentStateRepository(backend *runtimepersistence.Backend) *runtimeAgentStateRepository {
	if backend == nil {
		return nil
	}
	return &runtimeAgentStateRepository{
		backend: backend,
	}
}

type publicChatSurfaceStateRepository struct {
	backend   *runtimepersistence.Backend
	stateRepo *runtimeAgentStateRepository
}

func newPublicChatSurfaceStateRepository(backend *runtimepersistence.Backend, stateRepo *runtimeAgentStateRepository) *publicChatSurfaceStateRepository {
	if backend == nil {
		return nil
	}
	return &publicChatSurfaceStateRepository{
		backend:   backend,
		stateRepo: stateRepo,
	}
}
