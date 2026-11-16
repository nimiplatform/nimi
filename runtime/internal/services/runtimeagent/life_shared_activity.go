package runtimeagent

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/proto"
)

const (
	lifeSharedRetention = 24 * time.Hour
	lifeSharedLimit     = 12
)

type lifeSharedRecord struct {
	Ref                 string    `json:"ref"`
	HabitatActivationID string    `json:"habitatActivationId,omitempty"`
	HabitatID           string    `json:"habitatId,omitempty"`
	HabitatTitle        string    `json:"habitatTitle,omitempty"`
	PlaceID             string    `json:"placeId,omitempty"`
	PlaceLabel          string    `json:"placeLabel,omitempty"`
	ActivityID          string    `json:"activityId,omitempty"`
	ActivityLabel       string    `json:"activityLabel,omitempty"`
	Initiator           string    `json:"initiator"`
	Recipient           string    `json:"recipient"`
	State               string    `json:"state"`
	AcceptedAt          time.Time `json:"acceptedAt,omitempty"`
	ReplyStarted        bool      `json:"replyStarted,omitempty"`
	Deadline            time.Time `json:"deadline"`
	StartsAt            time.Time `json:"startsAt"`
	EndsAt              time.Time `json:"endsAt"`
	OccurredFrom        time.Time `json:"occurredFrom,omitempty"`
	OccurredTo          time.Time `json:"occurredTo,omitempty"`
	ClosedAt            time.Time `json:"closedAt,omitempty"`
	// Only active participation is tied to an authenticated Runtime generation.
	// A future agreement is rechecked when it starts.
	ActiveAccountGeneration uint64 `json:"activeAccountGeneration,omitempty"`
}

func (record lifeSharedRecord) effectivePlaceID() string {
	if record.PlaceID != "" {
		return record.PlaceID
	}
	return "observation-window"
}

func (record lifeSharedRecord) effectiveActivityID() string {
	if record.ActivityID != "" {
		return record.ActivityID
	}
	return "observe-snow"
}

func (record lifeSharedRecord) effectiveHabitatTitle() string {
	if record.HabitatTitle != "" {
		return record.HabitatTitle
	}
	return legacyUtopiaLabelFallback
}

func (record lifeSharedRecord) effectivePlaceLabel() string {
	if record.PlaceLabel != "" {
		return record.PlaceLabel
	}
	return legacyUtopiaLabelFallback
}

func (record lifeSharedRecord) effectiveActivityLabel() string {
	if record.ActivityLabel != "" {
		return record.ActivityLabel
	}
	return legacyUtopiaLabelFallback
}

func (record lifeSharedRecord) validState() bool {
	switch record.State {
	case "invited":
		return record.ClosedAt.IsZero() && record.AcceptedAt.IsZero()
	case "accepted":
		return record.ClosedAt.IsZero() && !record.AcceptedAt.IsZero()
	case "active":
		return record.ClosedAt.IsZero() && !record.AcceptedAt.IsZero() && !record.OccurredFrom.IsZero()
	case "completed", "interrupted", "missed", "declined", "invalidated", "unavailable", "unanswered", "expired", "relocated":
		return !record.ClosedAt.IsZero()
	case "relocated_partial":
		return !record.ClosedAt.IsZero() && !record.OccurredFrom.IsZero()
	default:
		return false
	}
}

func (s *Service) readLifeSharedRecords(ctx context.Context, accountID string) ([]lifeSharedRecord, error) {
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT activity_ref,record_json FROM runtime_agent_utopia_shared WHERE account_id=?`, accountID)
	if err != nil {
		return nil, fmt.Errorf("read shared Utopia activities: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var records []lifeSharedRecord
	for rows.Next() {
		var ref string
		var raw []byte
		if err := rows.Scan(&ref, &raw); err != nil {
			return nil, err
		}
		var record lifeSharedRecord
		if err := json.Unmarshal(raw, &record); err != nil {
			return nil, fmt.Errorf("decode shared activity: %w", err)
		}
		if ref != record.Ref || record.Initiator == "" || record.Recipient == "" || record.Initiator == record.Recipient || !record.StartsAt.After(record.Deadline) || !record.EndsAt.After(record.StartsAt) || !record.validState() {
			return nil, fmt.Errorf("invalid shared activity record")
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(records, func(i, j int) bool {
		if records[i].ClosedAt.Equal(records[j].ClosedAt) {
			return records[i].Ref > records[j].Ref
		}
		return records[i].ClosedAt.After(records[j].ClosedAt)
	})
	return records, nil
}

func pruneClosedSharedLifeTx(tx *sql.Tx, accountID string) error {
	_, err := tx.Exec(`DELETE FROM runtime_agent_utopia_shared WHERE account_id=? AND activity_ref IN (
		SELECT activity_ref FROM runtime_agent_utopia_shared WHERE account_id=? AND closed_at_ns IS NOT NULL
		ORDER BY closed_at_ns DESC,activity_ref DESC LIMIT -1 OFFSET ?)`, accountID, accountID, lifeSharedLimit)
	return err
}

func persistSharedLifeTx(tx *sql.Tx, accountID string, record lifeSharedRecord) error {
	value, err := json.Marshal(record)
	if err != nil {
		return err
	}
	var closedAt any
	if !record.ClosedAt.IsZero() {
		closedAt = record.ClosedAt.UnixNano()
	}
	_, err = tx.Exec(`INSERT INTO runtime_agent_utopia_shared(account_id,activity_ref,record_json,closed_at_ns) VALUES(?,?,?,?) ON CONFLICT(account_id,activity_ref) DO UPDATE SET record_json=excluded.record_json,closed_at_ns=excluded.closed_at_ns`,
		accountID, record.Ref, string(value), closedAt)
	return err
}

func sharedRecordFor(records []lifeSharedRecord, ref string) *lifeSharedRecord {
	for _, record := range records {
		if record.ClosedAt.IsZero() && (record.Initiator == ref || record.Recipient == ref) {
			return &record
		}
	}
	return nil
}

// Only the start is daypart-gated. Already established participation keeps its
// original start, while unstarted agreements must fit the current timezone.
func sharedLifeConditionsAllowed(utopia lifeUtopia, record lifeSharedRecord) bool {
	if record.State == "active" {
		return utopia.allowsShared(record.effectivePlaceID(), record.effectiveActivityID())
	}
	return utopia.allowsSharedAt(record.effectivePlaceID(), record.effectiveActivityID(), record.StartsAt)
}

func invalidateSharedLife(record lifeSharedRecord, now time.Time) lifeSharedRecord {
	switch record.State {
	case "active":
		record.State = "interrupted"
	case "accepted":
		record.State = "invalidated"
	default:
		record.State = "invalidated"
	}
	record.ClosedAt = now
	return record
}

func relocateSharedLife(record lifeSharedRecord, now time.Time, unknownTail bool) lifeSharedRecord {
	if record.State == "active" {
		if unknownTail {
			record.State = "interrupted"
		} else if now.After(record.OccurredFrom) {
			record.State = "relocated_partial"
		} else {
			record.State = "relocated"
		}
	} else {
		record.State = "relocated"
	}
	record.ClosedAt = now
	return record
}

func (s *Service) validSharedParticipantLocked(accountID, ref string) bool {
	entry := s.agents[ref]
	view, found := s.turnSourceViews[ref]
	return entry != nil && entry.Agent.GetOwnerUserId() == accountID && found && view.WorldTimeDecodeFailure == ""
}

func (s *Service) eligibleSharedAgentLocked(accountID, ref string, settings lifeUtopiaSettings) bool {
	return s.validSharedParticipantLocked(accountID, ref) && lifeEnabled(s.agents[ref]) && settings.publicFor(ref)
}

func (s *Service) sharedLifeVisibleNowLocked(accountID string, scope uint64, settings lifeUtopiaSettings, utopia lifeUtopia, record lifeSharedRecord, now time.Time) bool {
	sameActivation := record.HabitatActivationID == "" || record.HabitatActivationID == utopia.HabitatActivationID
	return record.State == "active" && record.ActiveAccountGeneration == scope && sameActivation &&
		!now.Before(record.OccurredFrom) && now.Before(record.EndsAt) && utopia.allowsShared(record.effectivePlaceID(), record.effectiveActivityID()) &&
		s.eligibleSharedAgentLocked(accountID, record.Initiator, settings) && s.eligibleSharedAgentLocked(accountID, record.Recipient, settings) &&
		s.agents[record.Initiator].Life.sharedLifeCurrent(record.Ref) && s.agents[record.Recipient].Life.sharedLifeCurrent(record.Ref)
}

func sharedLifeDue(entry *agentEntry, now time.Time) time.Time {
	return maxTime(now, entry.Life.LastLifeAttempt.Add(lifeMinimumAttemptInterval(entry)))
}

func sharedLifeWindowStart(l *agentLifeState, earliest time.Time) time.Time {
	start := maxTime(earliest, l.SettledAt)
	if l.Current != nil {
		start = maxTime(start, l.Current.EndsAt)
	}
	for _, f := range l.Future {
		start = maxTime(start, f.EndsAt)
	}
	return start
}

func canReserveSharedLife(l *agentLifeState, start time.Time) bool {
	return l.Interaction == nil && len(l.Future) < lifeFutureLimit && l.unfinishedActivityCount() < lifeUnfinishedLimit && !sharedLifeWindowStart(l, start).After(start)
}

func (l *agentLifeState) reserveSharedLife(record lifeSharedRecord) error {
	if !canReserveSharedLife(l, record.StartsAt) {
		return fmt.Errorf("shared activity conflicts with an existing plan")
	}
	title := record.effectiveActivityLabel()
	l.Activities[record.Ref] = &lifeActivity{Ref: record.Ref, Title: title, Kind: "routine", Phase: lifePlanned}
	l.Future = append(l.Future, lifeFrame{
		ID:                  record.Ref,
		ActivityRef:         record.Ref,
		Title:               title,
		Phase:               lifePlanned,
		HabitatActivationID: record.HabitatActivationID,
		HabitatID:           record.HabitatID,
		HabitatTitle:        record.effectiveHabitatTitle(),
		Place:               record.effectivePlaceID(),
		PlaceLabel:          record.effectivePlaceLabel(),
		UtopiaActivity:      record.effectiveActivityID(),
		ActivityLabel:       record.effectiveActivityLabel(),
		Public:              true,
		SharedRef:           record.Ref,
		StartsAt:            record.StartsAt,
		EndsAt:              record.EndsAt,
		EndProgress:         100,
		CompletesActivity:   true,
	})
	return l.changed()
}

func (l *agentLifeState) startSharedLife(record lifeSharedRecord, now time.Time) bool {
	if l.Interaction != nil || l.Current != nil || len(l.Future) == 0 || l.Future[0].SharedRef != record.Ref || now.Before(l.SettledAt) {
		return false
	}
	f := l.Future[0]
	l.Future = l.Future[1:]
	f.StartsAt, f.Phase = now, lifeActive
	l.Current = &f
	a := l.Activities[record.Ref]
	a.Phase, a.StartedAt = lifeActive, now
	return true
}

func (l *agentLifeState) closeSharedLife(record lifeSharedRecord, now time.Time) bool {
	if l.Current != nil && l.Current.SharedRef == record.Ref {
		f := *l.Current
		f.EndsAt = minTime(now, f.EndsAt)
		f.RecordedAt = now
		f.Phase, f.ActivityState = lifeInterrupted, lifePaused
		a := l.Activities[record.Ref]
		a.Phase = lifePaused
		if record.State == "completed" {
			f.Phase, f.ActivityState, f.EndProgress = lifeCompleted, lifeCompleted, 100
			a.Phase, a.Progress, a.CompletedAt = lifeCompleted, 100, f.EndsAt
		} else {
			f.EndProgress, f.CompletesActivity, f.ActivityState = a.Progress, false, lifeCanceled
			a.Phase, a.CompletedAt = lifeCanceled, f.EndsAt
		}
		if f.EndsAt.After(f.StartsAt) {
			l.appendRecent(f)
		} else {
			delete(l.Activities, record.Ref)
		}
		l.SettledAt = maxTime(l.SettledAt, f.EndsAt)
		l.Current = nil
		l.NextCheckAt = now
		l.pruneActivities()
		return true
	}
	for i, f := range l.Future {
		if f.SharedRef != record.Ref {
			continue
		}
		l.Future = append(l.Future[:i], l.Future[i+1:]...)
		delete(l.Activities, record.Ref)
		l.NextCheckAt = now
		return true
	}
	for i := len(l.Recent) - 1; i >= 0; i-- {
		if l.Recent[i].SharedRef == record.Ref {
			frame := &l.Recent[i]
			end := minTime(frame.EndsAt, now)
			if !end.After(frame.StartsAt) {
				l.Recent = append(l.Recent[:i], l.Recent[i+1:]...)
				delete(l.Activities, record.Ref)
			} else if record.State == "completed" {
				frame.EndsAt = end
				frame.Phase, frame.ActivityState, frame.EndProgress, frame.CompletesActivity = lifeCompleted, lifeCompleted, 100, true
				if activity := l.Activities[record.Ref]; activity != nil {
					activity.Phase, activity.Progress, activity.CompletedAt = lifeCompleted, 100, end
				}
			} else {
				frame.EndsAt = end
				frame.ActivityState = lifeCanceled
				if activity := l.Activities[record.Ref]; activity != nil {
					activity.Phase, activity.CompletedAt = lifeCanceled, end
				}
			}
			l.SettledAt = maxTime(l.SettledAt, end)
			l.pruneActivities()
			return true
		}
	}
	if l.Activities[record.Ref] != nil {
		delete(l.Activities, record.Ref)
		return true
	}
	return false
}

func (s *Service) commitSharedLifeLocked(ctx context.Context, account string, record *lifeSharedRecord, updates []*agentEntry, now time.Time, hook runtimeAgentStateTxHook, events ...*runtimev1.AgentEvent) error {
	for _, entry := range updates {
		prior := s.agents[entry.Agent.GetLocalAgentRef()]
		events = append(events, optionalEvents(s.syncLifePresentation(entry, prior.Life.Current != nil, now))...)
	}
	saved, sequence := append([]*runtimev1.AgentEvent(nil), s.events...), s.sequence
	committed := s.appendEventsLocked(events...)
	if err := s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if record != nil {
			if err := persistSharedLifeTx(tx, account, *record); err != nil {
				return err
			}
			if !record.ClosedAt.IsZero() {
				if err := pruneClosedSharedLifeTx(tx, account); err != nil {
					return err
				}
			}
		}
		return persistAgentDeltasTx(tx, updates, committed, s.sequence, hook)
	}); err != nil {
		s.events, s.sequence = saved, sequence
		return err
	}
	for _, entry := range updates {
		s.agents[entry.Agent.GetLocalAgentRef()] = entry
	}
	s.broadcast(committed, s.matchingSubscribersLocked(committed))
	return nil
}

// settleNaturalSharedLifeAtLocked settles records whose deadline or scheduled
// window already elapsed (or whose active frame already ended/broke) at or
// before `now` under `settings` and `utopia`, before an environment change or
// invalidation branch can overwrite an already-finished outcome.
func (s *Service) settleNaturalSharedLifeAtLocked(account string, settings lifeUtopiaSettings, utopia lifeUtopia, r lifeSharedRecord, now time.Time, unknownTail bool) (lifeSharedRecord, bool) {
	switch r.State {
	case "invited":
		if !now.Before(r.Deadline) {
			r.State, r.ClosedAt = "expired", now
			if r.ReplyStarted {
				r.State = "unavailable"
			}
			return r, true
		}
	case "accepted":
		if !now.Before(r.EndsAt) {
			r.State, r.ClosedAt = "missed", now
			return r, true
		}
	case "active":
		a, b := s.agents[r.Initiator], s.agents[r.Recipient]
		bothCurrent := a != nil && b != nil && a.Life.sharedLifeCurrent(r.Ref) && b.Life.sharedLifeCurrent(r.Ref)
		bothCompletedWindow := a != nil && b != nil && a.Life.sharedLifeEstablishedUntil(r.Ref, r.EndsAt) && b.Life.sharedLifeEstablishedUntil(r.Ref, r.EndsAt)
		if !unknownTail && !now.Before(r.EndsAt) && bothCompletedWindow {
			sameActivation := r.HabitatActivationID == "" || r.HabitatActivationID == utopia.HabitatActivationID
			endAt := r.EndsAt
			if r.EndsAt.After(r.OccurredFrom) {
				endAt = r.EndsAt.Add(-time.Nanosecond)
			}
			utopiaAtEnd, err := settings.effectiveAt(endAt)
			validAtCompletion := err == nil && sameActivation &&
				s.validSharedParticipantLocked(account, r.Initiator) &&
				s.validSharedParticipantLocked(account, r.Recipient) &&
				sharedLifeConditionsAllowed(utopiaAtEnd, r)
			if validAtCompletion {
				r.State, r.ClosedAt = "completed", now
				return r, true
			}
		}
		if !bothCurrent {
			r.State, r.ClosedAt = "interrupted", now
			return r, true
		}
	}
	return r, false
}

// @nimi-authority: rule.nimi.runtime.agent-life.shared-activity
func (s *Service) maintainSharedLifeLocked(ctx context.Context, account string, scope lifeAccountScope, settings lifeUtopiaSettings, utopia lifeUtopia, records []lifeSharedRecord, now time.Time, recovery bool) error {
	publish := func(commit func(context.Context) error) error {
		if recovery {
			return commit(ctx)
		}
		return s.commitLifeAccount(ctx, account, scope, commit)
	}
	var expired []string
	closed := 0
	for _, r := range records {
		if !r.ClosedAt.IsZero() {
			closed++
			if !now.Before(r.ClosedAt.Add(lifeSharedRetention)) || closed > lifeSharedLimit {
				expired = append(expired, r.Ref)
			}
			continue
		}
		sameActivation := r.HabitatActivationID == "" || r.HabitatActivationID == utopia.HabitatActivationID
		eligible := sameActivation && s.eligibleSharedAgentLocked(account, r.Initiator, settings) && s.eligibleSharedAgentLocked(account, r.Recipient, settings) && sharedLifeConditionsAllowed(utopia, r)
		unknownTail := r.State == "active" && (recovery || r.ActiveAccountGeneration != scope.generation)
		var updates []*agentEntry
		if settled, ok := s.settleNaturalSharedLifeAtLocked(account, settings, utopia, r, now, unknownTail); ok {
			r = settled
		} else {
			switch {
			case !sameActivation:
				r = relocateSharedLife(r, now, unknownTail)
			case unknownTail:
				r.State, r.ClosedAt = "interrupted", now
			case !eligible:
				r = invalidateSharedLife(r, now)
			case r.State == "accepted" && !now.Before(r.StartsAt):
				a, b := cloneAgentEntry(s.agents[r.Initiator]), cloneAgentEntry(s.agents[r.Recipient])
				if recovery {
					r.State, r.ClosedAt = "missed", now
					break
				}
				if !utopia.allowsSharedAt(r.effectivePlaceID(), r.effectiveActivityID(), now) {
					r.State, r.ClosedAt = "invalidated", now
				} else if lifeInteractionBlocks(a.Life.Interaction, now) || lifeInteractionBlocks(b.Life.Interaction, now) ||
					s.lifeInteractionBusy(r.Initiator) || s.lifeInteractionBusy(r.Recipient) {
					r.State, r.ClosedAt = "missed", now
				} else if a.Life.startSharedLife(r, now) && b.Life.startSharedLife(r, now) {
					r.State, r.OccurredFrom = "active", now
					r.ActiveAccountGeneration = scope.generation
					for _, entry := range []*agentEntry{a, b} {
						if err := entry.Life.changed(); err != nil {
							return err
						}
					}
					updates = []*agentEntry{a, b}
				} else {
					continue
				}
			default:
				continue
			}
		}
		if !r.ClosedAt.IsZero() {
			var err error
			updates, err = s.closeSharedLifeLocked(&r, unknownTail)
			if err != nil {
				return err
			}
		}
		if err := publish(func(current context.Context) error {
			return s.commitSharedLifeLocked(current, account, &r, updates, now, nil)
		}); err != nil {
			return err
		}
	}
	if len(expired) == 0 {
		return nil
	}
	return publish(func(current context.Context) error {
		return s.backend.WriteTx(current, func(tx *sql.Tx) error {
			for _, ref := range expired {
				if _, err := tx.Exec(`DELETE FROM runtime_agent_utopia_shared WHERE account_id=? AND activity_ref=?`, account, ref); err != nil {
					return err
				}
			}
			return nil
		})
	})
}

func (s *Service) closeSharedLifeLocked(record *lifeSharedRecord, unknownTail bool) ([]*agentEntry, error) {
	end := minTime(record.ClosedAt, record.EndsAt)
	participants := []*agentEntry{s.agents[record.Initiator], s.agents[record.Recipient]}
	for _, entry := range participants {
		if entry == nil {
			continue
		}
		if interaction := entry.Life.Interaction; interaction != nil {
			end = minTime(end, interaction.StartedAt)
		}
		for _, frame := range entry.Life.Recent {
			if frame.SharedRef == record.Ref {
				end = minTime(end, frame.EndsAt)
			}
		}
	}
	if unknownTail && !record.OccurredFrom.IsZero() {
		end = record.OccurredFrom
	}
	var updates []*agentEntry
	for _, current := range participants {
		if entry := cloneAgentEntry(current); entry != nil && entry.Life.closeSharedLife(*record, end) {
			if err := entry.Life.changed(); err != nil {
				return nil, err
			}
			updates = append(updates, entry)
		}
	}
	if end.After(record.OccurredFrom) && !record.OccurredFrom.IsZero() {
		record.OccurredTo = end
	} else if record.State == "relocated_partial" {
		record.State = "relocated"
	}
	return updates, nil
}

func (l *agentLifeState) sharedLifeCurrent(ref string) bool {
	return l.Current != nil && l.Current.SharedRef == ref
}

func (l *agentLifeState) sharedLifeEstablishedUntil(ref string, targetEnd time.Time) bool {
	if l == nil || (l.Interaction != nil && l.Interaction.StartedAt.Before(targetEnd)) {
		return false
	}
	if l.Current != nil && l.Current.SharedRef == ref {
		return !l.Current.Invalidated && !l.Current.EndsAt.Before(targetEnd) && l.Current.EndsAt.After(l.Current.StartsAt)
	}
	for i := len(l.Recent) - 1; i >= 0; i-- {
		if l.Recent[i].SharedRef == ref {
			frame := l.Recent[i]
			return !frame.Invalidated && !frame.EndsAt.Before(targetEnd) && frame.EndsAt.After(frame.StartsAt)
		}
	}
	return false
}

func (s *Service) maintainCurrentUtopia(ctx context.Context, now time.Time) (string, lifeUtopiaSettings, lifeUtopia, []lifeSharedRecord, error) {
	if s.runtimeAccountProjection == nil || s.isClosed() {
		return "", lifeUtopiaSettings{}, lifeUtopia{}, nil, nil
	}
	projection, scope, ready := s.currentLifeAccount(ctx)
	if !ready || projection.GetAccountId() == "" {
		return "", lifeUtopiaSettings{}, lifeUtopia{}, nil, nil
	}
	accountID := projection.GetAccountId()
	s.cognitionMemoryOwnerLifecycleMu.Lock()
	defer s.cognitionMemoryOwnerLifecycleMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.accountTerminationFencedLocked(accountID) {
		return "", lifeUtopiaSettings{}, lifeUtopia{}, nil, nil
	}
	settings, err := s.readLifeUtopiaSettings(ctx, accountID)
	if err != nil {
		return "", lifeUtopiaSettings{}, lifeUtopia{}, nil, err
	}
	utopia, err := settings.effectiveAt(now)
	if err != nil {
		return "", lifeUtopiaSettings{}, lifeUtopia{}, nil, err
	}
	records, err := s.readLifeSharedRecords(ctx, accountID)
	if err != nil {
		return "", lifeUtopiaSettings{}, lifeUtopia{}, nil, err
	}
	if len(records) == 0 {
		return accountID, settings, utopia, nil, nil
	}
	if err := s.maintainSharedLifeLocked(ctx, accountID, scope, settings, utopia, records, now, false); err != nil {
		return "", lifeUtopiaSettings{}, lifeUtopia{}, nil, err
	}
	return accountID, settings, utopia, records, nil
}

func (s *Service) recoverSharedLife(ctx context.Context, now time.Time) error {
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT DISTINCT account_id FROM runtime_agent_utopia_shared`)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	var accounts []string
	for rows.Next() {
		var account string
		if err := rows.Scan(&account); err != nil {
			return err
		}
		accounts = append(accounts, account)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, account := range accounts {
		settings, err := s.readLifeUtopiaSettings(ctx, account)
		if err != nil {
			return err
		}
		utopia, err := settings.effectiveAt(now)
		if err != nil {
			return err
		}
		records, err := s.readLifeSharedRecords(ctx, account)
		if err != nil {
			return err
		}
		if err := s.maintainSharedLifeLocked(ctx, account, lifeAccountScope{}, settings, utopia, records, now, true); err != nil {
			return err
		}
	}
	return nil
}

func newSharedLifeRecord(ref, recipient string, utopia lifeUtopia, option lifePublicOption) lifeSharedRecord {
	placeLabel := option.PlaceLabel
	if placeLabel == "" {
		placeLabel = utopia.Spec.placeLabel(option.Place)
	}
	actLabel := option.ActivityLabel
	if actLabel == "" {
		if act, ok := utopia.Spec.activityByID(option.Activity); ok {
			actLabel = act.Name
		}
	}
	return lifeSharedRecord{
		Ref:                 "shared_" + ulid.Make().String(),
		HabitatActivationID: utopia.HabitatActivationID,
		HabitatID:           utopia.Spec.HabitatID,
		HabitatTitle:        utopia.Spec.Title,
		PlaceID:             option.Place,
		PlaceLabel:          placeLabel,
		ActivityID:          option.Activity,
		ActivityLabel:       actLabel,
		Initiator:           ref,
		Recipient:           recipient,
		State:               "invited",
		Deadline:            option.Deadline,
		StartsAt:            option.StartsAt,
		EndsAt:              option.EndsAt,
	}
}

func (s *Service) sharedLifeInvitationOptionsLocked(accountID, ref string, settings lifeUtopiaSettings, utopia lifeUtopia, records []lifeSharedRecord, now time.Time) []lifePublicOption {
	if sharedRecordFor(records, ref) != nil {
		return nil
	}
	initiator := s.agents[ref]
	if !s.eligibleSharedAgentLocked(accountID, ref, settings) || initiator.Life.Interaction != nil || initiator.Life.unfinishedActivityCount() >= lifeUnfinishedLimit {
		return nil
	}
	var refs []string
	for candidate := range s.agents {
		if candidate != ref && s.eligibleSharedAgentLocked(accountID, candidate, settings) && sharedRecordFor(records, candidate) == nil {
			refs = append(refs, candidate)
		}
	}
	sort.Strings(refs)
	var options []lifePublicOption
	for _, recipient := range refs {
		partner := s.agents[recipient]
		if partner.Life.Interaction != nil || partner.Agent.GetAutonomy().GetBudgetExhausted() || partner.Agent.GetAutonomy().GetSuspendedUntil().AsTime().After(now) {
			continue
		}
		due := sharedLifeDue(partner, now)
		deadline := due.Add(4 * time.Minute)
		start := sharedLifeWindowStart(initiator.Life, deadline.Add(time.Minute))
		start = sharedLifeWindowStart(partner.Life, start)
		if !canReserveSharedLife(initiator.Life, start) || !canReserveSharedLife(partner.Life, start) {
			continue
		}
		startDaypart := evalHabitatDaypart(start, utopia.Timezone)
		for _, act := range utopia.Spec.Activities {
			if act.SocialMode != "shared_invite" || !slices.Contains(act.AllowedDayparts, startDaypart) || !evalHabitatConditions(act.When, utopia.ParameterValues) {
				continue
			}
			dur := time.Duration(act.MinDurationMinutes) * time.Minute
			end := start.Add(dur)
			if end.After(now.Add(24 * time.Hour)) {
				continue
			}
			for _, pid := range act.PlaceIDs {
				if pid == habitatPersonalQuarterID || !utopia.isPlaceOpen(pid) {
					continue
				}
				options = append(options, lifePublicOption{
					Place:           pid,
					PlaceLabel:      utopia.Spec.placeLabel(pid),
					Activity:        act.ID,
					ActivityLabel:   act.Name,
					DurationMinutes: act.MinDurationMinutes,
					Action:          "invite",
					Partner:         partner.Agent.GetDisplayName(),
					recipient:       recipient,
					StartsAt:        start,
					EndsAt:          end,
					Deadline:        deadline,
				})
				if len(options) >= 4 {
					return options
				}
			}
		}
	}
	return options
}

func (s *Service) commitSharedLifeDecision(work *agentBackgroundExecution, attempt *agentEntry, input lifePublicInput, choice int, usage int64, executionErr error, now time.Time) {
	if err := s.applySharedLifeDecision(work, attempt, input, choice, usage, executionErr, now); err != nil {
		if s.logger != nil {
			s.logger.Warn("commit shared life decision", "error", err)
		}
		s.recordPublicLifeUsage(attempt, usage, now)
	}
}

func (s *Service) applySharedLifeDecision(work *agentBackgroundExecution, attempt *agentEntry, input lifePublicInput, choice int, usage int64, executionErr error, now time.Time) error {
	s.cognitionMemoryOwnerLifecycleMu.Lock()
	defer s.cognitionMemoryOwnerLifecycleMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	if committedAt := time.Now().UTC(); committedAt.After(now) {
		now = committedAt
	}
	ref, accountID := attempt.Agent.GetLocalAgentRef(), attempt.Agent.GetOwnerUserId()
	current := s.agents[ref]
	if current == nil || !proto.Equal(current.Agent.GetCreatedAt(), attempt.Agent.GetCreatedAt()) {
		return nil
	}
	if work.ctx.Err() != nil || work.invalidated || s.backgroundByAgent[ref] != work || s.isClosed() || s.accountTerminationFencedLocked(accountID) || s.agentTerminationFencedLocked(ref) {
		return fmt.Errorf("shared life lost execution scope")
	}
	settings, err := s.readLifeUtopiaSettings(work.ctx, accountID)
	if err != nil {
		return err
	}
	utopia, err := settings.effectiveAt(now)
	if err != nil {
		return err
	}
	if !s.eligibleSharedAgentLocked(accountID, ref, settings) || !input.Utopia.sameConditions(utopia) || !utopia.acceptsRead(input.habitatRead, now) {
		return fmt.Errorf("shared life conditions changed")
	}
	records, err := s.readLifeSharedRecords(work.ctx, accountID)
	if err != nil {
		return err
	}
	actor := cloneAgentEntry(current)
	before := snapshotAutonomy(actor.Agent.GetAutonomy())
	applyTokenUsage(actor, usage, now)
	actor.Life.NextPublicAt = now.Add(pacedLifePlanningInterval(actor, now))
	updates := []*agentEntry{actor}
	events := optionalEvents(budgetEventForTransition(ref, before, actor.Agent.GetAutonomy(), now))
	commit := func(record *lifeSharedRecord) error {
		return s.commitLifeAccount(work.ctx, accountID, input.account, func(ctx context.Context) error {
			return s.commitSharedLifeLocked(ctx, accountID, record, updates, now, func(*sql.Tx) error {
				return input.habitatRead.checkCommitTime()
			}, events...)
		})
	}
	var record lifeSharedRecord
	if input.responseRef != "" {
		pending := sharedRecordFor(records, ref)
		if pending == nil || pending.Ref != input.responseRef || pending.State != "invited" || pending.Recipient != ref || !pending.ReplyStarted || !now.Before(pending.Deadline) {
			return fmt.Errorf("shared invitation expired or changed")
		}
		sameActivation := pending.HabitatActivationID == "" || pending.HabitatActivationID == utopia.HabitatActivationID
		if !sameActivation || !sharedLifeConditionsAllowed(utopia, *pending) {
			return fmt.Errorf("shared invitation activity is no longer available")
		}
		record = *pending
		switch {
		case executionErr != nil:
			record.State, record.ClosedAt = "unavailable", now
		case choice == 0:
			record.State, record.ClosedAt = "unanswered", now
		case input.Options[choice-1].Action == "decline":
			record.State, record.ClosedAt = "declined", now
		default:
			if !s.eligibleSharedAgentLocked(accountID, record.Initiator, settings) || s.agentTerminationFencedLocked(record.Initiator) {
				record.State, record.ClosedAt = "invalidated", now
				break
			}
			other := cloneAgentEntry(s.agents[record.Initiator])
			actorWithReservation := cloneAgentEntry(actor)
			if other.Life.reserveSharedLife(record) != nil || actorWithReservation.Life.reserveSharedLife(record) != nil {
				record.State, record.ClosedAt = "invalidated", now
			} else {
				record.State = "accepted"
				record.AcceptedAt = now
				updates = []*agentEntry{actorWithReservation, other}
			}
		}
	} else {
		option := input.Options[choice-1]
		if !utopia.allowsSharedAt(option.Place, option.Activity, option.StartsAt) {
			return commit(nil)
		}
		if sharedRecordFor(records, ref) != nil || sharedRecordFor(records, option.recipient) != nil || !now.Before(option.Deadline) || !s.eligibleSharedAgentLocked(accountID, option.recipient, settings) || s.agentTerminationFencedLocked(option.recipient) {
			return commit(nil)
		}
		other := s.agents[option.recipient]
		if sharedLifeDue(other, now).Add(time.Second).After(option.Deadline) || !canReserveSharedLife(actor.Life, option.StartsAt) || !canReserveSharedLife(other.Life, option.StartsAt) {
			return commit(nil)
		}
		record = newSharedLifeRecord(ref, option.recipient, utopia, option)
	}
	return commit(&record)
}
