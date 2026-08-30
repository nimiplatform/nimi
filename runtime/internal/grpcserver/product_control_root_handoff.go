package grpcserver

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	aiservice "github.com/nimiplatform/nimi/runtime/internal/services/ai"
	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
)

type productControlRuntimeRootHandoff struct {
	registry  *activeRPCRegistry
	ai        *aiservice.Service
	agent     *runtimeagentservice.Service
	cognition *cognitionservice.Service
	backend   *runtimepersistence.Backend

	mu        sync.Mutex
	prepared  bool
	committed bool
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-007a
func (h *productControlRuntimeRootHandoff) CloseRootAdmission(ctx context.Context) error {
	if h == nil || h.registry == nil {
		return errors.New("Runtime root handoff is unavailable")
	}
	h.mu.Lock()
	if h.prepared || h.committed {
		h.mu.Unlock()
		return errors.New("Runtime root handoff is already active")
	}
	h.prepared = true
	h.mu.Unlock()
	if err := h.registry.CloseRootAdmission(ctx); err != nil {
		return err
	}
	if h.agent != nil {
		if err := h.agent.QuiesceDataRootContext(ctx); err != nil {
			return fmt.Errorf("quiesce Runtime Agent owner: %w", err)
		}
	}
	if h.cognition != nil {
		if err := h.cognition.QuiesceDataRootContext(ctx); err != nil {
			return fmt.Errorf("quiesce Cognition owner: %w", err)
		}
	}
	if h.ai != nil {
		if err := h.ai.QuiesceDataRootContext(ctx); err != nil {
			return fmt.Errorf("quiesce AI owner: %w", err)
		}
	}
	if h.backend != nil {
		if err := h.backend.Flush(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (h *productControlRuntimeRootHandoff) AbortRootHandoff() {
	if h == nil {
		return
	}
	h.mu.Lock()
	if h.committed {
		h.mu.Unlock()
		return
	}
	h.prepared = false
	h.mu.Unlock()
	if h.agent != nil {
		h.agent.ResumeDataRootAfterAbort()
	}
	if h.cognition != nil {
		h.cognition.ResumeDataRootAfterAbort()
	}
	if h.registry != nil {
		h.registry.AbortRootHandoff()
	}
}

func (h *productControlRuntimeRootHandoff) CommitRootHandoff() {
	if h == nil {
		return
	}
	h.mu.Lock()
	h.committed = true
	h.mu.Unlock()
	if h.registry != nil {
		h.registry.CommitRootHandoff()
	}
}
