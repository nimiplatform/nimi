package runtimeagent

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.utopia-operations
func (s *Service) GetLocalAppAgentUtopiaSnapshot(ctx context.Context, req *runtimev1.GetLocalAppAgentUtopiaSnapshotRequest) (*runtimev1.GetLocalAppAgentUtopiaSnapshotResponse, error) {
	decision, ok := authorizedLocalAppAgentDecision(ctx, localappop.OperationAgentUtopiaSnapshotGet)
	if !ok || decision.OperationCapability != "agent.utopia.read" || ctx.Err() != nil {
		return nil, localAppAgentAccessDenied()
	}
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.accountTerminationFencedLocked(decision.AccountID) {
		return nil, localAppAgentAccessDenied()
	}
	settings, err := s.readLifeUtopiaSettings(ctx, decision.AccountID)
	if err != nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	utopia, err := settings.effective()
	if err != nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	now := time.Now().UTC()
	shared, err := s.readLifeSharedRecords(ctx, decision.AccountID)
	if err != nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	activeShared := make(map[string]bool)
	for _, activity := range shared {
		if s.sharedLifeVisibleNowLocked(decision.AccountID, decision.AccountGeneration, settings, utopia, activity, now) {
			activeShared[activity.Ref] = true
		}
	}
	out := &runtimev1.GetLocalAppAgentUtopiaSnapshotResponse{Settings: projectUtopiaSettings(settings, utopia), ObservedAt: timestamppb.New(now)}
	for _, p := range utopia.Places {
		out.Places = append(out.Places, &runtimev1.LocalAppAgentUtopiaPlace{Id: p.ID, Activities: p.Activities})
	}
	handles := make(map[string]string)
	for ref, entry := range s.agents {
		view, found := s.turnSourceViews[ref]
		if !lifeEnabled(entry) || entry.Agent.GetOwnerUserId() != decision.AccountID || !found || view.WorldTimeDecodeFailure != "" {
			continue
		}
		handle := mintLocalAppAgentHandle(decision, ref)
		handles[ref] = handle
		l := entry.Life
		resident := &runtimev1.LocalAppAgentUtopiaResident{AgentHandle: handle, DisplayName: entry.Agent.GetDisplayName(), Solitary: settings.Solitary[ref]}
		if l.Interaction != nil {
			resident.Current = &runtimev1.LocalAppAgentUtopiaFrame{Title: "Interaction", StartsAt: timestamppb.New(l.Interaction.StartedAt), Interaction: true}
		} else if l.Current != nil && !l.Current.Invalidated && (l.Current.SharedRef == "" || activeShared[l.Current.SharedRef]) &&
			!now.Before(l.Current.StartsAt) && now.Before(l.Current.EndsAt) && (l.Current.Place == "" || utopia.allows(l.Current.Place, l.Current.UtopiaActivity) && (!l.Current.Public || settings.publicFor(ref))) {
			resident.Current = projectUtopiaFrame(*l.Current)
		}
		for i := len(l.Recent) - 1; i >= 0; i-- {
			if !l.Recent[i].Invalidated && !l.Recent[i].Interaction {
				resident.Recent = projectUtopiaFrame(l.Recent[i])
				break
			}
		}
		for _, frame := range l.Future {
			if !frame.Invalidated && !frame.StartsAt.Before(now) && (frame.Place == "" || utopia.allows(frame.Place, frame.UtopiaActivity) && (!frame.Public || settings.publicFor(ref))) {
				resident.Next = projectUtopiaFrame(frame)
				break
			}
		}
		out.Residents = append(out.Residents, resident)
	}
	sort.Slice(out.Residents, func(i, j int) bool {
		a, b := out.Residents[i], out.Residents[j]
		if a.DisplayName != b.DisplayName {
			return a.DisplayName < b.DisplayName
		}
		return a.AgentHandle < b.AgentHandle
	})
	for _, occupancy := range s.currentPublicLifeLocked(decision.AccountID, settings, utopia, activeShared, now) {
		projected := &runtimev1.LocalAppAgentUtopiaOccupancy{Place: occupancy.Place}
		for _, ref := range occupancy.AgentRefs {
			if handle := handles[ref]; handle != "" {
				projected.AgentHandles = append(projected.AgentHandles, handle)
			}
		}
		if len(projected.AgentHandles) > 0 {
			out.Occupancy = append(out.Occupancy, projected)
		}
	}
	closed := 0
	for _, activity := range shared {
		if !activity.ClosedAt.IsZero() {
			closed++
			if closed > lifeSharedLimit || !now.Before(activity.ClosedAt.Add(lifeSharedRetention)) {
				continue
			}
		} else {
			if activity.State == "invited" && !now.Before(activity.Deadline) {
				continue
			}
			if activity.State == "active" && !activeShared[activity.Ref] {
				continue
			}
		}
		from, to := activity.StartsAt, activity.EndsAt
		if !activity.OccurredFrom.IsZero() {
			from, to = activity.OccurredFrom, activity.OccurredTo
		}
		item := &runtimev1.LocalAppAgentUtopiaSharedActivity{
			ActivityRef: activity.Ref, InitiatorHandle: handles[activity.Initiator], RecipientHandle: handles[activity.Recipient],
			Place: lifeSharedPlace, Activity: lifeSharedActivity, State: activity.State, StartsAt: timestamppb.New(from),
		}
		if !to.IsZero() {
			item.EndsAt = timestamppb.New(to)
		}
		if !activity.AcceptedAt.IsZero() {
			item.AcceptedAt = timestamppb.New(activity.AcceptedAt)
		}
		out.SharedActivities = append(out.SharedActivities, item)
	}
	select {
	case <-decision.SessionInvalidated:
		return nil, localAppAgentAccessDenied()
	default:
		return out, nil
	}
}

func projectUtopiaFrame(frame lifeFrame) *runtimev1.LocalAppAgentUtopiaFrame {
	title := frame.Title
	if frame.Invalidated || !frame.Public || frame.SharedRef != "" {
		title = "Activity"
		if !frame.Invalidated && frame.SharedRef == "" && frame.UtopiaActivity != "" {
			title = frame.UtopiaActivity
		}
	}
	place := frame.Place
	if frame.SharedRef != "" {
		place = ""
	}
	return &runtimev1.LocalAppAgentUtopiaFrame{Title: title, Place: place, StartsAt: timestamppb.New(frame.StartsAt), EndsAt: timestamppb.New(frame.EndsAt)}
}

func projectUtopiaSettings(settings lifeUtopiaSettings, utopia lifeUtopia) *runtimev1.LocalAppAgentUtopiaSettings {
	return &runtimev1.LocalAppAgentUtopiaSettings{Revision: settings.Revision, Preset: utopia.Preset, PresetVersion: utopia.PresetVersion, OutdoorOpen: utopia.OutdoorOpen, PublicParticipation: settings.Public}
}

func (s *Service) UpdateLocalAppAgentUtopiaSettings(ctx context.Context, req *runtimev1.UpdateLocalAppAgentUtopiaSettingsRequest) (*runtimev1.UpdateLocalAppAgentUtopiaSettingsResponse, error) {
	decision, ok := authorizedLocalAppAgentDecision(ctx, localappop.OperationAgentUtopiaSettingsUpdate)
	if !ok || decision.OperationCapability != "agent.utopia.manage" || ctx.Err() != nil {
		return nil, localAppAgentAccessDenied()
	}
	invalid := func() error {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if req == nil || req.GetExpectedRevision() == 0 || len(req.ProtoReflect().GetUnknown()) != 0 {
		return nil, invalid()
	}
	var change lifeUtopiaChange
	switch intent := req.Intent.(type) {
	case *runtimev1.UpdateLocalAppAgentUtopiaSettingsRequest_SelectPreset:
		if intent.SelectPreset != lifeIslandPreset && intent.SelectPreset != lifePolarPreset {
			return nil, invalid()
		}
		change.Preset = intent.SelectPreset
	case *runtimev1.UpdateLocalAppAgentUtopiaSettingsRequest_RestoreDefault:
		if !intent.RestoreDefault {
			return nil, invalid()
		}
		change.Restore = true
	case *runtimev1.UpdateLocalAppAgentUtopiaSettingsRequest_OutdoorOpen:
		change.OutdoorOpen = &intent.OutdoorOpen
	case *runtimev1.UpdateLocalAppAgentUtopiaSettingsRequest_PublicParticipation:
		change.Public = &intent.PublicParticipation
	case *runtimev1.UpdateLocalAppAgentUtopiaSettingsRequest_Solitude:
		if intent.Solitude == nil || len(intent.Solitude.ProtoReflect().GetUnknown()) != 0 || strings.TrimSpace(intent.Solitude.AgentHandle) == "" {
			return nil, invalid()
		}
		resolved, _, err := s.resolveLocalAppAgent(ctx, localappop.OperationAgentUtopiaSettingsUpdate, intent.Solitude.AgentHandle)
		if err != nil {
			return nil, err
		}
		change.AgentRef, change.Solitary = resolved.identity.LocalAgentRef, &intent.Solitude.Solitary
	default:
		return nil, invalid()
	}
	settings, err := s.updateLifeUtopia(ctx, decision.AccountID, req.ExpectedRevision, change, func(ctx context.Context, persist func(context.Context) error) error {
		return s.commitLocalAppOwnerMutation(ctx, localappop.IngressAgentUtopiaSettingsUpdate, decision, persist)
	})
	if errors.Is(err, errLifeUtopiaRevision) {
		return nil, grpcerr.WithReasonCode(codes.Aborted, runtimev1.ReasonCode_AGENT_UTOPIA_REVISION_CONFLICT)
	}
	if err != nil {
		return nil, err
	}
	utopia, err := settings.effective()
	if err != nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	return &runtimev1.UpdateLocalAppAgentUtopiaSettingsResponse{Settings: projectUtopiaSettings(settings, utopia)}, nil
}
