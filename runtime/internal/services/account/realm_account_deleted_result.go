package account

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
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
	s.mu.Unlock()
}
