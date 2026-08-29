package runtimeagent

import (
	"context"
	"math"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type agentPresentationMutation struct {
	profile            *runtimev1.AgentPresentationProfile
	patch              *runtimev1.AgentPresentationProfilePatch
	clear              bool
	selectResourcePack bool
	clearResourcePack  bool
	importedAssets     []*runtimev1.AgentPresentationAssetMaterial
}

type preparedAgentPresentationMutation struct {
	currentProfile      *runtimev1.AgentPresentationProfile
	previousProfile     *runtimev1.AgentPresentationProfile
	nextProfile         *runtimev1.AgentPresentationProfile
	nextPreviousProfile *runtimev1.AgentPresentationProfile
	nextResourcePack    *runtimev1.AgentResourcePackSelection
	appearanceMutation  bool
}

// @nimi-authority: definition.nimi.runtime.agent-participation.presentation-profile-plane
// @nimi-authority: rule.nimi.runtime.agent-participation.r193
// commitAgentPresentation is the single presentation replacement algorithm
// used by both first-party and local-app carriers. Validation produces no
// durable state. Official asset rows, profile replacement, previous-selection
// retention, revision advance, and orphan cleanup share one SQLite transaction.
func (s *Service) commitAgentPresentation(
	ctx context.Context,
	identity localAgentIdentity,
	callerAppID string,
	expectedRevision uint64,
	mutation agentPresentationMutation,
) (*runtimev1.AgentPresentationProfile, *runtimev1.AgentPresentationProfile, *runtimev1.AgentResourcePackSelection, uint64, error) {
	imported, err := validatePresentationAssetMaterials(identity.LocalAgentRef, mutation.importedAssets)
	if err != nil {
		return nil, nil, nil, 0, err
	}
	if mutation.clear && len(imported) != 0 {
		return nil, nil, nil, 0, presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID, "structure", "", "", "", "A clear presentation commit cannot import assets.", "remove_imported_asset_material")
	}

	prepared, err := s.prepareAgentPresentationCandidate(identity, expectedRevision, mutation, imported)
	if err != nil {
		return nil, nil, nil, 0, err
	}
	if err := s.validatePresentationCandidateAssets(ctx, identity.LocalAgentRef, prepared.currentProfile, prepared.previousProfile, prepared.nextProfile, imported); err != nil {
		return nil, nil, nil, 0, err
	}
	if prepared.appearanceMutation {
		if err := validateAgentPresentationVoiceAssetBinding(ctx, s.currentVoiceAssetResolver(), identity, callerAppID, prepared.currentProfile, prepared.nextProfile); err != nil {
			return nil, nil, nil, 0, err
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.agents[identity.LocalAgentRef]
	if current == nil {
		return nil, nil, nil, 0, status.Error(codes.NotFound, "agent not found")
	}
	if err := validateLocalAgentRecordIdentity(current.Agent, identity); err != nil {
		return nil, nil, nil, 0, err
	}
	if err := validatePersistedAgentPresentationProfile(current.Agent); err != nil {
		return nil, nil, nil, 0, err
	}
	currentRevision := current.Agent.GetPresentationProfileRevision()
	if currentRevision != expectedRevision {
		return nil, nil, nil, 0, agentPresentationRevisionConflict(expectedRevision, currentRevision)
	}
	committedRevision := currentRevision + 1
	candidate := clonePresentationProfile(prepared.nextProfile)
	if candidate != nil {
		candidate.Revision = committedRevision
	}
	retainedPrevious := clonePresentationProfile(prepared.nextPreviousProfile)
	selectedResourcePack := cloneResourcePackSelection(prepared.nextResourcePack)
	next := cloneAgentEntry(current)
	next.Agent.PresentationProfile = candidate
	next.Agent.PreviousPresentationProfile = retainedPrevious
	next.Agent.ResourcePackSelection = selectedResourcePack
	next.Agent.PresentationProfileRevision = committedRevision
	next.Agent.UpdatedAt = timestamppb.New(time.Now().UTC())
	if err := validatePersistedAgentPresentationProfile(next.Agent); err != nil {
		return nil, nil, nil, 0, err
	}

	for _, asset := range imported {
		if asset.role != runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_RESOURCE_PACK {
			asset.backendKind = candidate.GetBackendKind()
		}
	}
	retainedRefs := presentationProfileAssetRefs(candidate)
	retainedRefs = append(retainedRefs, presentationProfileAssetRefs(retainedPrevious)...)
	if selectedResourcePack != nil {
		retainedRefs = append(retainedRefs, selectedResourcePack.GetAssetRef())
	}
	previousEntry := current
	s.agents[identity.LocalAgentRef] = next
	if err := s.stateRepo.saveStateLockedWithTxHook(s, presentationAssetCommitHook(identity.LocalAgentRef, imported, retainedRefs)); err != nil {
		s.agents[identity.LocalAgentRef] = previousEntry
		return nil, nil, nil, 0, err
	}
	return clonePresentationProfile(candidate), clonePresentationProfile(retainedPrevious), cloneResourcePackSelection(selectedResourcePack), committedRevision, nil
}

func (s *Service) prepareAgentPresentationCandidate(identity localAgentIdentity, expectedRevision uint64, mutation agentPresentationMutation, imported map[runtimev1.AgentPresentationAssetRole]*validatedPresentationAsset) (*preparedAgentPresentationMutation, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	current := s.agents[identity.LocalAgentRef]
	if current == nil {
		return nil, status.Error(codes.NotFound, "agent not found")
	}
	if err := validateLocalAgentRecordIdentity(current.Agent, identity); err != nil {
		return nil, err
	}
	if err := validatePersistedAgentPresentationProfile(current.Agent); err != nil {
		return nil, err
	}
	currentRevision := current.Agent.GetPresentationProfileRevision()
	if currentRevision != expectedRevision {
		return nil, agentPresentationRevisionConflict(expectedRevision, currentRevision)
	}
	if currentRevision == math.MaxUint64 {
		return nil, status.Error(codes.FailedPrecondition, "agent presentation revision exhausted")
	}
	currentProfile := clonePresentationProfile(current.Agent.GetPresentationProfile())
	previousProfile := clonePresentationProfile(current.Agent.GetPreviousPresentationProfile())
	currentResourcePack := cloneResourcePackSelection(current.Agent.GetResourcePackSelection())
	appearanceMutation := mutation.profile != nil || mutation.patch != nil || mutation.clear
	resourcePackMutation := mutation.selectResourcePack || mutation.clearResourcePack
	if appearanceMutation == resourcePackMutation {
		return nil, invalidAgentPresentationProfile()
	}
	prepared := &preparedAgentPresentationMutation{
		currentProfile: currentProfile, previousProfile: previousProfile,
		nextProfile: clonePresentationProfile(currentProfile), nextPreviousProfile: clonePresentationProfile(previousProfile),
		nextResourcePack: currentResourcePack, appearanceMutation: appearanceMutation,
	}
	packAsset := imported[runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_RESOURCE_PACK]
	if resourcePackMutation {
		if mutation.selectResourcePack {
			if mutation.clearResourcePack || packAsset == nil || len(imported) != 1 {
				return nil, invalidAgentPresentationProfile()
			}
			prepared.nextResourcePack = resourcePackSelection(packAsset.ref)
		} else {
			if len(imported) != 0 {
				return nil, invalidAgentPresentationProfile()
			}
			prepared.nextResourcePack = nil
		}
		return prepared, nil
	}
	if packAsset != nil {
		return nil, invalidAgentPresentationProfile()
	}
	candidate, err := resolveAgentPresentationMutation(currentProfile, mutation, imported)
	if err != nil {
		return nil, err
	}
	prepared.nextProfile = candidate
	prepared.nextPreviousProfile = clonePresentationProfile(currentProfile)
	return prepared, nil
}

func agentPresentationRevisionConflict(expected, committed uint64) error {
	return grpcerr.WithReasonCodeOptions(codes.Aborted, runtimev1.ReasonCode_AGENT_PRESENTATION_REVISION_CONFLICT, grpcerr.ReasonOptions{
		ActionHint: "refresh_presentation_snapshot",
		Metadata: map[string]string{
			"expected_revision": uint64Decimal(expected), "committed_revision": uint64Decimal(committed),
		},
	})
}

func resolveAgentPresentationMutation(current *runtimev1.AgentPresentationProfile, mutation agentPresentationMutation, imported map[runtimev1.AgentPresentationAssetRole]*validatedPresentationAsset) (*runtimev1.AgentPresentationProfile, error) {
	if mutation.clear {
		if mutation.profile != nil || mutation.patch != nil {
			return nil, invalidAgentPresentationProfile()
		}
		return nil, nil
	}
	if (mutation.profile == nil) == (mutation.patch == nil) {
		return nil, invalidAgentPresentationProfile()
	}
	if mutation.profile != nil {
		raw := clonePresentationProfile(mutation.profile)
		if err := applyImportedPresentationRefs(raw, imported); err != nil {
			return nil, err
		}
		return normalizeAgentPresentationProfile(raw)
	}
	patch := proto.Clone(mutation.patch).(*runtimev1.AgentPresentationProfilePatch)
	if asset := imported[runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR]; asset != nil {
		if patch.AvatarAssetRef != nil && strings.TrimSpace(patch.GetAvatarAssetRef()) != "" {
			return nil, presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_NOT_VALIDATED, "validation", "avatar", asset.mediaType, "", "Imported avatar material cannot be paired with a caller-selected asset ref.", "remove_unvalidated_asset_ref")
		}
		patch.AvatarAssetRef = proto.String(asset.ref)
	}
	if asset := imported[runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_BACKGROUND]; asset != nil {
		if patch.BackgroundAssetRef != nil && strings.TrimSpace(patch.GetBackgroundAssetRef()) != "" {
			return nil, presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_NOT_VALIDATED, "validation", "background", asset.mediaType, "", "Imported background material cannot be paired with a caller-selected asset ref.", "remove_unvalidated_asset_ref")
		}
		patch.BackgroundAssetRef = proto.String(asset.ref)
	}
	return normalizeAgentPresentationProfilePatch(current, patch)
}

func applyImportedPresentationRefs(profile *runtimev1.AgentPresentationProfile, imported map[runtimev1.AgentPresentationAssetRole]*validatedPresentationAsset) error {
	if profile == nil {
		return invalidAgentPresentationProfile()
	}
	if asset := imported[runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR]; asset != nil {
		if strings.TrimSpace(profile.GetAvatarAssetRef()) != "" {
			return presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_NOT_VALIDATED, "validation", "avatar", asset.mediaType, "", "Imported avatar material cannot be paired with a caller-selected asset ref.", "remove_unvalidated_asset_ref")
		}
		profile.AvatarAssetRef = asset.ref
	}
	if asset := imported[runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_BACKGROUND]; asset != nil {
		if strings.TrimSpace(profile.GetBackgroundAssetRef()) != "" {
			return presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_NOT_VALIDATED, "validation", "background", asset.mediaType, "", "Imported background material cannot be paired with a caller-selected asset ref.", "remove_unvalidated_asset_ref")
		}
		profile.BackgroundAssetRef = asset.ref
	}
	return nil
}

func (s *Service) validatePresentationCandidateAssets(ctx context.Context, localAgentRef string, current, previous, candidate *runtimev1.AgentPresentationProfile, imported map[runtimev1.AgentPresentationAssetRole]*validatedPresentationAsset) error {
	if candidate == nil {
		return nil
	}
	backendLabel, backendKnown := agentPresentationBackendKindLabel(candidate.GetBackendKind())
	if candidate.GetAvatarAssetRef() != "" && !backendKnown {
		return invalidAgentPresentationProfile()
	}
	if avatar := imported[runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR]; avatar != nil {
		if !presentationAssetBackendCompatible(avatar, candidate.GetBackendKind()) {
			return presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_BACKEND_INCOMPATIBLE, "backend-compat", "avatar", avatar.mediaType, backendLabel, "Avatar material is incompatible with the selected backend.", "select_matching_avatar_backend")
		}
	}
	if background := imported[runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_BACKGROUND]; background != nil && !presentationAssetBackendCompatible(background, candidate.GetBackendKind()) {
		return presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_BACKEND_INCOMPATIBLE, "backend-compat", "background", background.mediaType, backendLabel, "Background material is incompatible with Runtime image intake.", "select_supported_image_asset")
	}
	if candidate.GetAvatarAssetRef() != "" {
		if err := s.requireValidatedPresentationRef(ctx, localAgentRef, runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR, candidate.GetAvatarAssetRef(), candidate.GetBackendKind(), current, previous, imported); err != nil {
			return err
		}
	}
	if candidate.GetBackgroundAssetRef() != "" {
		if err := s.requireValidatedPresentationRef(ctx, localAgentRef, runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_BACKGROUND, candidate.GetBackgroundAssetRef(), candidate.GetBackendKind(), current, previous, imported); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) requireValidatedPresentationRef(ctx context.Context, localAgentRef string, role runtimev1.AgentPresentationAssetRole, ref string, backend runtimev1.AgentPresentationBackendKind, current, previous *runtimev1.AgentPresentationProfile, imported map[runtimev1.AgentPresentationAssetRole]*validatedPresentationAsset) error {
	roleLabel := presentationAssetRoleLabel(role)
	if asset := imported[role]; asset != nil && asset.ref == ref {
		return nil
	}
	if presentationProfileRoleRef(current, role) == ref || presentationProfileRoleRef(previous, role) == ref {
		return nil
	}
	record, exists, err := s.presentationAssetByRef(ctx, localAgentRef, ref)
	if err != nil {
		return err
	}
	if !exists || record.Role != role || (role == runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR && record.BackendKind != backend) {
		backendLabel, _ := agentPresentationBackendKindLabel(backend)
		return presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_NOT_VALIDATED, "validation", roleLabel, "", backendLabel, "Presentation profile references an asset that Runtime has not validated and stored.", "import_asset_through_protected_shell")
	}
	return nil
}

func presentationProfileRoleRef(profile *runtimev1.AgentPresentationProfile, role runtimev1.AgentPresentationAssetRole) string {
	if profile == nil {
		return ""
	}
	if role == runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_BACKGROUND {
		return profile.GetBackgroundAssetRef()
	}
	return profile.GetAvatarAssetRef()
}

func presentationProfileAssetRefs(profile *runtimev1.AgentPresentationProfile) []string {
	if profile == nil {
		return nil
	}
	return []string{profile.GetAvatarAssetRef(), profile.GetBackgroundAssetRef()}
}

func clonePresentationProfile(profile *runtimev1.AgentPresentationProfile) *runtimev1.AgentPresentationProfile {
	if profile == nil {
		return nil
	}
	return proto.Clone(profile).(*runtimev1.AgentPresentationProfile)
}

func uint64Decimal(value uint64) string {
	return strconv.FormatUint(value, 10)
}
