package account

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

var (
	ErrInstalledCallerUnauthorized   = errors.New("installed caller is not currently authorized")
	ErrInstalledOperationNotAdmitted = errors.New("installed operation capability and grant are not admitted")
)

type InstalledOperation string

const InstalledOperationReadArtifactBytes InstalledOperation = "/nimi.runtime.v1.RuntimeArtifactService/ReadArtifactBytes"

// InstalledCallerBinding is the Auth-owned session/process projection consumed
// by RuntimeAccountService. It carries no capability or grant decision.
type InstalledCallerBinding struct {
	SessionID         protectedlocal.Identifier
	AppID             string
	ReleaseDigest     protectedlocal.Identifier
	AccountGeneration uint64
	RuntimeBootEpoch  protectedlocal.Identifier
	Process           protectedlocal.ProcessTuple
	ExpiresAt         time.Time
}

type InstalledSessionResolver interface {
	ResolveInstalledSession(context.Context, uint64) (InstalledCallerBinding, error)
}

// InstalledCallerDecision is an immutable, per-call origin/account decision.
// Later capability and grant evaluation extends this Account-owned boundary;
// consumers must not add independent installed-session caches.
type InstalledCallerDecision struct {
	SessionID          protectedlocal.Identifier
	AppID              string
	ReleaseDigest      protectedlocal.Identifier
	AccountID          string
	RealmEnvironmentID string
	AccountGeneration  uint64
	RuntimeBootEpoch   protectedlocal.Identifier
	Process            protectedlocal.ProcessTuple
	ExpiresAt          time.Time
}

func (s *Service) SetInstalledSessionResolver(resolver InstalledSessionResolver) {
	if s != nil {
		s.installedSessions = resolver
	}
}

// AuthorizeInstalledCaller revalidates current account identity and delegates
// session/process resolution to Auth. Request metadata, app IDs and portable
// proofs are deliberately absent from this private evaluator input.
func (s *Service) AuthorizeInstalledCaller(ctx context.Context) (InstalledCallerDecision, error) {
	if s == nil || s.installedSessions == nil {
		return InstalledCallerDecision{}, ErrInstalledCallerUnauthorized
	}
	projection, generation, authenticated := s.AuthenticatedRuntimeSecurityContext(ctx)
	if !authenticated || generation == 0 || projection == nil {
		return InstalledCallerDecision{}, ErrInstalledCallerUnauthorized
	}
	accountID := strings.TrimSpace(projection.GetAccountId())
	realmEnvironmentID := strings.TrimSpace(projection.GetRealmEnvironmentId())
	if accountID == "" || realmEnvironmentID == "" {
		return InstalledCallerDecision{}, ErrInstalledCallerUnauthorized
	}
	binding, err := s.installedSessions.ResolveInstalledSession(ctx, generation)
	if err != nil || binding.SessionID == (protectedlocal.Identifier{}) || strings.TrimSpace(binding.AppID) == "" ||
		binding.ReleaseDigest == (protectedlocal.Identifier{}) || binding.AccountGeneration != generation ||
		binding.RuntimeBootEpoch == (protectedlocal.Identifier{}) || binding.Process.PID == 0 || !s.now().UTC().Before(binding.ExpiresAt.UTC()) {
		return InstalledCallerDecision{}, ErrInstalledCallerUnauthorized
	}
	return InstalledCallerDecision{
		SessionID:          binding.SessionID,
		AppID:              strings.TrimSpace(binding.AppID),
		ReleaseDigest:      binding.ReleaseDigest,
		AccountID:          accountID,
		RealmEnvironmentID: realmEnvironmentID,
		AccountGeneration:  generation,
		RuntimeBootEpoch:   binding.RuntimeBootEpoch,
		Process:            binding.Process,
		ExpiresAt:          binding.ExpiresAt.UTC(),
	}, nil
}

// AuthorizeInstalledOperation is the sole Account-owned operation entrypoint.
// A live caller alone is not permission: all installed operations remain
// denied until their canonical capability and current grant policy are wired
// here. This keeps future transport registration from accidentally promoting
// origin proof into product authorization.
func (s *Service) AuthorizeInstalledOperation(ctx context.Context, operation InstalledOperation) (InstalledCallerDecision, error) {
	if strings.TrimSpace(string(operation)) == "" {
		return InstalledCallerDecision{}, ErrInstalledCallerUnauthorized
	}
	if _, err := s.AuthorizeInstalledCaller(ctx); err != nil {
		return InstalledCallerDecision{}, err
	}
	return InstalledCallerDecision{}, ErrInstalledOperationNotAdmitted
}
