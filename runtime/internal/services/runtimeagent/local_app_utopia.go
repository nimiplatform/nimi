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
// @nimi-authority: rule.nimi.runtime.agent-life.utopia-settings
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
	now := time.Now().UTC()
	utopia, err := settings.effectiveAt(now)
	if err != nil {
		return nil, localAppConversationOwnerUnavailable()
	}
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
	out := &runtimev1.GetLocalAppAgentUtopiaSnapshotResponse{
		Revision:            settings.Revision,
		ObservedAt:          timestamppb.New(now),
		HabitatActivationId: utopia.HabitatActivationID,
		ContentDigest:       utopia.ContentDigest,
		Timezone:            utopia.Timezone,
		PublicParticipation: settings.Public,
		Habitat:             utopia.Spec.toProto(),
		ParameterValues:     projectUtopiaParameterEntries(utopia.ParameterValues),
		OpenPlaceIds:        append([]string(nil), utopia.OpenPlaceIDs...),
		ActiveEvents:        projectUtopiaActiveEvents(utopia.ActiveEvents),
	}
	if utopia.LastRelocation != nil {
		out.LastRelocation = &runtimev1.LocalAppUtopiaRelocationSummary{
			FromHabitatId:    utopia.LastRelocation.FromHabitatID,
			FromHabitatTitle: utopia.LastRelocation.FromHabitatTitle,
			ToHabitatId:      utopia.LastRelocation.ToHabitatID,
			ToHabitatTitle:   utopia.LastRelocation.ToHabitatTitle,
			RelocatedAt:      timestamppb.New(utopia.LastRelocation.RelocatedAt),
		}
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
		solitary := settings.Solitary[ref]
		resident := &runtimev1.LocalAppUtopiaResident{
			AgentHandle: handle,
			DisplayName: entry.Agent.GetDisplayName(),
			Solitary:    solitary,
		}
		if l.Interaction != nil {
			resident.Current = &runtimev1.LocalAppUtopiaFrame{
				Title:       "Interaction",
				StartsAt:    timestamppb.New(l.Interaction.StartedAt),
				Interaction: true,
			}
		} else if l.Current != nil && !l.Current.Invalidated &&
			(l.Current.SharedRef == "" || activeShared[l.Current.SharedRef]) &&
			!now.Before(l.Current.StartsAt) && now.Before(l.Current.EndsAt) &&
			(l.Current.Place == "" || (utopia.allowsPlaceAndParameters(l.Current.Place, l.Current.UtopiaActivity) && (!l.Current.Public || settings.publicFor(ref)))) {
			resident.Current = projectUtopiaFrame(*l.Current, utopia)
		}
		for i := len(l.Recent) - 1; i >= 0; i-- {
			if !l.Recent[i].Invalidated && !l.Recent[i].Interaction {
				resident.Recent = projectUtopiaFrame(l.Recent[i], utopia)
				break
			}
		}
		for _, frame := range l.Future {
			if !frame.Invalidated && !frame.StartsAt.Before(now) &&
				(frame.Place == "" || (utopia.allowsAt(frame.Place, frame.UtopiaActivity, frame.StartsAt, solitary) && (!frame.Public || settings.publicFor(ref)))) {
				resident.Next = projectUtopiaFrame(frame, utopia)
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
		if occupancy.Place == habitatPersonalQuarterID {
			continue
		}
		projected := &runtimev1.LocalAppUtopiaPlaceOccupancy{PlaceId: occupancy.Place}
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
		item := &runtimev1.LocalAppUtopiaSharedActivity{
			ActivityRef:         activity.Ref,
			HabitatActivationId: activity.HabitatActivationID,
			HabitatId:           activity.HabitatID,
			HabitatTitle:        activity.effectiveHabitatTitle(),
			InitiatorHandle:     handles[activity.Initiator],
			RecipientHandle:     handles[activity.Recipient],
			PlaceId:             activity.effectivePlaceID(),
			PlaceLabel:          activity.effectivePlaceLabel(),
			ActivityId:          activity.effectiveActivityID(),
			ActivityLabel:       activity.effectiveActivityLabel(),
			State:               activity.State,
			StartsAt:            timestamppb.New(from),
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

// projectUtopiaFrame enforces the snapshot privacy boundary: private frame.Title
// (which may contain personal chat or memory derivatives) is NEVER read.
func projectUtopiaFrame(frame lifeFrame, utopia lifeUtopia) *runtimev1.LocalAppUtopiaFrame {
	if frame.Interaction {
		return &runtimev1.LocalAppUtopiaFrame{
			Title:       "Interaction",
			StartsAt:    timestamppb.New(frame.StartsAt),
			Interaction: true,
		}
	}
	if frame.Place == "" {
		return &runtimev1.LocalAppUtopiaFrame{
			Title:    "Activity",
			StartsAt: timestamppb.New(frame.StartsAt),
			EndsAt:   timestamppb.New(frame.EndsAt),
		}
	}
	actLabel := frame.ActivityLabel
	if actLabel == "" && frame.UtopiaActivity != "" {
		if frame.HabitatID == "" || frame.HabitatID == utopia.Spec.HabitatID {
			if act, ok := utopia.Spec.activityByID(frame.UtopiaActivity); ok {
				actLabel = act.Name
			}
		}
		if actLabel == "" {
			actLabel = frame.UtopiaActivity
		}
	}
	title := "Activity"
	if !frame.Invalidated && actLabel != "" {
		title = actLabel
	}
	habTitle := frame.HabitatTitle
	if habTitle == "" {
		if frame.HabitatID == utopia.Spec.HabitatID {
			habTitle = utopia.Spec.Title
		} else {
			habTitle = legacyUtopiaLabelFallback
		}
	}
	placeLabel := frame.PlaceLabel
	if placeLabel == "" {
		if frame.HabitatID == "" || frame.HabitatID == utopia.Spec.HabitatID {
			placeLabel = utopia.Spec.placeLabel(frame.Place)
		}
		if placeLabel == "" {
			placeLabel = legacyUtopiaLabelFallback
		}
	}
	return &runtimev1.LocalAppUtopiaFrame{
		ActivityId:          frame.UtopiaActivity,
		Title:               title,
		HabitatActivationId: frame.HabitatActivationID,
		HabitatId:           frame.HabitatID,
		HabitatTitle:        habTitle,
		PlaceId:             frame.Place,
		PlaceLabel:          placeLabel,
		StartsAt:            timestamppb.New(frame.StartsAt),
		EndsAt:              timestamppb.New(frame.EndsAt),
	}
}

func projectUtopiaParameterEntries(values map[string]string) []*runtimev1.LocalAppUtopiaParameterEntry {
	if len(values) == 0 {
		return nil
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]*runtimev1.LocalAppUtopiaParameterEntry, 0, len(keys))
	for _, k := range keys {
		out = append(out, &runtimev1.LocalAppUtopiaParameterEntry{Key: k, Value: values[k]})
	}
	return out
}

func projectUtopiaActiveEvents(events []lifeUtopiaActiveEvent) []*runtimev1.LocalAppUtopiaActiveEvent {
	if len(events) == 0 {
		return nil
	}
	out := make([]*runtimev1.LocalAppUtopiaActiveEvent, 0, len(events))
	for _, ev := range events {
		item := &runtimev1.LocalAppUtopiaActiveEvent{
			EventId:     ev.EventID,
			Slot:        ev.Slot,
			SceneryKind: ev.SceneryKind,
			Label:       ev.Label,
			Description: ev.Description,
			StartsAt:    timestamppb.New(ev.StartsAt),
			ExpiresAt:   timestamppb.New(ev.ExpiresAt),
		}
		if ev.PlaceID != nil {
			v := *ev.PlaceID
			item.PlaceId = &v
		}
		out = append(out, item)
	}
	return out
}

func decodeUtopiaParameterEntries(entries []*runtimev1.LocalAppUtopiaParameterEntry) (map[string]string, bool) {
	if len(entries) == 0 {
		return nil, true
	}
	out := make(map[string]string, len(entries))
	for _, entry := range entries {
		if entry == nil || len(entry.ProtoReflect().GetUnknown()) != 0 || entry.GetKey() == "" {
			return nil, false
		}
		if _, dup := out[entry.GetKey()]; dup {
			return nil, false
		}
		out[entry.GetKey()] = entry.GetValue()
	}
	return out, true
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
	switch intent := req.Change.(type) {
	case *runtimev1.UpdateLocalAppAgentUtopiaSettingsRequest_ActivateHabitat:
		if intent.ActivateHabitat == nil || len(intent.ActivateHabitat.ProtoReflect().GetUnknown()) != 0 {
			return nil, invalid()
		}
		spec, err := habitatSpecFromProto(intent.ActivateHabitat.GetHabitat())
		if err != nil {
			return nil, invalid()
		}
		params, ok := decodeUtopiaParameterEntries(intent.ActivateHabitat.GetInitialParameters())
		if !ok {
			return nil, invalid()
		}
		change.ActivateHabitat = &spec
		change.InitialParameters = params
		if intent.ActivateHabitat.Timezone != nil {
			tz := intent.ActivateHabitat.GetTimezone()
			change.Timezone = &tz
		}
	case *runtimev1.UpdateLocalAppAgentUtopiaSettingsRequest_RestoreDefault:
		if intent.RestoreDefault == nil || len(intent.RestoreDefault.ProtoReflect().GetUnknown()) != 0 {
			return nil, invalid()
		}
		change.Restore = true
		if intent.RestoreDefault.Timezone != nil {
			tz := intent.RestoreDefault.GetTimezone()
			change.Timezone = &tz
		}
	case *runtimev1.UpdateLocalAppAgentUtopiaSettingsRequest_ApplyTuning:
		if intent.ApplyTuning == nil || len(intent.ApplyTuning.ProtoReflect().GetUnknown()) != 0 {
			return nil, invalid()
		}
		params, ok := decodeUtopiaParameterEntries(intent.ApplyTuning.GetParameters())
		if !ok || len(params) > 4 {
			return nil, invalid()
		}
		var evMut *lifeUtopiaEventMutation
		if rawEv := intent.ApplyTuning.GetEventMutation(); rawEv != nil {
			if len(rawEv.ProtoReflect().GetUnknown()) != 0 {
				return nil, invalid()
			}
			switch action := rawEv.Action.(type) {
			case *runtimev1.LocalAppUtopiaEventMutation_TriggerPreset:
				if action.TriggerPreset == nil || len(action.TriggerPreset.ProtoReflect().GetUnknown()) != 0 {
					return nil, invalid()
				}
				evMut = &lifeUtopiaEventMutation{
					Kind:     "trigger-preset",
					PresetID: action.TriggerPreset.GetPresetId(),
				}
				if action.TriggerPreset.DurationMinutes != nil {
					d := int(action.TriggerPreset.GetDurationMinutes())
					evMut.DurationMinutes = &d
				}
			case *runtimev1.LocalAppUtopiaEventMutation_PutCustom:
				if action.PutCustom == nil || len(action.PutCustom.ProtoReflect().GetUnknown()) != 0 {
					return nil, invalid()
				}
				d := int(action.PutCustom.GetDurationMinutes())
				evMut = &lifeUtopiaEventMutation{
					Kind:            "put-custom",
					SceneryKind:     action.PutCustom.GetSceneryKind(),
					Label:           action.PutCustom.GetLabel(),
					Description:     action.PutCustom.GetDescription(),
					DurationMinutes: &d,
				}
				if action.PutCustom.PlaceId != nil {
					pid := action.PutCustom.GetPlaceId()
					evMut.PlaceID = &pid
				}
			case *runtimev1.LocalAppUtopiaEventMutation_ClearEventId:
				evMut = &lifeUtopiaEventMutation{
					Kind:         "clear-event",
					ClearEventID: action.ClearEventId,
				}
			default:
				return nil, invalid()
			}
		}
		if len(params) == 0 && evMut == nil {
			return nil, invalid()
		}
		change.ApplyParameters = params
		change.EventMutation = evMut
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
	case *runtimev1.UpdateLocalAppAgentUtopiaSettingsRequest_Timezone:
		tz := intent.Timezone
		change.Timezone = &tz
	default:
		return nil, invalid()
	}
	settings, err := s.updateLifeUtopia(ctx, decision.AccountID, req.ExpectedRevision, change, func(ctx context.Context, persist func(context.Context) error) error {
		return s.commitLocalAppOwnerMutation(ctx, localappop.IngressAgentUtopiaSettingsUpdate, decision, persist)
	})
	if errors.Is(err, errLifeUtopiaRevision) {
		return nil, grpcerr.WithReasonCode(codes.Aborted, runtimev1.ReasonCode_AGENT_UTOPIA_REVISION_CONFLICT)
	}
	if errors.Is(err, errLifeUtopiaInvalidChange) {
		return nil, invalid()
	}
	if err != nil {
		return nil, err
	}
	utopia, err := settings.effective()
	if err != nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	return &runtimev1.UpdateLocalAppAgentUtopiaSettingsResponse{
		Revision:            settings.Revision,
		HabitatActivationId: utopia.HabitatActivationID,
		HabitatId:           utopia.Spec.HabitatID,
		HabitatTitle:        utopia.Spec.Title,
		ContentDigest:       utopia.ContentDigest,
		Timezone:            utopia.Timezone,
		PublicParticipation: settings.Public,
		ParameterValues:     projectUtopiaParameterEntries(utopia.ParameterValues),
		OpenPlaceIds:        append([]string(nil), utopia.OpenPlaceIDs...),
		ActiveEvents:        projectUtopiaActiveEvents(utopia.ActiveEvents),
	}, nil
}
