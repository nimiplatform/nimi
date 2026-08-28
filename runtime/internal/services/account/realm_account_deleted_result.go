package account

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const RealmAccountDeletedReason = "ACCOUNT_DELETED"

type RealmAccountDeletedObserver interface {
	ConsumeRealmAccountDeletedResult(context.Context, ObservedRealmAccountDeletedResult) error
}

// ObservedRealmAccountDeletedResult is the closed internal projection produced
// only after the Account refresh owner has parsed the exact typed Realm result.
// Its fields and observation marker remain private so ordinary refresh errors,
// logout, session loss, or caller-authored Account IDs cannot be converted by
// field assignment into terminal deletion truth.
// @nimi-authority: rule.nimi.runtime.protected-session.r033
type ObservedRealmAccountDeletedResult struct {
	accountID   string
	operationID string
	deletedAt   time.Time
	reason      string
	observed    bool
}

// NewObservedRealmAccountDeletedResult is the sole constructor used by the
// Account package's exact refresh-result parser and bounded owner tests.
func NewObservedRealmAccountDeletedResult(accountID, operationID string, deletedAt time.Time, reason string) (ObservedRealmAccountDeletedResult, error) {
	if !validObservedRealmAccountDeletedText(accountID) || !validObservedRealmAccountDeletedText(operationID) || deletedAt.IsZero() || reason != RealmAccountDeletedReason {
		return ObservedRealmAccountDeletedResult{}, fmt.Errorf("observed Realm Account deleted result is invalid")
	}
	return ObservedRealmAccountDeletedResult{
		accountID: accountID, operationID: operationID, deletedAt: deletedAt.UTC(), reason: reason, observed: true,
	}, nil
}

func (result ObservedRealmAccountDeletedResult) Observed() bool {
	return result.observed
}

func (result ObservedRealmAccountDeletedResult) AccountID() string {
	return result.accountID
}

func (result ObservedRealmAccountDeletedResult) OperationID() string {
	return result.operationID
}

func (result ObservedRealmAccountDeletedResult) DeletedAt() time.Time {
	return result.deletedAt
}

func (result ObservedRealmAccountDeletedResult) Reason() string {
	return result.reason
}

func validObservedRealmAccountDeletedText(value string) bool {
	return value != "" && value == strings.TrimSpace(value) && len(value) <= 512 && utf8.ValidString(value)
}

type realmAccountDeletedRefreshFailure struct {
	result ObservedRealmAccountDeletedResult
}

func (failure *realmAccountDeletedRefreshFailure) Error() string {
	return "Realm Account was deleted"
}

func newRealmAccountDeletedRefreshFailure(result ObservedRealmAccountDeletedResult) error {
	return &realmAccountDeletedRefreshFailure{result: result}
}

func observedRealmAccountDeletedResultFromError(err error) (ObservedRealmAccountDeletedResult, bool) {
	var failure *realmAccountDeletedRefreshFailure
	if !errors.As(err, &failure) || failure == nil || !failure.result.Observed() {
		return ObservedRealmAccountDeletedResult{}, false
	}
	return failure.result, true
}

func (s *Service) SetRealmAccountDeletedObserver(observer RealmAccountDeletedObserver) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.realmAccountDeletedObserver = observer
	hasPending := observer != nil && s.material.pendingRealmDeletion != nil
	s.mu.Unlock()
	if hasPending {
		if err := s.replayPendingRealmAccountDeletedResult(context.Background()); err != nil && s.logger != nil {
			s.logger.Warn("pending Realm Account deletion remains unavailable", "error", err)
		}
	}
}

// @nimi-authority: rule.nimi.runtime.protected-session.r033
func (s *Service) replayPendingRealmAccountDeletedResult(ctx context.Context) error {
	if s == nil {
		return fmt.Errorf("replay pending Realm Account deletion: service unavailable")
	}
	s.identityMutationMu.Lock()
	defer s.identityMutationMu.Unlock()

	s.mu.RLock()
	observer := s.realmAccountDeletedObserver
	var pending ObservedRealmAccountDeletedResult
	if s.material.pendingRealmDeletion != nil {
		pending = *s.material.pendingRealmDeletion
	}
	s.mu.RUnlock()
	if observer == nil || !pending.Observed() {
		return fmt.Errorf("replay pending Realm Account deletion: observer unavailable")
	}
	if err := observer.ConsumeRealmAccountDeletedResult(ctx, pending); err != nil {
		s.deferPendingRealmAccountDeletedReplay()
		return err
	}
	if err := s.custody.Clear(ctx, s.partition); err != nil {
		s.deferPendingRealmAccountDeletedReplay()
		return fmt.Errorf("replay pending Realm Account deletion: clear Account custody: %w", err)
	}
	s.mu.Lock()
	s.realmDeletionRetryAttempt = 0
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED
	s.clearAuthenticatedRuntimeIdentityLocked()
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_FAILED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_DELETED)
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_DELETED)
	s.mu.Unlock()
	return nil
}

func (s *Service) deferPendingRealmAccountDeletedReplay() {
	s.mu.Lock()
	if s.material.pendingRealmDeletion != nil {
		if s.realmDeletionRetryAttempt < 6 {
			s.realmDeletionRetryAttempt++
		}
		s.rebuildRefreshTimerLocked()
	}
	s.mu.Unlock()
}
