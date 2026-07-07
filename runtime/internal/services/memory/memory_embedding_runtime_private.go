package memory

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type MemoryEmbeddingTextEmbedSourceKind string

const (
	MemoryEmbeddingTextEmbedSourceKindUnspecified MemoryEmbeddingTextEmbedSourceKind = ""
	MemoryEmbeddingTextEmbedSourceKindCloud       MemoryEmbeddingTextEmbedSourceKind = "cloud"
	MemoryEmbeddingTextEmbedSourceKindLocal       MemoryEmbeddingTextEmbedSourceKind = "local"
)

type MemoryEmbeddingCloudBindingRef struct {
	ConnectorID          string
	RemoteModelCatalogID string
	ProviderModelID      string
	Provider             string
}

type MemoryEmbeddingLocalBindingRef struct {
	ProfileBindingID string
	ReadinessRef     string
}

type MemoryEmbeddingTextEmbedIntentSnapshot struct {
	SourceKind     MemoryEmbeddingTextEmbedSourceKind
	CloudBinding   *MemoryEmbeddingCloudBindingRef
	LocalBinding   *MemoryEmbeddingLocalBindingRef
	ConfigRevision uint64
	RevisionToken  string
}

type MemoryEmbeddingOperationReadiness struct {
	BindAllowed    bool
	CutoverAllowed bool
}

type MemoryEmbeddingRuntimePrivateState struct {
	TextEmbedIntentPresent  bool
	TextEmbedSourceKind     MemoryEmbeddingTextEmbedSourceKind
	ResolutionState         string
	ResolvedProfileIdentity *runtimev1.MemoryEmbeddingProfile
	CanonicalBankStatus     string
	BlockedReasonCode       runtimev1.ReasonCode
	OperationReadiness      MemoryEmbeddingOperationReadiness
	ConfigRevision          uint64
}

type InspectMemoryEmbeddingStateRequest struct {
	Context *runtimev1.MemoryRequestContext
	Locator *runtimev1.MemoryBankLocator
}

type RequestCanonicalMemoryEmbeddingBindRequest struct {
	Context *runtimev1.MemoryRequestContext
	Locator *runtimev1.MemoryBankLocator
}

type RequestCanonicalMemoryEmbeddingBindResult struct {
	Outcome                  string
	BlockedReasonCode        runtimev1.ReasonCode
	CanonicalBankStatusAfter string
	PendingCutover           bool
}

type RequestMemoryEmbeddingCutoverRequest struct {
	Context *runtimev1.MemoryRequestContext
	Locator *runtimev1.MemoryBankLocator
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

func textEmbedIntentPresent(snapshot *MemoryEmbeddingTextEmbedIntentSnapshot) bool {
	if snapshot == nil {
		return false
	}
	switch snapshot.SourceKind {
	case MemoryEmbeddingTextEmbedSourceKindCloud:
		return snapshot.CloudBinding != nil
	case MemoryEmbeddingTextEmbedSourceKindLocal:
		return snapshot.LocalBinding != nil
	default:
		return false
	}
}

func normalizeMemoryEmbeddingSourceKind(value MemoryEmbeddingTextEmbedSourceKind) MemoryEmbeddingTextEmbedSourceKind {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case string(MemoryEmbeddingTextEmbedSourceKindCloud):
		return MemoryEmbeddingTextEmbedSourceKindCloud
	case string(MemoryEmbeddingTextEmbedSourceKindLocal):
		return MemoryEmbeddingTextEmbedSourceKindLocal
	default:
		return MemoryEmbeddingTextEmbedSourceKindUnspecified
	}
}

func normalizeMemoryEmbeddingCloudBinding(input *MemoryEmbeddingCloudBindingRef) *MemoryEmbeddingCloudBindingRef {
	if input == nil {
		return nil
	}
	connectorID := strings.TrimSpace(input.ConnectorID)
	remoteModelCatalogID := strings.TrimSpace(input.RemoteModelCatalogID)
	providerModelID := strings.TrimSpace(input.ProviderModelID)
	provider := strings.TrimSpace(input.Provider)
	if connectorID == "" && remoteModelCatalogID == "" && providerModelID == "" && provider == "" {
		return nil
	}
	return &MemoryEmbeddingCloudBindingRef{
		ConnectorID:          connectorID,
		RemoteModelCatalogID: remoteModelCatalogID,
		ProviderModelID:      providerModelID,
		Provider:             provider,
	}
}

func normalizeMemoryEmbeddingLocalBinding(input *MemoryEmbeddingLocalBindingRef) *MemoryEmbeddingLocalBindingRef {
	if input == nil {
		return nil
	}
	profileBindingID := strings.TrimSpace(input.ProfileBindingID)
	readinessRef := strings.TrimSpace(input.ReadinessRef)
	if profileBindingID == "" && readinessRef == "" {
		return nil
	}
	return &MemoryEmbeddingLocalBindingRef{
		ProfileBindingID: profileBindingID,
		ReadinessRef:     readinessRef,
	}
}

func normalizeMemoryEmbeddingIntentSnapshot(input *MemoryEmbeddingTextEmbedIntentSnapshot) *MemoryEmbeddingTextEmbedIntentSnapshot {
	if input == nil {
		return nil
	}
	return &MemoryEmbeddingTextEmbedIntentSnapshot{
		SourceKind:     normalizeMemoryEmbeddingSourceKind(input.SourceKind),
		CloudBinding:   normalizeMemoryEmbeddingCloudBinding(input.CloudBinding),
		LocalBinding:   normalizeMemoryEmbeddingLocalBinding(input.LocalBinding),
		ConfigRevision: input.ConfigRevision,
		RevisionToken:  strings.TrimSpace(input.RevisionToken),
	}
}

func memoryEmbeddingLocalBindingToken(input *MemoryEmbeddingLocalBindingRef) string {
	if input == nil {
		return ""
	}
	if value := strings.TrimSpace(input.ProfileBindingID); value != "" {
		return value
	}
	return strings.TrimSpace(input.ReadinessRef)
}

func memoryEmbeddingBlockedReasonForResolutionState(state string, sourceKind MemoryEmbeddingTextEmbedSourceKind) runtimev1.ReasonCode {
	switch state {
	case memoryEmbeddingResolutionStateUnavailable:
		return runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE
	case memoryEmbeddingResolutionStateUnresolved:
		if sourceKind == MemoryEmbeddingTextEmbedSourceKindLocal {
			return runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
		}
		if sourceKind == MemoryEmbeddingTextEmbedSourceKindCloud {
			return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
		}
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	default:
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
}

func cloneMemoryEmbeddingIntentSnapshot(input *MemoryEmbeddingTextEmbedIntentSnapshot) *MemoryEmbeddingTextEmbedIntentSnapshot {
	if input == nil {
		return nil
	}
	return &MemoryEmbeddingTextEmbedIntentSnapshot{
		SourceKind: input.SourceKind,
		CloudBinding: func() *MemoryEmbeddingCloudBindingRef {
			if input.CloudBinding == nil {
				return nil
			}
			return &MemoryEmbeddingCloudBindingRef{
				ConnectorID:          input.CloudBinding.ConnectorID,
				RemoteModelCatalogID: input.CloudBinding.RemoteModelCatalogID,
				ProviderModelID:      input.CloudBinding.ProviderModelID,
				Provider:             input.CloudBinding.Provider,
			}
		}(),
		LocalBinding: func() *MemoryEmbeddingLocalBindingRef {
			if input.LocalBinding == nil {
				return nil
			}
			return &MemoryEmbeddingLocalBindingRef{
				ProfileBindingID: input.LocalBinding.ProfileBindingID,
				ReadinessRef:     input.LocalBinding.ReadinessRef,
			}
		}(),
		ConfigRevision: input.ConfigRevision,
		RevisionToken:  input.RevisionToken,
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

func (s *Service) resolveMemoryEmbeddingProfile(ctx context.Context, snapshot *MemoryEmbeddingTextEmbedIntentSnapshot) (*runtimev1.MemoryEmbeddingProfile, string, runtimev1.ReasonCode) {
	normalized := normalizeMemoryEmbeddingIntentSnapshot(snapshot)
	if !textEmbedIntentPresent(normalized) {
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
	case MemoryEmbeddingTextEmbedSourceKindLocal:
		if normalized.LocalBinding == nil {
			return nil, memoryEmbeddingResolutionStateUnresolved, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
		}
		if strings.TrimSpace(managed.GetProvider()) != "local" {
			return nil, memoryEmbeddingResolutionStateUnresolved, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
		}
		if strings.TrimSpace(managed.GetModelId()) != memoryEmbeddingLocalBindingToken(normalized.LocalBinding) {
			return nil, memoryEmbeddingResolutionStateUnresolved, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
		}
		return managed, memoryEmbeddingResolutionStateResolved, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	case MemoryEmbeddingTextEmbedSourceKindCloud:
		if normalized.CloudBinding == nil {
			return nil, memoryEmbeddingResolutionStateUnresolved, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
		}
		if strings.TrimSpace(managed.GetProvider()) == "local" {
			return nil, memoryEmbeddingResolutionStateUnresolved, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
		}
		if strings.TrimSpace(managed.GetModelId()) != strings.TrimSpace(normalized.CloudBinding.ProviderModelID) {
			return nil, memoryEmbeddingResolutionStateUnresolved, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
		}
		return managed, memoryEmbeddingResolutionStateResolved, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	default:
		return nil, memoryEmbeddingResolutionStateMissing, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
}

func (s *Service) runtimeTextEmbedIntentForLocator(ctx context.Context, reqContext *runtimev1.MemoryRequestContext, locator *runtimev1.MemoryBankLocator) (*MemoryEmbeddingTextEmbedIntentSnapshot, error) {
	resolver := s.runtimeEmbeddingIntentResolver()
	if resolver == nil {
		return nil, nil
	}
	snapshot, err := resolver(ctx, reqContext, cloneLocator(locator))
	if err != nil {
		return nil, err
	}
	return normalizeMemoryEmbeddingIntentSnapshot(snapshot), nil
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
	if err := s.authorizeMemoryEmbeddingTarget(ctx, req.Context, req.Locator); err != nil {
		return nil, err
	}
	textEmbedIntent, err := s.runtimeTextEmbedIntentForLocator(ctx, req.Context, req.Locator)
	if err != nil {
		return nil, err
	}
	resolvedProfile, resolutionState, blockedReasonCode := s.resolveMemoryEmbeddingProfile(ctx, textEmbedIntent)
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
	textEmbedSourceKind := MemoryEmbeddingTextEmbedSourceKindUnspecified
	if textEmbedIntent != nil {
		textEmbedSourceKind = normalizeMemoryEmbeddingSourceKind(textEmbedIntent.SourceKind)
	}
	return &MemoryEmbeddingRuntimePrivateState{
		TextEmbedIntentPresent:  textEmbedIntentPresent(textEmbedIntent),
		TextEmbedSourceKind:     textEmbedSourceKind,
		ResolutionState:         resolutionState,
		ResolvedProfileIdentity: cloneEmbeddingProfile(resolvedProfile),
		CanonicalBankStatus:     canonicalBankStatus,
		BlockedReasonCode:       blockedReasonCode,
		OperationReadiness: MemoryEmbeddingOperationReadiness{
			BindAllowed:    bindAllowed,
			CutoverAllowed: cutoverAllowed,
		},
		ConfigRevision: func() uint64 {
			if textEmbedIntent == nil {
				return 0
			}
			return textEmbedIntent.ConfigRevision
		}(),
	}, nil
}

func (s *Service) InspectMemoryEmbeddingState(ctx context.Context, req InspectMemoryEmbeddingStateRequest) (*MemoryEmbeddingRuntimePrivateState, error) {
	return s.inspectMemoryEmbeddingState(ctx, req, true)
}

func (s *Service) RequestCanonicalMemoryEmbeddingBind(ctx context.Context, req RequestCanonicalMemoryEmbeddingBindRequest) (*RequestCanonicalMemoryEmbeddingBindResult, error) {
	if err := s.authorizeMemoryEmbeddingTarget(ctx, req.Context, req.Locator); err != nil {
		return nil, err
	}
	textEmbedIntent, err := s.runtimeTextEmbedIntentForLocator(ctx, req.Context, req.Locator)
	if err != nil {
		return nil, err
	}
	state, err := s.InspectMemoryEmbeddingState(ctx, InspectMemoryEmbeddingStateRequest{
		Context: req.Context,
		Locator: cloneLocator(req.Locator),
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
		if textEmbedIntent != nil {
			revisionToken = strings.TrimSpace(textEmbedIntent.RevisionToken)
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
	if err := s.authorizeMemoryEmbeddingTarget(ctx, req.Context, req.Locator); err != nil {
		return nil, err
	}
	state, err := s.InspectMemoryEmbeddingState(ctx, InspectMemoryEmbeddingStateRequest{
		Context: req.Context,
		Locator: cloneLocator(req.Locator),
	})
	if err != nil {
		return nil, err
	}
	if state.ResolutionState != memoryEmbeddingResolutionStateResolved {
		return &RequestMemoryEmbeddingCutoverResult{
			Outcome:                  "rejected",
			BlockedReasonCode:        memoryEmbeddingBlockedReasonForResolutionState(state.ResolutionState, state.TextEmbedSourceKind),
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
			Context: req.Context,
			Locator: cloneLocator(req.Locator),
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
