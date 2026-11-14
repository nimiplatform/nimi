package runtimeagent

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/proto"
)

const (
	lifeSharedPlace     = "observation-window"
	lifeSharedActivity  = "observe-snow"
	lifeSharedRetention = 24 * time.Hour
	lifeSharedLimit     = 12
)

type lifeSharedRecord struct {
	Ref          string    `json:"ref"`
	Initiator    string    `json:"initiator"`
	Recipient    string    `json:"recipient"`
	State        string    `json:"state"`
	AcceptedAt   time.Time `json:"acceptedAt,omitempty"`
	ReplyStarted bool      `json:"replyStarted,omitempty"`
	Deadline     time.Time `json:"deadline"`
	StartsAt     time.Time `json:"startsAt"`
	EndsAt       time.Time `json:"endsAt"`
	OccurredFrom time.Time `json:"occurredFrom,omitempty"`
	OccurredTo   time.Time `json:"occurredTo,omitempty"`
	ClosedAt     time.Time `json:"closedAt,omitempty"`
	// Only active participation is tied to an authenticated Runtime generation.
	// A future agreement is rechecked when it starts.
	ActiveAccountGeneration uint64 `json:"activeAccountGeneration,omitempty"`
}

func (record lifeSharedRecord) validState() bool {
	switch record.State {
	case "invited":
		return record.ClosedAt.IsZero() && record.AcceptedAt.IsZero()
	case "accepted":
		return record.ClosedAt.IsZero() && !record.AcceptedAt.IsZero()
	case "active":
		return record.ClosedAt.IsZero() && !record.AcceptedAt.IsZero() && !record.OccurredFrom.IsZero()
	case "completed", "interrupted", "missed", "declined", "invalidated", "unavailable", "unanswered", "expired":
		return !record.ClosedAt.IsZero()
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

func invalidateSharedLife(record lifeSharedRecord, now time.Time) lifeSharedRecord {
	switch record.State {
	case "active":
		record.State = "interrupted"
	case "accepted":
		record.State = "missed"
	default:
		record.State = "invalidated"
	}
	record.ClosedAt = now
	return record
}

func (s *Service) eligibleSharedAgentLocked(accountID, ref string, settings lifeUtopiaSettings) bool {
	entry := s.agents[ref]
	view, found := s.turnSourceViews[ref]
	return lifeEnabled(entry) && entry.Agent.GetOwnerUserId() == accountID && settings.publicFor(ref) && found && view.WorldTimeDecodeFailure == ""
}

func (s *Service) sharedLifeVisibleNowLocked(accountID string, scope uint64, settings lifeUtopiaSettings, utopia lifeUtopia, record lifeSharedRecord, now time.Time) bool {
	return record.State == "active" && record.ActiveAccountGeneration == scope &&
		!now.Before(record.OccurredFrom) && now.Before(record.EndsAt) && utopia.allows(lifeSharedPlace, lifeSharedActivity) &&
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
	l.Activities[record.Ref] = &lifeActivity{Ref: record.Ref, Title: "Observe the snow together", Kind: "routine", Phase: lifePlanned}
	l.Future = append(l.Future, lifeFrame{
		ID: record.Ref, ActivityRef: record.Ref, Title: "Observe the snow together", Phase: lifePlanned,
		Place: lifeSharedPlace, UtopiaActivity: lifeSharedActivity, Public: true, SharedRef: record.Ref,
		StartsAt: record.StartsAt, EndsAt: record.EndsAt, EndProgress: 100, CompletesActivity: true,
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
			} else {
				frame.EndsAt = end
				frame.ActivityState = lifeCanceled
				if activity := l.Activities[record.Ref]; activity != nil {
					activity.Phase, activity.CompletedAt = lifeCanceled, end
				}
			}
			return true
		}
	}
	if l.Activities[record.Ref] != nil {
		delete(l.Activities, record.Ref)
		return true
	}
	return false
}

func (s *Service) commitSharedLifeLocked(ctx context.Context, account string, record *lifeSharedRecord, updates []*agentEntry, now time.Time, events ...*runtimev1.AgentEvent) error {
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
		return persistAgentDeltasTx(tx, updates, committed, s.sequence, nil)
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
		eligible := s.eligibleSharedAgentLocked(account, r.Initiator, settings) && s.eligibleSharedAgentLocked(account, r.Recipient, settings) && utopia.allows(lifeSharedPlace, lifeSharedActivity)
		unknownTail := r.State == "active" && (recovery || r.ActiveAccountGeneration != scope.generation)
		var updates []*agentEntry
		switch {
		case unknownTail:
			r.State, r.ClosedAt = "interrupted", now
		case !eligible:
			r = invalidateSharedLife(r, now)
		case r.State == "invited" && !now.Before(r.Deadline):
			r.State, r.ClosedAt = "expired", now
			if r.ReplyStarted {
				r.State = "unavailable"
			}
		case r.State == "accepted" && !now.Before(r.EndsAt):
			r.State, r.ClosedAt = "missed", now
		case r.State == "active" && !recovery && !now.Before(r.EndsAt) && s.agents[r.Initiator].Life.sharedLifeCurrent(r.Ref) && s.agents[r.Recipient].Life.sharedLifeCurrent(r.Ref):
			r.State, r.ClosedAt = "completed", now
		case r.State == "active" && (!s.agents[r.Initiator].Life.sharedLifeCurrent(r.Ref) || !s.agents[r.Recipient].Life.sharedLifeCurrent(r.Ref)):
			r.State, r.ClosedAt = "interrupted", now
		case r.State == "accepted" && !now.Before(r.StartsAt):
			a, b := cloneAgentEntry(s.agents[r.Initiator]), cloneAgentEntry(s.agents[r.Recipient])
			if recovery {
				r.State, r.ClosedAt = "missed", now
				break
			}
			if lifeInteractionBlocks(a.Life.Interaction, now) || lifeInteractionBlocks(b.Life.Interaction, now) ||
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
				// The same sweep can finish expired interaction or personal coverage.
				continue
			}
		default:
			continue
		}
		if !r.ClosedAt.IsZero() {
			var err error
			updates, err = s.closeSharedLifeLocked(&r, unknownTail)
			if err != nil {
				return err
			}
		}
		if err := publish(func(current context.Context) error {
			return s.commitSharedLifeLocked(current, account, &r, updates, now)
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
	}
	return updates, nil
}

func (l *agentLifeState) sharedLifeCurrent(ref string) bool {
	return l.Current != nil && l.Current.SharedRef == ref
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
	utopia, err := settings.effective()
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
		utopia, err := settings.effective()
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

func newSharedLifeRecord(ref, recipient string, option lifePublicOption) lifeSharedRecord {
	return lifeSharedRecord{Ref: "shared_" + ulid.Make().String(), Initiator: ref, Recipient: recipient, State: "invited", Deadline: option.Deadline, StartsAt: option.StartsAt, EndsAt: option.EndsAt}
}

func (s *Service) sharedLifeInvitationOptionLocked(accountID, ref string, settings lifeUtopiaSettings, utopia lifeUtopia, records []lifeSharedRecord, now time.Time) (lifePublicOption, bool) {
	if !utopia.allows(lifeSharedPlace, lifeSharedActivity) || sharedRecordFor(records, ref) != nil {
		return lifePublicOption{}, false
	}
	initiator := s.agents[ref]
	if !s.eligibleSharedAgentLocked(accountID, ref, settings) || initiator.Life.Interaction != nil || initiator.Life.unfinishedActivityCount() >= lifeUnfinishedLimit {
		return lifePublicOption{}, false
	}
	var refs []string
	for candidate := range s.agents {
		if candidate != ref && s.eligibleSharedAgentLocked(accountID, candidate, settings) && sharedRecordFor(records, candidate) == nil {
			refs = append(refs, candidate)
		}
	}
	sort.Strings(refs)
	for _, recipient := range refs {
		partner := s.agents[recipient]
		if partner.Life.Interaction != nil || partner.Agent.GetAutonomy().GetBudgetExhausted() || partner.Agent.GetAutonomy().GetSuspendedUntil().AsTime().After(now) {
			continue
		}
		due := sharedLifeDue(partner, now)
		deadline := due.Add(4 * time.Minute)
		start := sharedLifeWindowStart(initiator.Life, deadline.Add(time.Minute))
		start = sharedLifeWindowStart(partner.Life, start)
		end := start.Add(lifePublicDuration)
		if end.After(now.Add(24*time.Hour)) || !canReserveSharedLife(initiator.Life, start) || !canReserveSharedLife(partner.Life, start) {
			continue
		}
		return lifePublicOption{Place: lifeSharedPlace, Activity: lifeSharedActivity, Action: "invite", Partner: partner.Agent.GetDisplayName(), recipient: recipient, StartsAt: start, EndsAt: end, Deadline: deadline}, true
	}
	return lifePublicOption{}, false
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
	utopia, err := settings.effective()
	if err != nil {
		return err
	}
	if !s.eligibleSharedAgentLocked(accountID, ref, settings) || !utopia.allows(lifeSharedPlace, lifeSharedActivity) ||
		(input.responseRef == "" && !input.Utopia.sameConditions(utopia)) {
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
			return s.commitSharedLifeLocked(ctx, accountID, record, updates, now, events...)
		})
	}
	var record lifeSharedRecord
	if input.responseRef != "" {
		pending := sharedRecordFor(records, ref)
		if pending == nil || pending.Ref != input.responseRef || pending.State != "invited" || pending.Recipient != ref || !pending.ReplyStarted || !now.Before(pending.Deadline) {
			return fmt.Errorf("shared invitation expired or changed")
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
		// A dispatched choice still consumes its public opportunity if another
		// resident commits first or the proposed window is no longer available.
		if sharedRecordFor(records, ref) != nil || sharedRecordFor(records, option.recipient) != nil || !now.Before(option.Deadline) || !s.eligibleSharedAgentLocked(accountID, option.recipient, settings) || s.agentTerminationFencedLocked(option.recipient) {
			return commit(nil)
		}
		other := s.agents[option.recipient]
		if sharedLifeDue(other, now).Add(time.Second).After(option.Deadline) || !canReserveSharedLife(actor.Life, option.StartsAt) || !canReserveSharedLife(other.Life, option.StartsAt) {
			return commit(nil)
		}
		record = newSharedLifeRecord(ref, option.recipient, option)
	}
	return commit(&record)
}
