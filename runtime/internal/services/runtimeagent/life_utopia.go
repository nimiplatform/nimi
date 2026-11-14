package runtimeagent

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
)

const (
	lifeIslandPreset = "island"
	lifePolarPreset  = "polar-station"
)

var errLifeUtopiaRevision = errors.New("Utopia settings revision changed")

type lifeUtopiaPlace struct {
	ID         string   `json:"id"`
	Activities []string `json:"activities"`
}

type lifeUtopia struct {
	Preset             string            `json:"preset"`
	PresetVersion      uint64            `json:"preset_version"`
	Revision           uint64            `json:"revision"`
	Setting            string            `json:"setting"`
	OutdoorOpen        bool              `json:"outdoor_open"`
	Places             []lifeUtopiaPlace `json:"places"`
	conditionsRevision uint64
}

type lifeUtopiaPlanningConditions struct {
	Preset        string `json:"preset"`
	PresetVersion uint64 `json:"preset_version"`
	OutdoorOpen   bool   `json:"outdoor_open"`
}

func (utopia lifeUtopia) planningConditions() lifeUtopiaPlanningConditions {
	return lifeUtopiaPlanningConditions{Preset: utopia.Preset, PresetVersion: utopia.PresetVersion, OutdoorOpen: utopia.OutdoorOpen}
}

type lifeUtopiaSettings struct {
	Revision           uint64          `json:"revision"`
	Preset             string          `json:"preset,omitempty"`
	OutdoorOpen        *bool           `json:"outdoorOpen,omitempty"`
	Public             bool            `json:"public,omitempty"`
	Solitary           map[string]bool `json:"solitary,omitempty"`
	ConditionsRevision uint64          `json:"conditionsRevision,omitempty"`
}

func (settings lifeUtopiaSettings) effective() (lifeUtopia, error) {
	if settings.Revision == 0 || settings.ConditionsRevision > settings.Revision {
		return lifeUtopia{}, fmt.Errorf("invalid Utopia revision")
	}
	utopia := lifeUtopia{PresetVersion: 1, Revision: settings.Revision, OutdoorOpen: true, conditionsRevision: max(1, settings.ConditionsRevision)}
	if settings.OutdoorOpen != nil {
		utopia.OutdoorOpen = *settings.OutdoorOpen
	}
	workshop := lifeUtopiaPlace{ID: "workshop", Activities: []string{"read", "sketch", "organize"}}
	var outdoor lifeUtopiaPlace
	switch settings.Preset {
	case "", lifeIslandPreset:
		utopia.Preset = lifeIslandPreset
		utopia.Setting = "A quiet coastal island with a sheltered birdwatching spot and a workshop."
		utopia.Places = []lifeUtopiaPlace{{ID: "bird-hide", Activities: []string{"watch-birds"}}, workshop}
		outdoor = lifeUtopiaPlace{ID: "island-deck", Activities: []string{"watch-waves"}}
	case lifePolarPreset:
		utopia.Preset = lifePolarPreset
		utopia.Setting = "A polar research station with an indoor observation window and sheltered workspaces."
		utopia.Places = []lifeUtopiaPlace{{ID: "observation-window", Activities: []string{"observe-snow"}}, workshop}
		outdoor = lifeUtopiaPlace{ID: "outdoor-platform", Activities: []string{"observe-snow"}}
	default:
		return lifeUtopia{}, fmt.Errorf("unknown Utopia preset")
	}
	if utopia.OutdoorOpen {
		utopia.Places = append(utopia.Places, outdoor)
	}
	return utopia, nil
}

func (h lifeUtopia) allows(place, activity string) bool {
	for _, p := range h.Places {
		if p.ID == place {
			for _, a := range p.Activities {
				if a == activity {
					return true
				}
			}
		}
	}
	return false
}

func (h lifeUtopia) sameConditions(other lifeUtopia) bool {
	return h.Preset == other.Preset && h.PresetVersion == other.PresetVersion && h.OutdoorOpen == other.OutdoorOpen && h.conditionsRevision == other.conditionsRevision
}

func (settings lifeUtopiaSettings) publicFor(ref string) bool {
	return settings.Public && !settings.Solitary[ref]
}

// @nimi-authority: rule.nimi.runtime.agent-life.utopia-settings
func (s *Service) readLifeUtopiaSettings(ctx context.Context, accountID string) (lifeUtopiaSettings, error) {
	if s.backend == nil || s.isClosed() || accountID == "" {
		return lifeUtopiaSettings{}, fmt.Errorf("current Utopia scope is unavailable")
	}
	var raw []byte
	err := s.backend.DB().QueryRowContext(ctx, `SELECT settings_json FROM runtime_agent_utopia_settings WHERE account_id=?`, accountID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return lifeUtopiaSettings{Revision: 1}, nil
	}
	if err != nil {
		return lifeUtopiaSettings{}, fmt.Errorf("read Utopia settings: %w", err)
	}
	var settings lifeUtopiaSettings
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&settings); err != nil {
		return lifeUtopiaSettings{}, fmt.Errorf("decode Utopia settings: %w", err)
	}
	if decoder.Decode(new(any)) != io.EOF {
		return lifeUtopiaSettings{}, fmt.Errorf("unexpected trailing Utopia settings")
	}
	return settings, nil
}

type lifeUtopiaChange struct {
	Preset      string
	Restore     bool
	OutdoorOpen *bool
	Public      *bool
	AgentRef    string
	Solitary    *bool
}

func (s *Service) updateLifeUtopia(ctx context.Context, accountID string, expected uint64, change lifeUtopiaChange, persist func(context.Context, func(context.Context) error) error) (lifeUtopiaSettings, error) {
	s.cognitionMemoryOwnerLifecycleMu.Lock()
	defer s.cognitionMemoryOwnerLifecycleMu.Unlock()
	s.mu.Lock()
	var committed []*runtimev1.AgentEvent
	var targets [][]*subscriber
	defer func() {
		s.mu.Unlock()
		s.broadcast(committed, targets)
	}()
	if s.accountTerminationFencedLocked(accountID) {
		return lifeUtopiaSettings{}, localAppAgentAccessDenied()
	}
	settings, err := s.readLifeUtopiaSettings(ctx, accountID)
	if err != nil {
		return lifeUtopiaSettings{}, err
	}
	if expected == 0 || expected != settings.Revision {
		return lifeUtopiaSettings{}, errLifeUtopiaRevision
	}
	previousUtopia, err := settings.effective()
	if err != nil {
		return lifeUtopiaSettings{}, err
	}
	if change.Solitary != nil {
		entry := s.agents[change.AgentRef]
		source, found := s.turnSourceViews[change.AgentRef]
		if !lifeEnabled(entry) || entry.Agent.GetOwnerUserId() != accountID || !found || source.WorldTimeDecodeFailure != "" {
			return lifeUtopiaSettings{}, localAppAgentAccessDenied()
		}
		if settings.Solitary == nil {
			settings.Solitary = make(map[string]bool)
		}
		if *change.Solitary {
			settings.Solitary[change.AgentRef] = true
		} else {
			delete(settings.Solitary, change.AgentRef)
		}
	}
	if change.Restore {
		settings.Preset, settings.OutdoorOpen = "", nil
	} else if change.Preset != "" {
		settings.Preset, settings.OutdoorOpen = change.Preset, nil
	}
	if change.OutdoorOpen != nil {
		settings.OutdoorOpen = change.OutdoorOpen
	}
	if change.Public != nil {
		settings.Public = *change.Public
	}
	settings.Revision++
	utopia, err := settings.effective()
	if err != nil {
		return lifeUtopiaSettings{}, err
	}
	if !utopia.sameConditions(previousUtopia) {
		settings.ConditionsRevision = settings.Revision
	}
	encoded, err := json.Marshal(settings)
	if err != nil {
		return lifeUtopiaSettings{}, fmt.Errorf("encode Utopia settings: %w", err)
	}
	now := time.Now().UTC()
	decision, _ := authorizedLocalAppAgentDecision(ctx, localappop.OperationAgentUtopiaSettingsUpdate)
	shared, err := s.readLifeSharedRecords(ctx, accountID)
	if err != nil {
		return lifeUtopiaSettings{}, err
	}
	var closed []lifeSharedRecord
	changedEntries := make(map[string]*agentEntry)
	for _, record := range shared {
		if !record.ClosedAt.IsZero() || (settings.publicFor(record.Initiator) && settings.publicFor(record.Recipient) && utopia.allows(lifeSharedPlace, lifeSharedActivity)) {
			continue
		}
		record = invalidateSharedLife(record, now)
		entries, err := s.closeSharedLifeLocked(&record, record.ActiveAccountGeneration != decision.AccountGeneration)
		if err != nil {
			return lifeUtopiaSettings{}, err
		}
		closed = append(closed, record)
		for _, entry := range entries {
			changedEntries[entry.Agent.GetLocalAgentRef()] = entry
		}
	}
	refs := make([]string, 0, len(s.agents))
	for ref, entry := range s.agents {
		if entry.Agent.GetOwnerUserId() == accountID && entry.Life != nil && (entry.Life.hasUtopiaActivity() || changedEntries[ref] != nil) {
			refs = append(refs, ref)
		}
	}
	sort.Strings(refs)
	var next []*agentEntry
	var events []*runtimev1.AgentEvent
	for _, ref := range refs {
		entry, sharedChanged := changedEntries[ref]
		if !sharedChanged {
			entry = cloneAgentEntry(s.agents[ref])
		}
		hadCurrent := s.agents[ref].Life.Current != nil
		changed, err := entry.Life.revalidateUtopia(utopia, settings.publicFor(ref), now)
		if err != nil {
			return lifeUtopiaSettings{}, err
		}
		if changed || sharedChanged {
			next = append(next, entry)
			events = append(events, optionalEvents(s.syncLifePresentation(entry, hadCurrent, now))...)
		}
	}
	previousEvents := append([]*runtimev1.AgentEvent(nil), s.events...)
	previousSequence := s.sequence
	settingsEvents := s.appendEventsLocked(events...)
	if err := persist(ctx, func(current context.Context) error {
		return s.backend.WriteTx(current, func(tx *sql.Tx) error {
			if _, err := tx.Exec(`INSERT INTO runtime_agent_utopia_settings(account_id,settings_json) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET settings_json=excluded.settings_json`, accountID, string(encoded)); err != nil {
				return fmt.Errorf("persist Utopia settings: %w", err)
			}
			for _, record := range closed {
				if err := persistSharedLifeTx(tx, accountID, record); err != nil {
					return err
				}
			}
			if len(closed) != 0 {
				if err := pruneClosedSharedLifeTx(tx, accountID); err != nil {
					return err
				}
			}
			if len(next) == 0 {
				return nil
			}
			return persistAgentDeltasTx(tx, next, settingsEvents, s.sequence, nil)
		})
	}); err != nil {
		s.events, s.sequence = previousEvents, previousSequence
		return lifeUtopiaSettings{}, err
	}
	for _, entry := range next {
		s.agents[entry.Agent.GetLocalAgentRef()] = entry
	}
	committed, targets = settingsEvents, s.matchingSubscribersLocked(settingsEvents)
	return settings, nil
}

func (l *agentLifeState) hasUtopiaActivity() bool {
	if l.Current != nil && l.Current.Place != "" {
		return true
	}
	for _, frame := range l.Future {
		if frame.Place != "" {
			return true
		}
	}
	return false
}

func (l *agentLifeState) revalidateUtopia(utopia lifeUtopia, public bool, now time.Time) (bool, error) {
	invalid := func(frame lifeFrame) bool {
		return frame.Place != "" && (!utopia.allows(frame.Place, frame.UtopiaActivity) || frame.Public && !public)
	}
	changed := false
	if l.Current != nil && now.Before(l.Current.EndsAt) && invalid(*l.Current) {
		if l.Current.SharedRef == "" {
			l.interruptCurrent(now)
			l.SettledAt = maxTime(l.SettledAt, now)
			changed = true
		}
	}
	kept := l.Future[:0]
	progress := make(map[string]int)
	if l.Current != nil {
		progress[l.Current.ActivityRef] = l.Current.EndProgress
	}
	for _, frame := range l.Future {
		a := l.Activities[frame.ActivityRef]
		established, ok := progress[frame.ActivityRef]
		if !ok && a != nil {
			established = a.Progress
		}
		if frame.SharedRef == "" && (invalid(frame) || frame.StartProgress > established) {
			changed = true
			if a != nil && a.Phase == lifePlanned {
				a.Phase = lifePaused
			}
		} else {
			kept = append(kept, frame)
			progress[frame.ActivityRef] = frame.EndProgress
		}
	}
	l.Future = kept
	if !changed {
		return false, nil
	}
	l.NextCheckAt = now
	return true, l.changed()
}
