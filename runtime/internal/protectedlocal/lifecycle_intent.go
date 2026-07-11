package protectedlocal

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"fmt"
	"io"
	"math"
	"strings"
	"sync"
	"time"
)

const LifecycleChallengeTTL = 60 * time.Second

const (
	ReasonLifecycleChallengeRequired Reason = "LIFECYCLE_CHALLENGE_REQUIRED"
	ReasonLifecycleChallengeMismatch Reason = "LIFECYCLE_CHALLENGE_MISMATCH"
	ReasonLifecycleChallengeReplay   Reason = "LIFECYCLE_CHALLENGE_REPLAY"
	ReasonLifecycleIntentRequired    Reason = "LIFECYCLE_INTENT_REQUIRED"
	ReasonLifecycleIntentMismatch    Reason = "LIFECYCLE_INTENT_MISMATCH"
	ReasonLifecycleIntentReplay      Reason = "LIFECYCLE_INTENT_REPLAY"
	ReasonLifecycleIntentExpired     Reason = "LIFECYCLE_INTENT_EXPIRED"
)

type LifecycleAction string

const (
	LifecycleActionInstall                LifecycleAction = "INSTALL"
	LifecycleActionUninstall              LifecycleAction = "UNINSTALL"
	LifecycleActionUpdate                 LifecycleAction = "UPDATE"
	LifecycleActionHealthRepair           LifecycleAction = "HEALTH_REPAIR"
	LifecycleActionAdoptLocalApp          LifecycleAction = "ADOPT_LOCAL_APP"
	LifecycleActionRemoveLocalAppAdoption LifecycleAction = "REMOVE_LOCAL_APP_ADOPTION"
	LifecycleActionOpenApp                LifecycleAction = "OPEN_APP"
)

func (action LifecycleAction) valid() bool {
	switch action {
	case LifecycleActionInstall,
		LifecycleActionUninstall,
		LifecycleActionUpdate,
		LifecycleActionHealthRepair,
		LifecycleActionAdoptLocalApp,
		LifecycleActionRemoveLocalAppAdoption,
		LifecycleActionOpenApp:
		return true
	default:
		return false
	}
}

type LifecycleIntentStatus string

const (
	LifecycleIntentStatusPrepared          LifecycleIntentStatus = "PREPARED"
	LifecycleIntentStatusConsumed          LifecycleIntentStatus = "CONSUMED"
	LifecycleIntentStatusSideEffectStarted LifecycleIntentStatus = "SIDE_EFFECT_STARTED"
	LifecycleIntentStatusSucceeded         LifecycleIntentStatus = "SUCCEEDED"
	LifecycleIntentStatusFailed            LifecycleIntentStatus = "FAILED"
	LifecycleIntentStatusCancelled         LifecycleIntentStatus = "CANCELLED"
	LifecycleIntentStatusExpired           LifecycleIntentStatus = "EXPIRED"
)

func (status LifecycleIntentStatus) terminal() bool {
	switch status {
	case LifecycleIntentStatusSucceeded,
		LifecycleIntentStatusFailed,
		LifecycleIntentStatusCancelled,
		LifecycleIntentStatusExpired:
		return true
	default:
		return false
	}
}

type LifecycleHealthRepairAction uint32

const (
	LifecycleHealthRepairActionUnspecified LifecycleHealthRepairAction = iota
	LifecycleHealthRepairActionCancel
	LifecycleHealthRepairActionRetry
	LifecycleHealthRepairActionRepair
	LifecycleHealthRepairActionReinstall
)

type LifecycleDestructiveOptions struct {
	DeleteDurableData  bool
	HealthRepairAction LifecycleHealthRepairAction
	TargetJobID        string
}

type LifecycleChallengeInput struct {
	AccountGeneration          uint64
	Action                     LifecycleAction
	AppID                      string
	ReleaseRef                 string
	ArtifactDigest             Identifier
	DisplayedImpactDigest      Identifier
	ExpectedAdoptionGeneration uint64
	DestructiveOptions         LifecycleDestructiveOptions
}

type LifecycleIntentConsumption struct {
	IntentID                   Identifier
	AccountGeneration          uint64
	Action                     LifecycleAction
	AppID                      string
	ReleaseRef                 string
	ArtifactDigest             Identifier
	DisplayedImpactDigest      Identifier
	ExpectedAdoptionGeneration uint64
	DestructiveOptions         LifecycleDestructiveOptions
}

type LifecycleIntentStatusQuery struct {
	IntentID          Identifier
	AccountGeneration uint64
}

type PreparedLifecycleIntentProjection struct {
	IntentID Identifier
	Deadline time.Time
}

type LifecycleIntentStatusProjection struct {
	IntentID Identifier
	Status   LifecycleIntentStatus
}

type LifecycleIntentManagerOptions struct {
	Sessions *DesktopSessionManager
	Random   io.Reader
	Now      func() time.Time
}

type lifecycleIntentAuthority struct {
	managerID          Identifier
	intentID           Identifier
	desktopAuthority   *desktopSessionAuthority
	desktopSessionID   Identifier
	processHash        Identifier
	bootEpoch          Identifier
	accountGeneration  uint64
	action             LifecycleAction
	appID              string
	releaseRef         string
	artifactDigest     Identifier
	displayedDigest    Identifier
	adoptionGeneration uint64
	destructiveOptions LifecycleDestructiveOptions
	issued             time.Time
	deadline           time.Time
	status             LifecycleIntentStatus
}

type lifecycleOutstandingKey struct {
	desktopSessionID Identifier
	action           LifecycleAction
	appID            string
}

type LifecycleIntentManager struct {
	sessions *DesktopSessionManager
	random   io.Reader
	now      func() time.Time
	boot     Identifier
	id       Identifier

	mu      sync.Mutex
	entries map[Identifier]*lifecycleIntentAuthority
	active  map[lifecycleOutstandingKey]Identifier
}

func NewLifecycleIntentManager(options LifecycleIntentManagerOptions) (*LifecycleIntentManager, error) {
	if options.Sessions == nil {
		return nil, fail(ReasonProtectedLocalLedgerUnavailable, false, "restart_runtime_service", fmt.Errorf("create lifecycle intent manager: desktop session authority is required"))
	}
	if options.Sessions.bootEpoch == (Identifier{}) {
		return nil, fail(ReasonProtectedLocalBootEpochMismatch, true, "reconnect_desktop", fmt.Errorf("create lifecycle intent manager: runtime boot epoch mismatch"))
	}
	if options.Random == nil {
		options.Random = rand.Reader
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	managerID, err := readIdentifier(options.Random)
	if err != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime_service", fmt.Errorf("create lifecycle intent manager: %w", err))
	}
	return &LifecycleIntentManager{
		sessions: options.Sessions,
		random:   options.Random,
		now:      options.Now,
		boot:     options.Sessions.bootEpoch,
		id:       managerID,
		entries:  make(map[Identifier]*lifecycleIntentAuthority),
		active:   make(map[lifecycleOutstandingKey]Identifier),
	}, nil
}

// ValidateBootScoped confirms that this transitional manager and the supplied
// Desktop session authority are the exact boot-scoped pair. Lifecycle intent
// rows are ordinary in-memory transaction state, not durable-anchor truth.
func (manager *LifecycleIntentManager) ValidateBootScoped(ctx context.Context, sessions *DesktopSessionManager) error {
	if ctx == nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "restart_runtime_service", fmt.Errorf("validate lifecycle intent manager: context is required"))
	}
	if manager == nil || manager.id == (Identifier{}) || manager.boot == (Identifier{}) ||
		manager.sessions == nil || manager.sessions != sessions {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "restart_runtime_service", fmt.Errorf("validate lifecycle intent manager: boot-scoped authority pair is incomplete"))
	}
	manager.mu.Lock()
	indexesReady := manager.entries != nil && manager.active != nil
	manager.mu.Unlock()
	if !indexesReady {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "restart_runtime_service", fmt.Errorf("validate lifecycle intent manager: authoritative indexes are unavailable"))
	}
	if err := sessions.ValidateBootScoped(ctx); err != nil {
		return err
	}
	if sessions.bootEpoch != manager.boot {
		return fail(ReasonProtectedLocalBootEpochMismatch, false, "restart_runtime_service", fmt.Errorf("validate lifecycle intent manager: current boot epoch mismatch"))
	}
	return nil
}

func (manager *LifecycleIntentManager) Prepare(ctx context.Context, input LifecycleChallengeInput) (PreparedLifecycleIntentProjection, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	authority, err := manager.authorize(ctx)
	if err != nil {
		return PreparedLifecycleIntentProjection{}, err
	}
	if err := validateLifecycleChallengeInput(input); err != nil {
		return PreparedLifecycleIntentProjection{}, err
	}
	intentID, err := readIdentifier(manager.random)
	if err != nil {
		return PreparedLifecycleIntentProjection{}, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime_service", fmt.Errorf("prepare lifecycle intent: generate challenge id: %w", err))
	}
	issued := manager.now()
	deadline := issued.Add(LifecycleChallengeTTL)
	entry := &lifecycleIntentAuthority{
		managerID:          manager.id,
		intentID:           intentID,
		desktopAuthority:   authority,
		desktopSessionID:   authority.sessionID,
		processHash:        authority.processHash,
		bootEpoch:          authority.bootEpoch,
		accountGeneration:  input.AccountGeneration,
		action:             input.Action,
		appID:              input.AppID,
		releaseRef:         input.ReleaseRef,
		artifactDigest:     input.ArtifactDigest,
		displayedDigest:    input.DisplayedImpactDigest,
		adoptionGeneration: input.ExpectedAdoptionGeneration,
		destructiveOptions: input.DestructiveOptions,
		issued:             issued,
		deadline:           deadline,
		status:             LifecycleIntentStatusPrepared,
	}
	key := lifecycleOutstandingKey{desktopSessionID: authority.sessionID, action: input.Action, appID: input.AppID}
	replaced := manager.active[key]
	if replaced != (Identifier{}) {
		if prior := manager.entries[replaced]; prior != nil {
			prior.status = LifecycleIntentStatusCancelled
		}
	}
	manager.entries[intentID] = entry
	manager.active[key] = intentID
	if _, err := manager.authorize(ctx); err != nil {
		return PreparedLifecycleIntentProjection{}, err
	}
	return PreparedLifecycleIntentProjection{IntentID: intentID, Deadline: deadline}, nil
}

func (manager *LifecycleIntentManager) Consume(ctx context.Context, input LifecycleIntentConsumption) (LifecycleIntentStatusProjection, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	authority, err := manager.authorize(ctx)
	if err != nil {
		return LifecycleIntentStatusProjection{}, err
	}
	if input.IntentID == (Identifier{}) {
		return LifecycleIntentStatusProjection{}, fail(ReasonLifecycleIntentRequired, false, "prepare_lifecycle_intent", fmt.Errorf("consume lifecycle intent: intent id is required"))
	}
	entry := manager.entries[input.IntentID]
	if entry == nil {
		return LifecycleIntentStatusProjection{}, fail(ReasonLifecycleIntentMismatch, false, "prepare_lifecycle_intent", fmt.Errorf("consume lifecycle intent: unknown correlation id"))
	}
	if entry.status != LifecycleIntentStatusPrepared {
		if entry.status == LifecycleIntentStatusExpired {
			return LifecycleIntentStatusProjection{}, lifecycleIntentExpiredFailure("consume lifecycle intent: intent expired")
		}
		return LifecycleIntentStatusProjection{}, lifecycleIntentReplayFailure("consume lifecycle intent: intent is no longer outstanding")
	}
	if !entry.matchesAuthority(manager.id, authority) || !entry.matchesConsumption(input) {
		return LifecycleIntentStatusProjection{}, fail(ReasonLifecycleIntentMismatch, false, "prepare_lifecycle_intent", fmt.Errorf("consume lifecycle intent: protected binding mismatch"))
	}
	if !manager.now().Before(entry.deadline) {
		if err := manager.expire(ctx, entry); err != nil {
			return LifecycleIntentStatusProjection{}, err
		}
		return LifecycleIntentStatusProjection{}, lifecycleIntentExpiredFailure("consume lifecycle intent: intent expired")
	}
	entry.status = LifecycleIntentStatusConsumed
	delete(manager.active, lifecycleOutstandingKey{desktopSessionID: entry.desktopSessionID, action: entry.action, appID: entry.appID})
	if _, err := manager.authorize(ctx); err != nil {
		return LifecycleIntentStatusProjection{}, err
	}
	return LifecycleIntentStatusProjection{IntentID: entry.intentID, Status: entry.status}, nil
}

func (manager *LifecycleIntentManager) Status(ctx context.Context, query LifecycleIntentStatusQuery) (LifecycleIntentStatusProjection, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	authority, err := manager.authorize(ctx)
	if err != nil {
		return LifecycleIntentStatusProjection{}, err
	}
	if query.IntentID == (Identifier{}) {
		return LifecycleIntentStatusProjection{}, fail(ReasonLifecycleIntentRequired, false, "prepare_lifecycle_intent", fmt.Errorf("read lifecycle intent status: intent id is required"))
	}
	entry := manager.entries[query.IntentID]
	if entry == nil || !entry.matchesAuthority(manager.id, authority) || entry.accountGeneration != query.AccountGeneration {
		return LifecycleIntentStatusProjection{}, fail(ReasonLifecycleIntentMismatch, false, "prepare_lifecycle_intent", fmt.Errorf("read lifecycle intent status: protected binding mismatch"))
	}
	if entry.status == LifecycleIntentStatusPrepared && !manager.now().Before(entry.deadline) {
		if err := manager.expire(ctx, entry); err != nil {
			return LifecycleIntentStatusProjection{}, err
		}
	}
	return LifecycleIntentStatusProjection{IntentID: entry.intentID, Status: entry.status}, nil
}

func (manager *LifecycleIntentManager) expire(ctx context.Context, entry *lifecycleIntentAuthority) error {
	_ = ctx
	entry.status = LifecycleIntentStatusExpired
	delete(manager.active, lifecycleOutstandingKey{desktopSessionID: entry.desktopSessionID, action: entry.action, appID: entry.appID})
	return nil
}

func (manager *LifecycleIntentManager) authorize(ctx context.Context) (*desktopSessionAuthority, error) {
	if manager == nil || manager.sessions == nil {
		return nil, fail(ReasonProtectedLocalLedgerUnavailable, false, "restart_runtime_service", fmt.Errorf("authorize lifecycle intent: manager is unavailable"))
	}
	if err := manager.sessions.AuthorizeContext(ctx, RoleDesktopLifecycleHost); err != nil {
		return nil, err
	}
	connection, ok := DesktopConnectionFromContext(ctx)
	if !ok || connection == nil {
		return nil, fail(ReasonDesktopControlTransportRequired, false, "use_desktop_control", fmt.Errorf("authorize lifecycle intent: protected connection context required"))
	}
	authority := connection.desktopSessionAuthority()
	if authority == nil || authority.managerID != manager.sessions.managerID {
		return nil, fail(ReasonProtectedOriginRoleMismatch, false, "reconnect_desktop", fmt.Errorf("authorize lifecycle intent: desktop session authority mismatch"))
	}
	if authority.bootEpoch != manager.boot || connection.origin.bootEpoch != manager.boot {
		return nil, fail(ReasonProtectedLocalBootEpochMismatch, true, "reconnect_desktop", fmt.Errorf("authorize lifecycle intent: runtime boot epoch is stale"))
	}
	return authority, nil
}

func validateLifecycleChallengeInput(input LifecycleChallengeInput) error {
	if input.AccountGeneration == 0 || input.AccountGeneration > math.MaxInt64 {
		return fail(ReasonLifecycleChallengeMismatch, false, "refresh_account", fmt.Errorf("prepare lifecycle intent: account generation is invalid"))
	}
	if input.ExpectedAdoptionGeneration > math.MaxInt64 {
		return fail(ReasonLifecycleChallengeMismatch, false, "resolve_lifecycle_target", fmt.Errorf("prepare lifecycle intent: adoption generation is invalid"))
	}
	if !input.Action.valid() || !canonicalIdentityField(input.AppID) {
		return fail(ReasonLifecycleChallengeMismatch, false, "prepare_lifecycle_intent", fmt.Errorf("prepare lifecycle intent: action or app id is invalid"))
	}
	if input.DisplayedImpactDigest == (Identifier{}) {
		return fail(ReasonLifecycleChallengeMismatch, false, "render_canonical_impact", fmt.Errorf("prepare lifecycle intent: displayed impact digest is required"))
	}
	requiresRelease := input.Action != LifecycleActionAdoptLocalApp && input.Action != LifecycleActionRemoveLocalAppAdoption
	requiresArtifact := input.Action != LifecycleActionRemoveLocalAppAdoption
	if requiresRelease != canonicalIdentityField(input.ReleaseRef) || (!requiresRelease && strings.TrimSpace(input.ReleaseRef) != "") {
		return fail(ReasonLifecycleChallengeMismatch, false, "resolve_lifecycle_target", fmt.Errorf("prepare lifecycle intent: release binding is invalid"))
	}
	if requiresArtifact != (input.ArtifactDigest != (Identifier{})) {
		return fail(ReasonLifecycleChallengeMismatch, false, "resolve_lifecycle_target", fmt.Errorf("prepare lifecycle intent: artifact binding is invalid"))
	}
	adoptionAction := input.Action == LifecycleActionAdoptLocalApp || input.Action == LifecycleActionRemoveLocalAppAdoption
	if !adoptionAction && input.ExpectedAdoptionGeneration != 0 {
		return fail(ReasonLifecycleChallengeMismatch, false, "resolve_lifecycle_target", fmt.Errorf("prepare lifecycle intent: adoption generation is not admitted for this action"))
	}
	options := input.DestructiveOptions
	if options.DeleteDurableData && input.Action != LifecycleActionUninstall && input.Action != LifecycleActionRemoveLocalAppAdoption {
		return fail(ReasonLifecycleChallengeMismatch, false, "resolve_lifecycle_target", fmt.Errorf("prepare lifecycle intent: durable data deletion is not admitted for this action"))
	}
	if input.Action != LifecycleActionHealthRepair {
		if options.HealthRepairAction != LifecycleHealthRepairActionUnspecified || options.TargetJobID != "" {
			return fail(ReasonLifecycleChallengeMismatch, false, "resolve_lifecycle_target", fmt.Errorf("prepare lifecycle intent: health repair options are not admitted for this action"))
		}
		return nil
	}
	if options.HealthRepairAction < LifecycleHealthRepairActionCancel || options.HealthRepairAction > LifecycleHealthRepairActionReinstall {
		return fail(ReasonLifecycleChallengeMismatch, false, "resolve_lifecycle_target", fmt.Errorf("prepare lifecycle intent: health repair action is invalid"))
	}
	allowsTargetJob := options.HealthRepairAction == LifecycleHealthRepairActionCancel || options.HealthRepairAction == LifecycleHealthRepairActionRetry
	if !allowsTargetJob && options.TargetJobID != "" {
		return fail(ReasonLifecycleChallengeMismatch, false, "resolve_lifecycle_target", fmt.Errorf("prepare lifecycle intent: target job is not admitted for this repair action"))
	}
	if options.TargetJobID != "" && !canonicalIdentityField(options.TargetJobID) {
		return fail(ReasonLifecycleChallengeMismatch, false, "resolve_lifecycle_target", fmt.Errorf("prepare lifecycle intent: target job id is invalid"))
	}
	return nil
}

func (entry *lifecycleIntentAuthority) matchesAuthority(managerID Identifier, authority *desktopSessionAuthority) bool {
	return entry != nil && authority != nil && entry.managerID == managerID && entry.desktopAuthority == authority &&
		entry.desktopSessionID == authority.sessionID && entry.processHash == authority.processHash &&
		entry.bootEpoch == authority.bootEpoch && !authority.revoked.Load()
}

func (entry *lifecycleIntentAuthority) matchesConsumption(input LifecycleIntentConsumption) bool {
	return entry.intentID == input.IntentID && entry.accountGeneration == input.AccountGeneration &&
		entry.action == input.Action && entry.appID == input.AppID && entry.releaseRef == input.ReleaseRef &&
		entry.adoptionGeneration == input.ExpectedAdoptionGeneration && entry.destructiveOptions == input.DestructiveOptions &&
		subtle.ConstantTimeCompare(entry.artifactDigest[:], input.ArtifactDigest[:]) == 1 &&
		subtle.ConstantTimeCompare(entry.displayedDigest[:], input.DisplayedImpactDigest[:]) == 1
}

func lifecycleIntentReplayFailure(message string) error {
	return fail(ReasonLifecycleIntentReplay, false, "prepare_lifecycle_intent", fmt.Errorf("%s", message))
}

func lifecycleIntentExpiredFailure(message string) error {
	return fail(ReasonLifecycleIntentExpired, false, "prepare_lifecycle_intent", fmt.Errorf("%s", message))
}

func lifecycleReplayFailure(message string) error {
	return fail(ReasonLifecycleChallengeReplay, false, "prepare_lifecycle_intent", fmt.Errorf("%s", message))
}
