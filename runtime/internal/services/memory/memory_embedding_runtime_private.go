package memory

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type MemoryEmbeddingBindingSourceKind string

const (
	MemoryEmbeddingBindingSourceKindUnspecified MemoryEmbeddingBindingSourceKind = ""
	MemoryEmbeddingBindingSourceKindCloud       MemoryEmbeddingBindingSourceKind = "cloud"
	MemoryEmbeddingBindingSourceKindLocal       MemoryEmbeddingBindingSourceKind = "local"
)

type MemoryEmbeddingCloudBindingRef struct {
	ConnectorID string
	ModelID     string
}

type MemoryEmbeddingLocalBindingRef struct {
	LocalModelID string
}

type MemoryEmbeddingBindingIntentSnapshot struct {
	SourceKind    MemoryEmbeddingBindingSourceKind
	CloudBinding  *MemoryEmbeddingCloudBindingRef
	LocalBinding  *MemoryEmbeddingLocalBindingRef
	RevisionToken string
}

type MemoryEmbeddingOperationReadiness struct {
	BindAllowed    bool
	CutoverAllowed bool
}

type MemoryEmbeddingRuntimePrivateState struct {
	BindingIntentPresent    bool
	BindingSourceKind       MemoryEmbeddingBindingSourceKind
	ResolutionState         string
	ResolvedProfileIdentity *runtimev1.MemoryEmbeddingProfile
	CanonicalBankStatus     string
	BlockedReasonCode       runtimev1.ReasonCode
	OperationReadiness      MemoryEmbeddingOperationReadiness
}

type InspectMemoryEmbeddingStateRequest struct {
	Locator               *runtimev1.MemoryBankLocator
	BindingIntentSnapshot *MemoryEmbeddingBindingIntentSnapshot
}

type RequestCanonicalMemoryEmbeddingBindRequest struct {
	Locator               *runtimev1.MemoryBankLocator
	BindingIntentSnapshot *MemoryEmbeddingBindingIntentSnapshot
}

type RequestCanonicalMemoryEmbeddingBindResult struct {
	Outcome                  string
	BlockedReasonCode        runtimev1.ReasonCode
	CanonicalBankStatusAfter string
	PendingCutover           bool
}

type RequestMemoryEmbeddingCutoverRequest struct {
	Locator               *runtimev1.MemoryBankLocator
	BindingIntentSnapshot *MemoryEmbeddingBindingIntentSnapshot
}

type RequestMemoryEmbeddingCutoverResult struct {
	Outcome                  string
	BlockedReasonCode        runtimev1.ReasonCode
	CanonicalBankStatusAfter string
}

const (
	memoryEmbeddingResolutionStateMissing     = "missing"
	memoryEmbeddingResolutionStateResolved    = "resolved"
	memoryEmbeddingResolutionStateUnresolved  = "unresolved"
	memoryEmbeddingResolutionStateUnavailable = "unavailable"

	memoryEmbeddingCanonicalBankStatusUnbound              = "unbound"
	memoryEmbeddingCanonicalBankStatusBoundEquivalent      = "bound_equivalent"
	memoryEmbeddingCanonicalBankStatusBoundProfileMismatch = "bound_profile_mismatch"
	memoryEmbeddingCanonicalBankStatusRebuildPending       = "rebuild_pending"
	memoryEmbeddingCanonicalBankStatusCutoverReady         = "cutover_ready"
)

func validateMemoryEmbeddingLocator(locator *runtimev1.MemoryBankLocator) error {
	if locator == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return nil
}

func bindingIntentPresent(snapshot *MemoryEmbeddingBindingIntentSnapshot) bool {
	if snapshot == nil {
		return false
	}
	switch snapshot.SourceKind {
	case MemoryEmbeddingBindingSourceKindCloud:
		return snapshot.CloudBinding != nil
	case MemoryEmbeddingBindingSourceKindLocal:
		return snapshot.LocalBinding != nil
	default:
		return false
	}
}

func normalizeMemoryEmbeddingSourceKind(value MemoryEmbeddingBindingSourceKind) MemoryEmbeddingBindingSourceKind {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case string(MemoryEmbeddingBindingSourceKindCloud):
		return MemoryEmbeddingBindingSourceKindCloud
	case string(MemoryEmbeddingBindingSourceKindLocal):
		return MemoryEmbeddingBindingSourceKindLocal
	default:
		return MemoryEmbeddingBindingSourceKindUnspecified
	}
}

func normalizeMemoryEmbeddingCloudBinding(input *MemoryEmbeddingCloudBindingRef) *MemoryEmbeddingCloudBindingRef {
	if input == nil {
		return nil
	}
	connectorID := strings.TrimSpace(input.ConnectorID)
	modelID := strings.TrimSpace(input.ModelID)
	if connectorID == "" && modelID == "" {
		return nil
	}
	return &MemoryEmbeddingCloudBindingRef{
		ConnectorID: connectorID,
		ModelID:     modelID,
	}
}

func normalizeMemoryEmbeddingLocalBinding(input *MemoryEmbeddingLocalBindingRef) *MemoryEmbeddingLocalBindingRef {
	if input == nil {
		return nil
	}
	localModelID := strings.TrimSpace(input.LocalModelID)
	if localModelID == "" {
		return nil
	}
	return &MemoryEmbeddingLocalBindingRef{LocalModelID: localModelID}
}

func normalizeMemoryEmbeddingIntentSnapshot(input *MemoryEmbeddingBindingIntentSnapshot) *MemoryEmbeddingBindingIntentSnapshot {
	if input == nil {
		return nil
	}
	return &MemoryEmbeddingBindingIntentSnapshot{
		SourceKind:    normalizeMemoryEmbeddingSourceKind(input.SourceKind),
		CloudBinding:  normalizeMemoryEmbeddingCloudBinding(input.CloudBinding),
		LocalBinding:  normalizeMemoryEmbeddingLocalBinding(input.LocalBinding),
		RevisionToken: strings.TrimSpace(input.RevisionToken),
	}
}

func memoryEmbeddingBlockedReasonForResolutionState(state string, sourceKind MemoryEmbeddingBindingSourceKind) runtimev1.ReasonCode {
	switch state {
	case memoryEmbeddingResolutionStateUnavailable:
		return runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE
	case memoryEmbeddingResolutionStateUnresolved:
		if sourceKind == MemoryEmbeddingBindingSourceKindLocal {
			return runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
		}
		if sourceKind == MemoryEmbeddingBindingSourceKindCloud {
			return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
		}
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	default:
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
}

func cloneMemoryEmbeddingIntentSnapshot(input *MemoryEmbeddingBindingIntentSnapshot) *MemoryEmbeddingBindingIntentSnapshot {
	if input == nil {
		return nil
	}
	return &MemoryEmbeddingBindingIntentSnapshot{
		SourceKind: input.SourceKind,
		CloudBinding: func() *MemoryEmbeddingCloudBindingRef {
			if input.CloudBinding == nil {
				return nil
			}
			return &MemoryEmbeddingCloudBindingRef{
				ConnectorID: input.CloudBinding.ConnectorID,
				ModelID:     input.CloudBinding.ModelID,
			}
		}(),
		LocalBinding: func() *MemoryEmbeddingLocalBindingRef {
			if input.LocalBinding == nil {
				return nil
			}
			return &MemoryEmbeddingLocalBindingRef{
				LocalModelID: input.LocalBinding.LocalModelID,
			}
		}(),
		RevisionToken: input.RevisionToken,
	}
}

func memoryEmbeddingProfileIdentity(profile *runtimev1.MemoryEmbeddingProfile) string {
	if profile == nil {
		return ""
	}
	parts := []string{
		strings.TrimSpace(profile.GetProvider()),
		strings.TrimSpace(profile.GetModelId()),
		strings.TrimSpace(profile.GetVersion()),
	}
	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			filtered = append(filtered, part)
		}
	}
	return strings.Join(filtered, ":")
}

func (s *Service) resolveMemoryEmbeddingProfile(ctx context.Context, snapshot *MemoryEmbeddingBindingIntentSnapshot) (*runtimev1.MemoryEmbeddingProfile, string, runtimev1.ReasonCode) {
	normalized := normalizeMemoryEmbeddingIntentSnapshot(snapshot)
	if !bindingIntentPresent(normalized) {
		return nil, memoryEmbeddingResolutionStateMissing, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	if resolver := s.runtimeEmbeddingProfileResolver(); resolver != nil {
		resolved := resolver(ctx, cloneMemoryEmbeddingIntentSnapshot(normalized))
		if resolved.ResolutionState != "" {
			return cloneEmbeddingProfile(resolved.Profile), strings.TrimSpace(resolved.ResolutionState), resolved.BlockedReasonCode
		}
	}
	managed := s.ManagedEmbeddingProfile()
	if managed == nil {
		return nil, memoryEmbeddingResolutionStateUnavailable, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE
	}
	switch normalized.SourceKind {
	case MemoryEmbeddingBindingSourceKindLocal:
		if normalized.LocalBinding == nil {
			return nil, memoryEmbeddingResolutionStateUnresolved, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
		}
		if strings.TrimSpace(managed.GetProvider()) != "local" {
			return nil, memoryEmbeddingResolutionStateUnresolved, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
		}
		if strings.TrimSpace(managed.GetModelId()) != strings.TrimSpace(normalized.LocalBinding.LocalModelID) {
			return nil, memoryEmbeddingResolutionStateUnresolved, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
		}
		return managed, memoryEmbeddingResolutionStateResolved, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	case MemoryEmbeddingBindingSourceKindCloud:
		if normalized.CloudBinding == nil {
			return nil, memoryEmbeddingResolutionStateUnresolved, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
		}
		if strings.TrimSpace(managed.GetProvider()) == "local" {
			return nil, memoryEmbeddingResolutionStateUnresolved, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
		}
		if strings.TrimSpace(managed.GetModelId()) != strings.TrimSpace(normalized.CloudBinding.ModelID) {
			return nil, memoryEmbeddingResolutionStateUnresolved, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
		}
		return managed, memoryEmbeddingResolutionStateResolved, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	default:
		return nil, memoryEmbeddingResolutionStateMissing, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
}

func memoryEmbeddingCanonicalBankStatus(bank *runtimev1.MemoryBank, pending *pendingEmbeddingCutoverState, resolved *runtimev1.MemoryEmbeddingProfile) string {
	if bank == nil || bank.GetEmbeddingProfile() == nil {
		return memoryEmbeddingCanonicalBankStatusUnbound
	}
	if resolved != nil && embeddingProfilesMatch(resolved, bank.GetEmbeddingProfile()) {
		return memoryEmbeddingCanonicalBankStatusBoundEquivalent
	}
	if pending != nil && pending.TargetProfile != nil && resolved != nil && embeddingProfilesMatch(resolved, pending.TargetProfile) {
		if pending.ReadyForCutover {
			return memoryEmbeddingCanonicalBankStatusCutoverReady
		}
		return memoryEmbeddingCanonicalBankStatusRebuildPending
	}
	return memoryEmbeddingCanonicalBankStatusBoundProfileMismatch
}

func memoryEmbeddingReadinessBlockedReason(profile *runtimev1.MemoryEmbeddingProfile) runtimev1.ReasonCode {
	if strings.EqualFold(strings.TrimSpace(profile.GetProvider()), "local") {
		return runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE
	}
	return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
}

func (s *Service) pendingEmbeddingCutoverReadinessInputs(locator *runtimev1.MemoryBankLocator) (*pendingEmbeddingCutoverState, []string, error) {
	bankState, err := s.bankForLocator(locator)
	if err != nil {
		return nil, nil, err
	}
	pending := bankState.PendingEmbeddingCutover
	if pending == nil || pending.TargetProfile == nil {
		return nil, nil, nil
	}
	raws := make([]string, 0, len(bankState.Order))
	for _, recordID := range bankState.Order {
		record := bankState.Records[recordID]
		if record == nil {
			continue
		}
		raw := strings.TrimSpace(strings.Join([]string{recordContent(record), recordContext(record)}, " "))
		if raw != "" {
			raws = append(raws, raw)
		}
	}
	narratives, err := s.loadNarrativeRecallCandidates(locator)
	if err != nil {
		return nil, nil, err
	}
	for _, candidate := range narratives {
		if strings.ToLower(strings.TrimSpace(candidate.Status)) != "active" {
			continue
		}
		raw := strings.TrimSpace(strings.Join([]string{candidate.Topic, candidate.Content}, " "))
		if raw != "" {
			raws = append(raws, raw)
		}
	}
	return pending, raws, nil
}

func (s *Service) ensurePendingEmbeddingCutoverReady(ctx context.Context, locator *runtimev1.MemoryBankLocator) (*pendingEmbeddingCutoverState, error) {
	pending, raws, err := s.pendingEmbeddingCutoverReadinessInputs(locator)
	if err != nil || pending == nil || pending.TargetProfile == nil {
		return pending, err
	}
	if pending.ReadyForCutover {
		return pending, nil
	}
	if len(raws) > 0 {
		if _, err := s.embeddingVectors(ctx, pending.TargetProfile, raws); err != nil {
			blockedReasonCode := memoryEmbeddingReadinessBlockedReason(pending.TargetProfile)
			if _, persistErr := s.SetCanonicalBankEmbeddingCutoverReadiness(ctx, cloneLocator(locator), false, blockedReasonCode); persistErr != nil {
				return nil, persistErr
			}
			pending.ReadyForCutover = false
			pending.BlockedReasonCode = blockedReasonCode
			return pending, nil
		}
	}
	if _, err := s.SetCanonicalBankEmbeddingCutoverReadiness(ctx, cloneLocator(locator), true, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED); err != nil {
		return nil, err
	}
	pending.ReadyForCutover = true
	pending.BlockedReasonCode = runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	return pending, nil
}

func (s *Service) inspectMemoryEmbeddingState(ctx context.Context, req InspectMemoryEmbeddingStateRequest, evaluateReadiness bool) (*MemoryEmbeddingRuntimePrivateState, error) {
	if err := validateMemoryEmbeddingLocator(req.Locator); err != nil {
		return nil, err
	}
	resolvedProfile, resolutionState, blockedReasonCode := s.resolveMemoryEmbeddingProfile(ctx, req.BindingIntentSnapshot)
	bankState, err := s.bankForLocator(req.Locator)
	if err != nil && status.Code(err) != codes.NotFound {
		return nil, err
	}
	var (
		bank    *runtimev1.MemoryBank
		pending *pendingEmbeddingCutoverState
	)
	if bankState != nil {
		bank = bankState.Bank
		pending = bankState.PendingEmbeddingCutover
	}
	canonicalBankStatus := memoryEmbeddingCanonicalBankStatus(bank, pending, resolvedProfile)
	if evaluateReadiness && resolutionState == memoryEmbeddingResolutionStateResolved && canonicalBankStatus == memoryEmbeddingCanonicalBankStatusRebuildPending {
		pending, err = s.ensurePendingEmbeddingCutoverReady(ctx, cloneLocator(req.Locator))
		if err != nil {
			return nil, err
		}
		canonicalBankStatus = memoryEmbeddingCanonicalBankStatus(bank, pending, resolvedProfile)
	}
	if blockedReasonCode == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED &&
		canonicalBankStatus == memoryEmbeddingCanonicalBankStatusRebuildPending &&
		pending != nil &&
		pending.BlockedReasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		blockedReasonCode = pending.BlockedReasonCode
	}
	bindAllowed := resolutionState == memoryEmbeddingResolutionStateResolved &&
		(canonicalBankStatus == memoryEmbeddingCanonicalBankStatusUnbound || canonicalBankStatus == memoryEmbeddingCanonicalBankStatusBoundProfileMismatch)
	cutoverAllowed := resolutionState == memoryEmbeddingResolutionStateResolved && canonicalBankStatus == memoryEmbeddingCanonicalBankStatusCutoverReady
	bindingSourceKind := MemoryEmbeddingBindingSourceKindUnspecified
	if req.BindingIntentSnapshot != nil {
		bindingSourceKind = normalizeMemoryEmbeddingSourceKind(req.BindingIntentSnapshot.SourceKind)
	}
	return &MemoryEmbeddingRuntimePrivateState{
		BindingIntentPresent:    bindingIntentPresent(req.BindingIntentSnapshot),
		BindingSourceKind:       bindingSourceKind,
		ResolutionState:         resolutionState,
		ResolvedProfileIdentity: cloneEmbeddingProfile(resolvedProfile),
		CanonicalBankStatus:     canonicalBankStatus,
		BlockedReasonCode:       blockedReasonCode,
		OperationReadiness: MemoryEmbeddingOperationReadiness{
			BindAllowed:    bindAllowed,
			CutoverAllowed: cutoverAllowed,
		},
	}, nil
}

func (s *Service) InspectMemoryEmbeddingState(ctx context.Context, req InspectMemoryEmbeddingStateRequest) (*MemoryEmbeddingRuntimePrivateState, error) {
	return s.inspectMemoryEmbeddingState(ctx, req, true)
}

func (s *Service) RequestCanonicalMemoryEmbeddingBind(ctx context.Context, req RequestCanonicalMemoryEmbeddingBindRequest) (*RequestCanonicalMemoryEmbeddingBindResult, error) {
	if err := validateMemoryEmbeddingLocator(req.Locator); err != nil {
		return nil, err
	}
	state, err := s.InspectMemoryEmbeddingState(ctx, InspectMemoryEmbeddingStateRequest{
		Locator:               cloneLocator(req.Locator),
		BindingIntentSnapshot: cloneMemoryEmbeddingIntentSnapshot(req.BindingIntentSnapshot),
	})
	if err != nil {
		return nil, err
	}
	if state.ResolutionState != memoryEmbeddingResolutionStateResolved {
		return &RequestCanonicalMemoryEmbeddingBindResult{
			Outcome:                  "rejected",
			BlockedReasonCode:        state.BlockedReasonCode,
			CanonicalBankStatusAfter: state.CanonicalBankStatus,
			PendingCutover:           false,
		}, nil
	}
	if state.CanonicalBankStatus == memoryEmbeddingCanonicalBankStatusBoundEquivalent {
		if _, err := s.ClearCanonicalBankEmbeddingCutover(ctx, cloneLocator(req.Locator)); err != nil && status.Code(err) != codes.NotFound {
			return nil, err
		}
		return &RequestCanonicalMemoryEmbeddingBindResult{
			Outcome:                  "already_bound",
			BlockedReasonCode:        runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			CanonicalBankStatusAfter: memoryEmbeddingCanonicalBankStatusBoundEquivalent,
			PendingCutover:           false,
		}, nil
	}
	if state.CanonicalBankStatus == memoryEmbeddingCanonicalBankStatusCutoverReady {
		return &RequestCanonicalMemoryEmbeddingBindResult{
			Outcome:                  "staged_rebuild",
			BlockedReasonCode:        runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			CanonicalBankStatusAfter: memoryEmbeddingCanonicalBankStatusCutoverReady,
			PendingCutover:           true,
		}, nil
	}
	if state.CanonicalBankStatus == memoryEmbeddingCanonicalBankStatusRebuildPending {
		return &RequestCanonicalMemoryEmbeddingBindResult{
			Outcome:                  "staged_rebuild",
			BlockedReasonCode:        state.BlockedReasonCode,
			CanonicalBankStatusAfter: memoryEmbeddingCanonicalBankStatusRebuildPending,
			PendingCutover:           true,
		}, nil
	}
	if state.CanonicalBankStatus == memoryEmbeddingCanonicalBankStatusBoundProfileMismatch {
		revisionToken := ""
		if req.BindingIntentSnapshot != nil {
			revisionToken = strings.TrimSpace(req.BindingIntentSnapshot.RevisionToken)
		}
		if _, err := s.StageCanonicalBankEmbeddingCutover(ctx, cloneLocator(req.Locator), state.ResolvedProfileIdentity, revisionToken); err != nil {
			return nil, err
		}
		return &RequestCanonicalMemoryEmbeddingBindResult{
			Outcome:                  "staged_rebuild",
			BlockedReasonCode:        runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			CanonicalBankStatusAfter: memoryEmbeddingCanonicalBankStatusRebuildPending,
			PendingCutover:           true,
		}, nil
	}
	bank, err := s.EnsureCanonicalBank(ctx, cloneLocator(req.Locator), "", nil)
	if err != nil {
		return nil, err
	}
	if bank.GetEmbeddingProfile() != nil {
		return &RequestCanonicalMemoryEmbeddingBindResult{
			Outcome:                  "already_bound",
			BlockedReasonCode:        runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			CanonicalBankStatusAfter: memoryEmbeddingCanonicalBankStatus(bank, nil, state.ResolvedProfileIdentity),
			PendingCutover:           false,
		}, nil
	}
	var bound *runtimev1.MemoryBank
	if state.ResolvedProfileIdentity != nil {
		bound, err = s.BindCanonicalBankResolvedEmbeddingProfile(ctx, cloneLocator(req.Locator), state.ResolvedProfileIdentity)
	} else {
		bound, err = s.BindCanonicalBankEmbeddingProfile(ctx, cloneLocator(req.Locator))
	}
	if err != nil {
		return nil, err
	}
	return &RequestCanonicalMemoryEmbeddingBindResult{
		Outcome:                  "bound",
		BlockedReasonCode:        runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
		CanonicalBankStatusAfter: memoryEmbeddingCanonicalBankStatus(bound, nil, state.ResolvedProfileIdentity),
		PendingCutover:           false,
	}, nil
}

func (s *Service) RequestMemoryEmbeddingCutover(ctx context.Context, req RequestMemoryEmbeddingCutoverRequest) (*RequestMemoryEmbeddingCutoverResult, error) {
	if err := validateMemoryEmbeddingLocator(req.Locator); err != nil {
		return nil, err
	}
	state, err := s.InspectMemoryEmbeddingState(ctx, InspectMemoryEmbeddingStateRequest{
		Locator:               cloneLocator(req.Locator),
		BindingIntentSnapshot: cloneMemoryEmbeddingIntentSnapshot(req.BindingIntentSnapshot),
	})
	if err != nil {
		return nil, err
	}
	if state.ResolutionState != memoryEmbeddingResolutionStateResolved {
		return &RequestMemoryEmbeddingCutoverResult{
			Outcome:                  "rejected",
			BlockedReasonCode:        memoryEmbeddingBlockedReasonForResolutionState(state.ResolutionState, state.BindingSourceKind),
			CanonicalBankStatusAfter: state.CanonicalBankStatus,
		}, nil
	}
	if state.CanonicalBankStatus == memoryEmbeddingCanonicalBankStatusBoundEquivalent {
		if _, err := s.ClearCanonicalBankEmbeddingCutover(ctx, cloneLocator(req.Locator)); err != nil && status.Code(err) != codes.NotFound {
			return nil, err
		}
		return &RequestMemoryEmbeddingCutoverResult{
			Outcome:                  "already_current",
			BlockedReasonCode:        runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			CanonicalBankStatusAfter: memoryEmbeddingCanonicalBankStatusBoundEquivalent,
		}, nil
	}
	if state.CanonicalBankStatus == memoryEmbeddingCanonicalBankStatusRebuildPending {
		if _, err := s.ensurePendingEmbeddingCutoverReady(ctx, cloneLocator(req.Locator)); err != nil {
			return nil, err
		}
		state, err = s.inspectMemoryEmbeddingState(ctx, InspectMemoryEmbeddingStateRequest{
			Locator:               cloneLocator(req.Locator),
			BindingIntentSnapshot: cloneMemoryEmbeddingIntentSnapshot(req.BindingIntentSnapshot),
		}, false)
		if err != nil {
			return nil, err
		}
	}
	if state.CanonicalBankStatus != memoryEmbeddingCanonicalBankStatusCutoverReady {
		return &RequestMemoryEmbeddingCutoverResult{
			Outcome:                  "not_ready",
			BlockedReasonCode:        state.BlockedReasonCode,
			CanonicalBankStatusAfter: state.CanonicalBankStatus,
		}, nil
	}
	bank, err := s.CommitCanonicalBankEmbeddingCutover(ctx, cloneLocator(req.Locator))
	if err != nil {
		return nil, err
	}
	return &RequestMemoryEmbeddingCutoverResult{
		Outcome:                  "cutover_committed",
		BlockedReasonCode:        runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
		CanonicalBankStatusAfter: memoryEmbeddingCanonicalBankStatus(bank, nil, state.ResolvedProfileIdentity),
	}, nil
}
