package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	"github.com/oklog/ulid/v2"
)

// ConfigureCognitionMemory installs the one active Cognition Memory owner
// path, initializes existing pre-cut Agents disabled, and replays only the
// transactional outbox. It creates no legacy reader or alternate delivery.
func (s *Service) ConfigureCognitionMemory(store *cognitionmemory.Store, bridge *cognitionmemory.Bridge, facade *cognitionmemory.Facade, termination *cognitionmemory.TerminationService) error {
	if s == nil || store == nil || bridge == nil || facade == nil || termination == nil {
		return fmt.Errorf("configure Cognition Memory: complete owner composition is required")
	}
	s.cognitionMemoryStore = store
	s.cognitionMemoryBridge = bridge
	s.cognitionMemoryFacade = facade
	s.cognitionMemoryTermination = termination
	terminationStates, err := termination.AgentTerminationStates(context.Background())
	if err != nil {
		return fmt.Errorf("configure Cognition Memory: inspect durable termination fences: %w", err)
	}
	terminating := make(map[string]struct{}, len(terminationStates))
	for _, state := range terminationStates {
		if strings.TrimSpace(state.LocalAgentRef) != "" {
			terminating[state.LocalAgentRef] = struct{}{}
		}
	}
	s.mu.RLock()
	agents := make([]string, 0, len(s.agents))
	for localAgentRef := range s.agents {
		agents = append(agents, localAgentRef)
	}
	s.mu.RUnlock()
	for _, localAgentRef := range agents {
		if _, fenced := terminating[localAgentRef]; fenced {
			s.setAgentDurableTerminationFence(localAgentRef, true)
			continue
		}
		if _, err := store.BindingForAgent(context.Background(), localAgentRef); err == nil {
			continue
		} else if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("configure Cognition Memory: inspect existing Agent %s: %w", localAgentRef, err)
		}
		if err := s.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
			_, err := store.CreateAgentBindingTx(tx, localAgentRef, newCognitionMemorySubjectRef(), false)
			return err
		}); err != nil {
			return fmt.Errorf("configure Cognition Memory: initialize existing Agent %s: %w", localAgentRef, err)
		}
	}
	for _, localAgentRef := range agents {
		if _, fenced := terminating[localAgentRef]; fenced {
			continue
		}
		if err := s.processCognitionMemoryAgent(context.Background(), localAgentRef); err != nil && !errors.Is(err, cognitionmemory.ErrMemoryDisabled) {
			if s.logger != nil {
				s.logger.Warn("Cognition Memory startup replay remains pending", "local_agent_ref", localAgentRef, "error", err)
			}
		}
	}
	return nil
}

func newCognitionMemorySubjectRef() string {
	return "cmsub_" + ulid.Make().String()
}

func (s *Service) authorizeCognitionMemoryBinding(_ context.Context, binding cognitionmemory.Binding) error {
	if s == nil || strings.TrimSpace(binding.LocalAgentRef) == "" || strings.TrimSpace(binding.AccountSubjectRef) == "" || binding.State != "active" {
		return fmt.Errorf("Cognition Memory binding is invalid")
	}
	entry, err := s.agentByID(binding.LocalAgentRef)
	if err != nil {
		return err
	}
	if entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		return fmt.Errorf("Cognition Memory Agent is not active")
	}
	s.chatSurfaceMu.Lock()
	fenced := s.agentTerminationFencedLocked(binding.LocalAgentRef)
	s.chatSurfaceMu.Unlock()
	if fenced {
		return fmt.Errorf("Cognition Memory Agent is terminating")
	}
	return nil
}

func (s *Service) AuthorizeCognitionMemoryBinding(ctx context.Context, binding cognitionmemory.Binding) error {
	return s.authorizeCognitionMemoryBinding(ctx, binding)
}

func (s *Service) ResolveCognitionMemoryEmbeddingIntent(ctx context.Context, localAgentRef string) (string, *cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot, error) {
	entry, err := s.agentByID(strings.TrimSpace(localAgentRef))
	if err != nil {
		return "", nil, err
	}
	accountID := strings.TrimSpace(entry.Agent.GetOwnerUserId())
	intent, err := s.ResolveMemoryEmbeddingIntent(ctx, accountID, entry.Agent.GetLocalAgentRef())
	return accountID, intent, err
}

func (s *Service) triggerCognitionMemory(localAgentRef string) {
	if s == nil || s.cognitionMemoryBridge == nil || s.cognitionMemoryFacade == nil || strings.TrimSpace(localAgentRef) == "" {
		return
	}
	ctx := s.cognitionMemoryLifecycleCtx
	if ctx == nil || ctx.Err() != nil {
		return
	}
	s.cognitionMemoryDrainMu.Lock()
	if s.cognitionMemoryDraining == nil {
		s.cognitionMemoryDraining = make(map[string]bool)
	}
	if s.cognitionMemoryDrainPending == nil {
		s.cognitionMemoryDrainPending = make(map[string]bool)
	}
	if s.cognitionMemoryDraining[localAgentRef] {
		s.cognitionMemoryDrainPending[localAgentRef] = true
		s.cognitionMemoryDrainMu.Unlock()
		return
	}
	s.cognitionMemoryDraining[localAgentRef] = true
	s.cognitionMemoryWG.Add(1)
	s.cognitionMemoryDrainMu.Unlock()
	go func() {
		defer s.cognitionMemoryWG.Done()
		for {
			if err := s.processCognitionMemoryAgent(ctx, localAgentRef); err != nil && !errors.Is(err, cognitionmemory.ErrMemoryDisabled) && s.logger != nil {
				s.logger.Warn("Cognition Memory event processing failed", "local_agent_ref", localAgentRef, "error", err)
			}
			s.cognitionMemoryDrainMu.Lock()
			if s.cognitionMemoryDrainPending[localAgentRef] && ctx.Err() == nil {
				delete(s.cognitionMemoryDrainPending, localAgentRef)
				s.cognitionMemoryDrainMu.Unlock()
				continue
			}
			delete(s.cognitionMemoryDrainPending, localAgentRef)
			delete(s.cognitionMemoryDraining, localAgentRef)
			s.cognitionMemoryDrainMu.Unlock()
			return
		}
	}()
}

func (s *Service) processCognitionMemoryAgent(ctx context.Context, localAgentRef string) error {
	for {
		drained, err := s.cognitionMemoryBridge.DrainOne(ctx, localAgentRef)
		if err != nil {
			return err
		}
		if !drained.Drained {
			break
		}
		if _, err := s.cognitionMemoryFacade.ProcessRemember(ctx, localAgentRef, drained.OperationID); err != nil {
			return err
		}
	}
	return s.cognitionMemoryFacade.ResumePending(ctx, localAgentRef)
}
