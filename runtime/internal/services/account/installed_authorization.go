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

type InstalledInventoryAccountState string

const (
	InstalledInventoryAccountStateVerified InstalledInventoryAccountState = "verified"
	InstalledInventoryAccountStateEntitled InstalledInventoryAccountState = "entitled"
)

type InstalledInventoryInstallState string

const (
	InstalledInventoryInstallStateInstalled    InstalledInventoryInstallState = "installed"
	InstalledInventoryInstallStateAdoptedLocal InstalledInventoryInstallState = "adopted-local"
)

type InstalledGrantState string

const (
	InstalledGrantStateGranted    InstalledGrantState = "granted"
	InstalledGrantStateRevoked    InstalledGrantState = "revoked"
	InstalledGrantStateExpired    InstalledGrantState = "expired"
	InstalledGrantStateSuperseded InstalledGrantState = "superseded"
)

// InstalledOperationPolicyQuery is assembled only by RuntimeAccountService
// from a verified installed caller and a closed operation mapping. No request
// field or transport metadata can supply these values.
type InstalledOperationPolicyQuery struct {
	Operation         InstalledOperation
	AccountID         string
	AccountGeneration uint64
	AppID             string
	ReleaseDigest     protectedlocal.Identifier
	ScopeFamily       string
	ScopeName         string
	Qualifier         string
}

// InstalledOperationPolicySnapshot carries current facts from the existing
// catalog, account projection and install owners. RuntimeAccountService remains
// the only component that combines these facts into an authorization decision.
type InstalledOperationPolicySnapshot struct {
	CatalogVersion           uint64
	CatalogPermissionPresent bool
	InventoryAccountState    InstalledInventoryAccountState
	InventoryInstallState    InstalledInventoryInstallState
	CurrentAccountGeneration uint64
	ActiveReleaseDigest      protectedlocal.Identifier
	GrantID                  string
	GrantState               InstalledGrantState
	GrantVersion             uint64
	GrantExpiresAt           time.Time
}

type InstalledOperationPolicySource interface {
	ResolveInstalledOperationPolicy(context.Context, InstalledOperationPolicyQuery) (InstalledOperationPolicySnapshot, error)
}

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
	Operation          InstalledOperation
	PermissionScope    string
	CatalogVersion     uint64
	GrantID            string
	GrantVersion       uint64
}

func (s *Service) SetInstalledSessionResolver(resolver InstalledSessionResolver) {
	if s != nil {
		s.installedSessions = resolver
	}
}

func (s *Service) SetInstalledOperationPolicySource(source InstalledOperationPolicySource) {
	if s != nil {
		s.installedPolicy = source
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
// A live caller alone is not permission. Each installed operation must have a
// closed mapping here and pass the current catalog, inventory, grant and
// release facts. This keeps transport registration from accidentally
// promoting origin proof into product authorization.
func (s *Service) AuthorizeInstalledOperation(ctx context.Context, operation InstalledOperation) (InstalledCallerDecision, error) {
	requirement, ok := installedOperationRequirement(operation)
	if !ok {
		if strings.TrimSpace(string(operation)) == "" {
			return InstalledCallerDecision{}, ErrInstalledCallerUnauthorized
		}
		return InstalledCallerDecision{}, ErrInstalledOperationNotAdmitted
	}
	decision, err := s.AuthorizeInstalledCaller(ctx)
	if err != nil {
		return InstalledCallerDecision{}, err
	}
	if s.installedPolicy == nil {
		return InstalledCallerDecision{}, ErrInstalledOperationNotAdmitted
	}
	query := InstalledOperationPolicyQuery{
		Operation:         operation,
		AccountID:         decision.AccountID,
		AccountGeneration: decision.AccountGeneration,
		AppID:             decision.AppID,
		ReleaseDigest:     decision.ReleaseDigest,
		ScopeFamily:       requirement.scopeFamily,
		ScopeName:         requirement.scopeName,
		Qualifier:         requirement.qualifier,
	}
	snapshot, err := s.installedPolicy.ResolveInstalledOperationPolicy(ctx, query)
	if err != nil || !validInstalledOperationPolicy(snapshot, decision.ReleaseDigest, decision.AccountGeneration, s.now().UTC()) {
		return InstalledCallerDecision{}, ErrInstalledOperationNotAdmitted
	}
	decision.Operation = operation
	decision.PermissionScope = requirement.scopeName + "#" + requirement.qualifier
	decision.CatalogVersion = snapshot.CatalogVersion
	decision.GrantID = snapshot.GrantID
	decision.GrantVersion = snapshot.GrantVersion
	return decision, nil
}

type installedOperationPolicyRequirement struct {
	scopeFamily string
	scopeName   string
	qualifier   string
}

func installedOperationRequirement(operation InstalledOperation) (installedOperationPolicyRequirement, bool) {
	switch operation {
	case InstalledOperationReadArtifactBytes:
		return installedOperationPolicyRequirement{
			scopeFamily: "data",
			scopeName:   "data.scope.read",
			qualifier:   "runtime.artifacts",
		}, true
	default:
		return installedOperationPolicyRequirement{}, false
	}
}

func validInstalledOperationPolicy(snapshot InstalledOperationPolicySnapshot, releaseDigest protectedlocal.Identifier, accountGeneration uint64, now time.Time) bool {
	if snapshot.CatalogVersion == 0 || !snapshot.CatalogPermissionPresent || snapshot.ActiveReleaseDigest != releaseDigest ||
		snapshot.CurrentAccountGeneration == 0 || snapshot.CurrentAccountGeneration != accountGeneration {
		return false
	}
	switch snapshot.InventoryAccountState {
	case InstalledInventoryAccountStateVerified, InstalledInventoryAccountStateEntitled:
	default:
		return false
	}
	switch snapshot.InventoryInstallState {
	case InstalledInventoryInstallStateInstalled, InstalledInventoryInstallStateAdoptedLocal:
	default:
		return false
	}
	grantID := strings.TrimSpace(snapshot.GrantID)
	if grantID == "" || grantID != snapshot.GrantID || snapshot.GrantState != InstalledGrantStateGranted || snapshot.GrantVersion == 0 {
		return false
	}
	return snapshot.GrantExpiresAt.IsZero() || now.Before(snapshot.GrantExpiresAt.UTC())
}
