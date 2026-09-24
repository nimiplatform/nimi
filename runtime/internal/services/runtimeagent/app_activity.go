package runtimeagent

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/services/appactivity"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	"google.golang.org/protobuf/encoding/protojson"
)

// AppActivityNotifier wakes App activity subscribers after a committed change
// that the Runtime Agent owner wrote inside its own transaction.
type AppActivityNotifier interface {
	NotifyCommitted(accountID string)
}

// SetAppActivityNotifier wires the App activity owner. Without it the Agent
// owner still commits activity rows but live subscribers observe them on the
// owner's periodic revalidation.
func (s *Service) SetAppActivityNotifier(notifier AppActivityNotifier) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.appActivityNotifier = notifier
	s.mu.Unlock()
}

func (s *Service) notifyAppActivity(accountID string) {
	if s == nil || strings.TrimSpace(accountID) == "" {
		return
	}
	s.mu.RLock()
	notifier := s.appActivityNotifier
	s.mu.RUnlock()
	if notifier != nil {
		notifier.NotifyCommitted(accountID)
	}
}

// ResolveAppActivityAgentTx resolves the session-scoped Agent handle carried by
// an admitted runtime.app-activity.put. The handle is accepted only when it is
// the exact current-session selector of an active Agent of the current
// account in the publication transaction; no in-memory snapshot can restore an
// association after Agent termination commits. The reference stays private.
// @nimi-authority: rule.nimi.runtime.app-surface.r102
func (s *Service) ResolveAppActivityAgentTx(ctx context.Context, tx *sql.Tx, agentHandle string) (appactivity.AgentFacts, error) {
	decision, ok := authorizedLocalAppAgentDecision(ctx, localappop.OperationAppActivityPut)
	if s == nil || tx == nil || !ok || decision.OperationCapability != appactivity.AppAccessDomain || !validLocalAppAgentHandle(agentHandle) {
		return appactivity.AgentFacts{}, localAppAgentAccessDenied()
	}
	rows, err := tx.QueryContext(ctx, `SELECT local_agent_ref FROM runtime_local_agent`)
	if err != nil {
		return appactivity.AgentFacts{}, fmt.Errorf("list committed Agents for App activity: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var selected string
	matches := 0
	for rows.Next() {
		var ref string
		if err := rows.Scan(&ref); err != nil {
			return appactivity.AgentFacts{}, fmt.Errorf("read committed Agent reference: %w", err)
		}
		expected := mintLocalAppAgentHandle(decision, ref)
		if expected != "" && len(expected) == len(agentHandle) &&
			subtle.ConstantTimeCompare([]byte(expected), []byte(agentHandle)) == 1 {
			selected = ref
			matches++
		}
	}
	if err := rows.Err(); err != nil {
		return appactivity.AgentFacts{}, fmt.Errorf("iterate committed Agent references: %w", err)
	}
	if err := rows.Close(); err != nil {
		return appactivity.AgentFacts{}, fmt.Errorf("close committed Agent references: %w", err)
	}
	if matches != 1 {
		return appactivity.AgentFacts{}, localAppAgentAccessDenied()
	}
	agent, err := appActivityAgentTx(ctx, tx, decision.AccountID, selected)
	if err != nil {
		return appactivity.AgentFacts{}, err
	}
	if agent == nil || !safeLocalAppAgentDisplayName(agent.GetDisplayName()) {
		return appactivity.AgentFacts{}, localAppAgentAccessDenied()
	}
	return appactivity.AgentFacts{LocalAgentRef: selected, DisplayName: agent.GetDisplayName()}, nil
}

func appActivityAgentTx(ctx context.Context, tx *sql.Tx, accountID, localAgentRef string) (*runtimev1.LocalAgentRecord, error) {
	var agentJSON string
	err := tx.QueryRowContext(ctx, `SELECT agent_json FROM runtime_local_agent WHERE local_agent_ref = ?`, localAgentRef).Scan(&agentJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read committed LocalAgent for App activity: %w", err)
	}
	agent := &runtimev1.LocalAgentRecord{}
	if err := protojson.Unmarshal([]byte(agentJSON), agent); err != nil {
		return nil, nil
	}
	if agent.GetLocalAgentRef() != localAgentRef || agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE ||
		strings.TrimSpace(agent.GetOwnerUserId()) != accountID {
		return nil, nil
	}
	fenced, err := cognitionmemory.AgentTerminationFencedTx(ctx, tx, localAgentRef)
	if err != nil || fenced {
		return nil, err
	}
	return agent, nil
}

// appActivityTurnTxHook publishes the fixed Runtime-origin activity for one
// committed completed reply inside the transcript commit transaction. The
// caller holds chatSurfaceMu; Agent facts are read from the committed Agent row
// inside the same transaction so no additional in-memory lock is taken.
// @nimi-authority: rule.nimi.runtime.agent-service.r064
func (s *Service) appActivityTurnTxHook(session *publicChatAnchorState, committedTurnID string, committedAt time.Time) (runtimeAgentStateTxHook, *bool) {
	published := new(bool)
	if s == nil || session == nil {
		return nil, published
	}
	accountID := strings.TrimSpace(session.OwnerUserID)
	localAgentRef := strings.TrimSpace(session.LocalAgentRef)
	if accountID == "" || localAgentRef == "" || strings.TrimSpace(committedTurnID) == "" ||
		s.chatDurableTerminatingAgents[localAgentRef] || s.chatTerminatingAgents[localAgentRef] > 0 {
		return nil, published
	}
	return func(tx *sql.Tx) error {
		agent, err := appActivityAgentTx(context.Background(), tx, accountID, localAgentRef)
		if err != nil {
			return err
		}
		if agent == nil {
			return nil
		}
		changed, err := appactivity.PublishRuntimeAgentTurnTx(context.Background(), tx, appactivity.RuntimeAgentTurn{
			AccountID: accountID, LocalAgentRef: localAgentRef, AgentDisplayName: agent.GetDisplayName(),
			TurnID: committedTurnID, CommittedAt: committedAt,
		})
		if errors.Is(err, appactivity.ErrInvalidInput) {
			return nil
		}
		if err != nil {
			return err
		}
		*published = changed
		return nil
	}, published
}

func chainRuntimeAgentStateTxHooks(hooks ...runtimeAgentStateTxHook) runtimeAgentStateTxHook {
	active := make([]runtimeAgentStateTxHook, 0, len(hooks))
	for _, hook := range hooks {
		if hook != nil {
			active = append(active, hook)
		}
	}
	if len(active) == 0 {
		return nil
	}
	return func(tx *sql.Tx) error {
		for _, hook := range active {
			if err := hook(tx); err != nil {
				return err
			}
		}
		return nil
	}
}
