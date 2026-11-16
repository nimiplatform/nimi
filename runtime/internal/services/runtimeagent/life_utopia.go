package runtimeagent

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"slices"
	"sort"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/oklog/ulid/v2"
)

const (
	lifeIslandPreset = "island"
	lifePolarPreset  = "polar-station"

	defaultHabitatActivationID = "habact_default_seaside_island"
	legacyIslandActivationID   = "habact_legacy_island"
	legacyPolarActivationID    = "habact_legacy_polar"

	utopiaRelocationAwarenessWindow = 6 * time.Hour
	utopiaPlanningMaxUTF8Bytes      = 2048
	utopiaPostureMaxUTF8Bytes       = 1536
)

var (
	errLifeUtopiaRevision      = errors.New("Utopia settings revision changed")
	errLifeUtopiaInvalidChange = errors.New("invalid Utopia settings change")
	errLifeUtopiaReadChanged   = errors.New("contact habitat source changed before message commit")
)

type lifeUtopiaActiveEvent struct {
	EventID     string    `json:"eventId"`
	Slot        string    `json:"slot"` // "preset" | "custom"
	SceneryKind string    `json:"sceneryKind"`
	Label       string    `json:"label"`
	Description string    `json:"description"`
	PlaceID     *string   `json:"placeId,omitempty"`
	StartsAt    time.Time `json:"startsAt"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type lifeUtopiaRelocationSummary struct {
	FromHabitatID    string    `json:"fromHabitatId"`
	FromHabitatTitle string    `json:"fromHabitatTitle"`
	ToHabitatID      string    `json:"toHabitatId"`
	ToHabitatTitle   string    `json:"toHabitatTitle"`
	RelocatedAt      time.Time `json:"relocatedAt"`
}

type lifeUtopiaPlanningConditions struct {
	HabitatActivationID string `json:"habitatActivationId,omitempty"`
	HabitatID           string `json:"habitatId,omitempty"`
	HabitatTitle        string `json:"habitatTitle,omitempty"`
	ContentDigest       string `json:"contentDigest,omitempty"`
	ConditionsRevision  uint64 `json:"conditionsRevision,omitempty"`
	// Retained with omitempty so DisallowUnknownFields on existing SQLite
	// runtime_local_agent_life rows upgrades cleanly without breaking boot.
	Preset        string `json:"preset,omitempty"`
	PresetVersion uint64 `json:"preset_version,omitempty"`
	OutdoorOpen   bool   `json:"outdoor_open,omitempty"`
}

type lifeUtopiaSettings struct {
	SchemaVersion       int                          `json:"schemaVersion,omitempty"`
	Revision            uint64                       `json:"revision"`
	ConditionsRevision  uint64                       `json:"conditionsRevision,omitempty"`
	HabitatActivationID string                       `json:"habitatActivationId"`
	ActivatedAt         time.Time                    `json:"activatedAt,omitempty"`
	Habitat             lifeHabitatSpec              `json:"habitat"`
	ContentDigest       string                       `json:"contentDigest"`
	Timezone            string                       `json:"timezone"`
	ParameterValues     map[string]string            `json:"parameterValues,omitempty"`
	ActiveEvents        []lifeUtopiaActiveEvent      `json:"activeEvents,omitempty"`
	LastRelocation      *lifeUtopiaRelocationSummary `json:"lastRelocation,omitempty"`
	Public              bool                         `json:"public,omitempty"`
	Solitary            map[string]bool              `json:"solitary,omitempty"`

	validated         bool
	validatedSpec     lifeHabitatSpec
	validatedDigest   string
	validatedTimezone string
	validatedParams   map[string]string
}

type lifeUtopiaLegacySettingsV1 struct {
	Revision           uint64          `json:"revision"`
	Preset             string          `json:"preset,omitempty"`
	OutdoorOpen        *bool           `json:"outdoorOpen,omitempty"`
	Public             bool            `json:"public,omitempty"`
	Solitary           map[string]bool `json:"solitary,omitempty"`
	ConditionsRevision uint64          `json:"conditionsRevision,omitempty"`
}

type lifeUtopia struct {
	Revision            uint64
	ConditionsRevision  uint64
	HabitatActivationID string
	ActivatedAt         time.Time
	ContentDigest       string
	Timezone            string
	Daypart             string
	Spec                lifeHabitatSpec
	ParameterValues     map[string]string
	OpenPlaceIDs        []string
	ActiveEvents        []lifeUtopiaActiveEvent
	LastRelocation      *lifeUtopiaRelocationSummary
	HasCustomScenery    bool
}

func defaultLifeUtopiaSettings() (lifeUtopiaSettings, error) {
	spec, digest, err := validateAndDigestHabitatSpec(builtinSeasideIslandSpec())
	if err != nil {
		return lifeUtopiaSettings{}, err
	}
	settings := lifeUtopiaSettings{
		SchemaVersion:       2,
		Revision:            1,
		ConditionsRevision:  1,
		HabitatActivationID: defaultHabitatActivationID,
		Habitat:             spec,
		ContentDigest:       digest,
		Timezone:            "UTC",
		ParameterValues:     spec.defaultParameterValues(),
	}
	return settings, nil
}

func upgradeLegacyUtopiaSettings(legacy lifeUtopiaLegacySettingsV1) (lifeUtopiaSettings, error) {
	if legacy.Revision == 0 || legacy.ConditionsRevision > legacy.Revision {
		return lifeUtopiaSettings{}, fmt.Errorf("invalid legacy Utopia revision")
	}
	var rawSpec lifeHabitatSpec
	activationID := legacyIslandActivationID
	closedWeather := "rain"
	switch legacy.Preset {
	case "", lifeIslandPreset:
		rawSpec = builtinSeasideIslandSpec()
	case lifePolarPreset:
		rawSpec = builtinPolarStationSpec()
		activationID = legacyPolarActivationID
		closedWeather = "blizzard"
	default:
		return lifeUtopiaSettings{}, fmt.Errorf("unknown legacy Utopia preset %q", legacy.Preset)
	}
	spec, digest, err := validateAndDigestHabitatSpec(rawSpec)
	if err != nil {
		return lifeUtopiaSettings{}, err
	}
	params := spec.defaultParameterValues()
	if legacy.OutdoorOpen != nil && !*legacy.OutdoorOpen {
		params["weather"] = closedWeather
	}
	return lifeUtopiaSettings{
		SchemaVersion:       2,
		Revision:            legacy.Revision,
		ConditionsRevision:  max(1, legacy.ConditionsRevision),
		HabitatActivationID: activationID,
		Habitat:             spec,
		ContentDigest:       digest,
		Timezone:            "UTC",
		ParameterValues:     params,
		Public:              legacy.Public,
		Solitary:            maps.Clone(legacy.Solitary),
	}, nil
}

func (settings *lifeUtopiaSettings) validateCore() error {
	if settings.SchemaVersion != 0 && settings.SchemaVersion != 2 {
		return fmt.Errorf("unsupported Utopia settings schemaVersion %d", settings.SchemaVersion)
	}
	if settings.Revision == 0 || settings.ConditionsRevision > settings.Revision || settings.HabitatActivationID == "" {
		return fmt.Errorf("invalid Utopia revision")
	}
	tz := settings.Timezone
	if tz == "" {
		tz = "UTC"
	}
	if _, err := validateHabitatTimezone(tz); err != nil {
		return err
	}
	spec, digest, err := validateAndDigestHabitatSpec(settings.Habitat)
	if err != nil {
		return err
	}
	if settings.ContentDigest != "" && settings.ContentDigest != digest {
		return fmt.Errorf("Utopia habitat contentDigest mismatch")
	}
	params, err := spec.resolveParameters(settings.ParameterValues, true)
	if err != nil {
		return err
	}
	seenSlots := make(map[string]bool, 2)
	for _, ev := range settings.ActiveEvents {
		if ev.EventID == "" || (ev.Slot != "preset" && ev.Slot != "custom") || seenSlots[ev.Slot] {
			return fmt.Errorf("invalid stored Utopia active event")
		}
		seenSlots[ev.Slot] = true
		if !validHabitatSceneryKinds[ev.SceneryKind] || !validShortNounLabel(ev.Label) || !validDisplaySummary(ev.Description) {
			return fmt.Errorf("invalid stored Utopia active event text")
		}
		if ev.PlaceID != nil && (*ev.PlaceID == habitatPersonalQuarterID || spec.placeLabel(*ev.PlaceID) == "") {
			return fmt.Errorf("invalid stored Utopia active event place %q", *ev.PlaceID)
		}
	}
	settings.validated = true
	settings.validatedSpec = spec
	settings.validatedDigest = digest
	settings.validatedTimezone = tz
	settings.validatedParams = params
	return nil
}

func (settings lifeUtopiaSettings) effective() (lifeUtopia, error) {
	return settings.effectiveAt(time.Now().UTC())
}

func (settings lifeUtopiaSettings) effectiveAt(now time.Time) (lifeUtopia, error) {
	if !settings.validated || settings.ContentDigest == "" || settings.ContentDigest != settings.validatedDigest {
		if err := (&settings).validateCore(); err != nil {
			return lifeUtopia{}, err
		}
	}
	spec := settings.validatedSpec
	digest := settings.validatedDigest
	tz := settings.validatedTimezone
	params := maps.Clone(settings.validatedParams)
	openPlaces := spec.evalOpenPlaceIDs(params)
	var activeEvents []lifeUtopiaActiveEvent
	hasCustom := false
	for _, ev := range settings.ActiveEvents {
		if !now.Before(ev.ExpiresAt) {
			// Logical read-side expiry without grabbing a database write lock.
			continue
		}
		cp := ev
		if ev.PlaceID != nil {
			pid := *ev.PlaceID
			cp.PlaceID = &pid
		}
		activeEvents = append(activeEvents, cp)
		if ev.Slot == "custom" {
			hasCustom = true
		}
	}
	var lastReloc *lifeUtopiaRelocationSummary
	if settings.LastRelocation != nil {
		cp := *settings.LastRelocation
		lastReloc = &cp
	}
	return lifeUtopia{
		Revision:            settings.Revision,
		ConditionsRevision:  max(1, settings.ConditionsRevision),
		HabitatActivationID: settings.HabitatActivationID,
		ActivatedAt:         settings.ActivatedAt,
		ContentDigest:       digest,
		Timezone:            tz,
		Daypart:             evalHabitatDaypart(now, tz),
		Spec:                spec,
		ParameterValues:     params,
		OpenPlaceIDs:        openPlaces,
		ActiveEvents:        activeEvents,
		LastRelocation:      lastReloc,
		HasCustomScenery:    hasCustom,
	}, nil
}

func (u lifeUtopia) planningConditions() lifeUtopiaPlanningConditions {
	return lifeUtopiaPlanningConditions{
		HabitatActivationID: u.HabitatActivationID,
		HabitatID:           u.Spec.HabitatID,
		HabitatTitle:        u.Spec.Title,
		ContentDigest:       u.ContentDigest,
		ConditionsRevision:  u.ConditionsRevision,
	}
}

func (u lifeUtopia) sameConditions(other lifeUtopia) bool {
	return u.HabitatActivationID == other.HabitatActivationID &&
		u.ContentDigest == other.ContentDigest &&
		u.ConditionsRevision == other.ConditionsRevision &&
		maps.Equal(u.ParameterValues, other.ParameterValues)
}

func (u lifeUtopia) isPlaceOpen(placeID string) bool {
	return placeID == habitatPersonalQuarterID || slices.Contains(u.OpenPlaceIDs, placeID)
}

// allowsPlaceAndParameters checks whether placeID is open and activityID's
// parameter conditions hold under the current habitat, independent of daypart
// (used for already-started or already-reserved frames).
func (u lifeUtopia) allowsPlaceAndParameters(placeID, activityID string) bool {
	if placeID == "" || activityID == "" || !u.isPlaceOpen(placeID) {
		return false
	}
	act, ok := u.Spec.activityByID(activityID)
	if !ok || !slices.Contains(act.PlaceIDs, placeID) {
		return false
	}
	return evalHabitatConditions(act.When, u.ParameterValues)
}

func (u lifeUtopia) allowsAt(placeID, activityID string, at time.Time, solitary bool) bool {
	if !u.allowsPlaceAndParameters(placeID, activityID) {
		return false
	}
	act, _ := u.Spec.activityByID(activityID)
	if solitary && placeID != habitatPersonalQuarterID {
		return false
	}
	dp := evalHabitatDaypart(at, u.Timezone)
	return slices.Contains(act.AllowedDayparts, dp)
}

func (u lifeUtopia) allows(placeID, activityID string) bool {
	if !u.allowsPlaceAndParameters(placeID, activityID) {
		return false
	}
	act, _ := u.Spec.activityByID(activityID)
	return slices.Contains(act.AllowedDayparts, u.Daypart)
}

func (u lifeUtopia) allowsShared(placeID, activityID string) bool {
	if placeID == habitatPersonalQuarterID || !u.allowsPlaceAndParameters(placeID, activityID) {
		return false
	}
	act, ok := u.Spec.activityByID(activityID)
	return ok && act.SocialMode == "shared_invite"
}

func (u lifeUtopia) allowsSharedAt(placeID, activityID string, at time.Time) bool {
	if !u.allowsShared(placeID, activityID) {
		return false
	}
	act, _ := u.Spec.activityByID(activityID)
	return slices.Contains(act.AllowedDayparts, evalHabitatDaypart(at, u.Timezone))
}

func (u lifeUtopia) eligibleActivitiesAt(at time.Time, solitary bool) []lifeHabitatActivity {
	dp := evalHabitatDaypart(at, u.Timezone)
	var out []lifeHabitatActivity
	for _, act := range u.Spec.Activities {
		if solitary && !slices.Contains(act.PlaceIDs, habitatPersonalQuarterID) {
			continue
		}
		if !slices.Contains(act.AllowedDayparts, dp) || !evalHabitatConditions(act.When, u.ParameterValues) {
			continue
		}
		hasOpenPlace := false
		for _, pid := range act.PlaceIDs {
			if u.isPlaceOpen(pid) {
				hasOpenPlace = true
				break
			}
		}
		if hasOpenPlace {
			out = append(out, act)
		}
	}
	return out
}

func (u lifeUtopia) enrichProposal(p lifeFrameProposal) lifeFrameProposal {
	if p.Place == "" {
		return p
	}
	p.HabitatActivationID = u.HabitatActivationID
	p.HabitatID = u.Spec.HabitatID
	p.HabitatTitle = u.Spec.Title
	p.PlaceLabel = u.Spec.placeLabel(p.Place)
	if act, ok := u.Spec.activityByID(p.UtopiaActivity); ok {
		p.ActivityLabel = act.Name
	}
	return p
}

// relocatedFromForAgent computes the per-agent relocation awareness label within
// the 6-hour awareness window without mutating state before commit.
func (l *agentLifeState) relocatedFromForUtopia(u lifeUtopia, now time.Time) string {
	if l == nil {
		return ""
	}
	if !u.ActivatedAt.IsZero() && now.Sub(u.ActivatedAt) > utopiaRelocationAwarenessWindow {
		return ""
	}
	if l.LastObservedHabitatActivationID != "" {
		if l.LastObservedHabitatActivationID == u.HabitatActivationID {
			return ""
		}
		if l.LastObservedHabitatTitle != "" && l.LastObservedHabitatTitle != u.Spec.Title {
			return l.LastObservedHabitatTitle
		}
		return ""
	}
	if l.LastPlannedUtopia != nil {
		if l.LastPlannedUtopia.HabitatActivationID != "" && l.LastPlannedUtopia.HabitatActivationID != u.HabitatActivationID {
			if l.LastPlannedUtopia.HabitatTitle != "" && l.LastPlannedUtopia.HabitatTitle != u.Spec.Title {
				return l.LastPlannedUtopia.HabitatTitle
			}
		}
		if l.LastPlannedUtopia.Preset != "" {
			legacyTitle := "海风渔岛"
			if l.LastPlannedUtopia.Preset == lifePolarPreset {
				legacyTitle = "极地科考站"
			}
			if legacyTitle != u.Spec.Title {
				return legacyTitle
			}
		}
	}
	if u.LastRelocation != nil && !u.LastRelocation.RelocatedAt.IsZero() && now.Sub(u.LastRelocation.RelocatedAt) <= utopiaRelocationAwarenessWindow {
		if u.LastRelocation.FromHabitatTitle != "" && u.LastRelocation.FromHabitatTitle != u.Spec.Title {
			return u.LastRelocation.FromHabitatTitle
		}
	}
	return ""
}

type utopiaModelPlace struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Archetype string `json:"archetype"`
	Private   bool   `json:"private,omitempty"`
	Indoor    bool   `json:"indoor,omitempty"`
}

type utopiaModelActivity struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Places []string `json:"places"`
	MinM   int      `json:"minM"`
	MaxM   int      `json:"maxM"`
}

type utopiaModelScenery struct {
	Kind    string `json:"kind"`
	Label   string `json:"label"`
	PlaceID string `json:"placeId,omitempty"`
}

// The source receipt is private to Runtime; it follows the actual selected
// scenery, including when optional scenery was dropped for the byte budget.
type lifeUtopiaEventRead struct {
	EventID   string    `json:"eventId"`
	StartsAt  time.Time `json:"startsAt"`
	ExpiresAt time.Time `json:"expiresAt"`
	Custom    bool      `json:"custom"`
}

type lifeUtopiaRead struct {
	ActivationID       string                `json:"activationId"`
	ConditionsRevision uint64                `json:"conditionsRevision"`
	HabitatID          string                `json:"habitatId"`
	HabitatTitle       string                `json:"habitatTitle"`
	Events             []lifeUtopiaEventRead `json:"events,omitempty"`
}

func (read *lifeUtopiaRead) customScenery() bool {
	if read != nil {
		for _, event := range read.Events {
			if event.Custom {
				return true
			}
		}
	}
	return false
}

// Time is checked again inside the write transaction: waiting for an Agent
// lock or SQLite's serialized writer can outlive an admitted event.
func (read *lifeUtopiaRead) validAt(now time.Time) bool {
	if read != nil {
		for _, event := range read.Events {
			if now.Before(event.StartsAt) || !now.Before(event.ExpiresAt) {
				return false
			}
		}
	}
	return true
}

func (read *lifeUtopiaRead) checkCommitTime() error {
	if !read.validAt(time.Now().UTC()) {
		return errLifeUtopiaReadChanged
	}
	return nil
}

func (u lifeUtopia) acceptsRead(read *lifeUtopiaRead, now time.Time) bool {
	if read == nil {
		return true
	}
	if !read.validAt(now) || read.ActivationID != u.HabitatActivationID || read.ConditionsRevision != u.ConditionsRevision {
		return false
	}
	for _, consumed := range read.Events {
		found := false
		for _, current := range u.ActiveEvents {
			if current.EventID == consumed.EventID && current.ExpiresAt.Equal(consumed.ExpiresAt) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

type lifeUtopiaModelProjection struct {
	JSON               string
	Places, Activities []string
	Read               *lifeUtopiaRead
}

func (u lifeUtopia) modelRead(sceneryCount int) *lifeUtopiaRead {
	read := &lifeUtopiaRead{ActivationID: u.HabitatActivationID, ConditionsRevision: u.ConditionsRevision,
		HabitatID: u.Spec.HabitatID, HabitatTitle: u.Spec.Title}
	for _, event := range u.ActiveEvents[:sceneryCount] {
		read.Events = append(read.Events, lifeUtopiaEventRead{EventID: event.EventID, StartsAt: event.StartsAt,
			ExpiresAt: event.ExpiresAt, Custom: event.Slot == "custom"})
	}
	return read
}

type utopiaModelParameter struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

func (u lifeUtopia) modelParameters() []utopiaModelParameter {
	values := make([]utopiaModelParameter, 0, len(u.Spec.Parameters))
	for _, parameter := range u.Spec.Parameters {
		for _, option := range parameter.Options {
			if option.Value == u.ParameterValues[parameter.Key] {
				values = append(values, utopiaModelParameter{Name: parameter.Label, Value: option.Label})
				break
			}
		}
	}
	return values
}

type utopiaPlanningModelView struct {
	Habitat            map[string]string      `json:"habitat"`
	Parameters         []utopiaModelParameter `json:"parameters"`
	RelocatedFrom      string                 `json:"relocatedFrom,omitempty"`
	Scenery            []utopiaModelScenery   `json:"scenery,omitempty"`
	OpenPlaces         []utopiaModelPlace     `json:"openPlaces"`
	EligibleActivities []utopiaModelActivity  `json:"eligibleActivities"`
}

// The full compiled input is budgeted again by the shared context owner.
// This sub-budget preserves current parameters and at least one legal activity.
func (u lifeUtopia) compilePlanningModelJSON(solitary bool, relocatedFrom string, now time.Time) (lifeUtopiaModelProjection, error) {
	view := utopiaPlanningModelView{
		Habitat:    map[string]string{"title": u.Spec.Title, "theme": u.Spec.ThemeTag, "daypart": u.Daypart},
		Parameters: u.modelParameters(), RelocatedFrom: relocatedFrom,
		OpenPlaces:         []utopiaModelPlace{{ID: habitatPersonalQuarterID, Name: u.Spec.PersonalQuarter.Name, Archetype: "shelter", Private: true}},
		EligibleActivities: []utopiaModelActivity{},
	}
	for _, event := range u.ActiveEvents {
		item := utopiaModelScenery{Kind: event.SceneryKind, Label: event.Label}
		if event.PlaceID != nil && u.isPlaceOpen(*event.PlaceID) {
			item.PlaceID = *event.PlaceID
		}
		view.Scenery = append(view.Scenery, item)
	}
	candidates := u.eligibleActivitiesAt(now, solitary)
	sort.SliceStable(candidates, func(i, j int) bool {
		return slices.Contains(candidates[i].PlaceIDs, habitatPersonalQuarterID) && !slices.Contains(candidates[j].PlaceIDs, habitatPersonalQuarterID)
	})
	for _, activity := range candidates {
		trial := view
		trial.OpenPlaces = append([]utopiaModelPlace(nil), view.OpenPlaces...)
		var places []string
		for _, id := range activity.PlaceIDs {
			if !u.isPlaceOpen(id) || solitary && id != habitatPersonalQuarterID {
				continue
			}
			places = append(places, id)
			if slices.ContainsFunc(trial.OpenPlaces, func(p utopiaModelPlace) bool { return p.ID == id }) {
				continue
			}
			for _, p := range u.Spec.Places {
				if p.ID == id {
					trial.OpenPlaces = append(trial.OpenPlaces, utopiaModelPlace{ID: id, Name: p.Name, Archetype: p.Archetype, Indoor: p.Indoor})
					break
				}
			}
		}
		if len(places) == 0 {
			continue
		}
		trial.EligibleActivities = append(append([]utopiaModelActivity(nil), view.EligibleActivities...), utopiaModelActivity{
			ID: activity.ID, Name: activity.Name, Places: places, MinM: activity.MinDurationMinutes, MaxM: activity.MaxDurationMinutes})
		encoded, err := json.Marshal(trial)
		if err != nil {
			return lifeUtopiaModelProjection{}, err
		}
		// Only optional scenery may be pruned to admit the first fallback.
		for len(encoded) > utopiaPlanningMaxUTF8Bytes && len(view.EligibleActivities) == 0 && len(trial.Scenery) > 0 {
			trial.Scenery = trial.Scenery[:len(trial.Scenery)-1]
			encoded, _ = json.Marshal(trial)
		}
		if len(encoded) <= utopiaPlanningMaxUTF8Bytes {
			view = trial
		}
	}
	if len(view.EligibleActivities) == 0 {
		return lifeUtopiaModelProjection{}, fmt.Errorf("required habitat context exceeds planning budget")
	}
	encoded, err := json.Marshal(view)
	if err != nil {
		return lifeUtopiaModelProjection{}, err
	}
	if len(encoded) > utopiaPlanningMaxUTF8Bytes {
		return lifeUtopiaModelProjection{}, fmt.Errorf("habitat planning context exceeds budget")
	}
	result := lifeUtopiaModelProjection{JSON: string(encoded), Read: u.modelRead(len(view.Scenery))}
	for _, place := range view.OpenPlaces {
		result.Places = append(result.Places, place.ID)
	}
	for _, activity := range view.EligibleActivities {
		result.Activities = append(result.Activities, activity.ID)
	}
	return result, nil
}

func (u lifeUtopia) compileMinimalPostureJSON(l *agentLifeState, now time.Time) (lifeUtopiaModelProjection, error) {
	type sceneryBrief struct {
		Kind  string `json:"kind"`
		Label string `json:"label"`
	}
	type postureView struct {
		HabitatTitle      string                 `json:"habitatTitle"`
		Theme             string                 `json:"theme"`
		Parameters        []utopiaModelParameter `json:"parameters"`
		CurrentPlaceLabel string                 `json:"currentPlaceLabel,omitempty"`
		ActiveScenery     []sceneryBrief         `json:"activeScenery,omitempty"`
		RelocatedFrom     string                 `json:"relocatedFrom,omitempty"`
	}
	view := postureView{HabitatTitle: u.Spec.Title, Theme: u.Spec.ThemeTag, Parameters: u.modelParameters(), RelocatedFrom: l.relocatedFromForUtopia(u, now)}
	if l != nil && l.Interaction == nil && l.Current != nil && !l.Current.Invalidated && now.Before(l.Current.EndsAt) && l.Current.Place != "" {
		view.CurrentPlaceLabel = l.Current.PlaceLabel
		if view.CurrentPlaceLabel == "" {
			view.CurrentPlaceLabel = u.Spec.placeLabel(l.Current.Place)
		}
	}
	for _, event := range u.ActiveEvents {
		view.ActiveScenery = append(view.ActiveScenery, sceneryBrief{Kind: event.SceneryKind, Label: event.Label})
	}
	encoded, err := json.Marshal(view)
	if err != nil {
		return lifeUtopiaModelProjection{}, err
	}
	for len(encoded) > utopiaPostureMaxUTF8Bytes && len(view.ActiveScenery) > 0 {
		view.ActiveScenery = view.ActiveScenery[:len(view.ActiveScenery)-1]
		encoded, _ = json.Marshal(view)
	}
	if len(encoded) > utopiaPostureMaxUTF8Bytes {
		return lifeUtopiaModelProjection{}, fmt.Errorf("required habitat posture exceeds budget")
	}
	return lifeUtopiaModelProjection{JSON: string(encoded), Read: u.modelRead(len(view.ActiveScenery))}, nil
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
		settings, err := defaultLifeUtopiaSettings()
		if err != nil {
			return lifeUtopiaSettings{}, err
		}
		settings.validated = true
		settings.validatedSpec = settings.Habitat
		settings.validatedDigest = settings.ContentDigest
		settings.validatedTimezone = settings.Timezone
		settings.validatedParams = maps.Clone(settings.ParameterValues)
		return settings, nil
	}
	if err != nil {
		return lifeUtopiaSettings{}, fmt.Errorf("read Utopia settings: %w", err)
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return lifeUtopiaSettings{}, fmt.Errorf("decode Utopia settings envelope: %w", err)
	}
	_, hasSchema := probe["schemaVersion"]
	_, hasHabitat := probe["habitat"]
	if hasSchema || hasHabitat {
		var settings lifeUtopiaSettings
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&settings); err != nil {
			return lifeUtopiaSettings{}, fmt.Errorf("decode Utopia v2 settings: %w", err)
		}
		if decoder.Decode(new(any)) != io.EOF {
			return lifeUtopiaSettings{}, fmt.Errorf("unexpected trailing Utopia settings")
		}
		if settings.SchemaVersion != 2 {
			return lifeUtopiaSettings{}, fmt.Errorf("unsupported Utopia settings schemaVersion %d", settings.SchemaVersion)
		}
		if err := settings.validateCore(); err != nil {
			return lifeUtopiaSettings{}, err
		}
		return settings, nil
	}
	var legacy lifeUtopiaLegacySettingsV1
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&legacy); err != nil {
		return lifeUtopiaSettings{}, fmt.Errorf("decode legacy Utopia settings: %w", err)
	}
	if decoder.Decode(new(any)) != io.EOF {
		return lifeUtopiaSettings{}, fmt.Errorf("unexpected trailing legacy Utopia settings")
	}
	return upgradeLegacyUtopiaSettings(legacy)
}

type lifeUtopiaEventMutation struct {
	Kind            string // "trigger-preset" | "put-custom" | "clear-event"
	PresetID        string
	DurationMinutes *int
	SceneryKind     string
	Label           string
	Description     string
	PlaceID         *string
	ClearEventID    string
}

type lifeUtopiaChange struct {
	ActivateHabitat   *lifeHabitatSpec
	InitialParameters map[string]string
	Restore           bool
	ApplyParameters   map[string]string
	EventMutation     *lifeUtopiaEventMutation
	Public            *bool
	AgentRef          string
	Solitary          *bool
	Timezone          *string
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
	now := time.Now().UTC()
	previousSettings := settings
	previousSettings.Solitary = maps.Clone(settings.Solitary)
	previousUtopia, err := settings.effectiveAt(now)
	if err != nil {
		return lifeUtopiaSettings{}, err
	}

	// Opportunistically clean physically expired events during real write transactions.
	keptEvents := make([]lifeUtopiaActiveEvent, 0, len(settings.ActiveEvents))
	for _, ev := range settings.ActiveEvents {
		if now.Before(ev.ExpiresAt) {
			keptEvents = append(keptEvents, ev)
		}
	}
	settings.ActiveEvents = keptEvents
	settings.SchemaVersion = 2

	if change.Timezone != nil {
		if _, err := validateHabitatTimezone(*change.Timezone); err != nil {
			return lifeUtopiaSettings{}, fmt.Errorf("%w: %v", errLifeUtopiaInvalidChange, err)
		}
		settings.Timezone = *change.Timezone
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

	relocated := false
	if change.Restore {
		defaultSpec, digest, err := validateAndDigestHabitatSpec(builtinSeasideIslandSpec())
		if err != nil {
			return lifeUtopiaSettings{}, err
		}
		prevID, prevTitle := previousUtopia.Spec.HabitatID, previousUtopia.Spec.Title
		settings.Habitat = defaultSpec
		settings.ContentDigest = digest
		settings.ParameterValues = defaultSpec.defaultParameterValues()
		settings.ActiveEvents = nil
		if prevID != defaultSpec.HabitatID || previousUtopia.ContentDigest != digest {
			settings.HabitatActivationID = "habact_" + ulid.Make().String()
			settings.ActivatedAt = now
			if prevID != defaultSpec.HabitatID {
				relocated = true
				settings.LastRelocation = &lifeUtopiaRelocationSummary{
					FromHabitatID:    prevID,
					FromHabitatTitle: prevTitle,
					ToHabitatID:      defaultSpec.HabitatID,
					ToHabitatTitle:   defaultSpec.Title,
					RelocatedAt:      now,
				}
			}
		}
	} else if change.ActivateHabitat != nil {
		spec, digest, err := validateAndDigestHabitatSpec(*change.ActivateHabitat)
		if err != nil {
			return lifeUtopiaSettings{}, fmt.Errorf("%w: %v", errLifeUtopiaInvalidChange, err)
		}
		params, err := spec.resolveParameters(change.InitialParameters, true)
		if err != nil {
			return lifeUtopiaSettings{}, fmt.Errorf("%w: %v", errLifeUtopiaInvalidChange, err)
		}
		prevID, prevTitle := previousUtopia.Spec.HabitatID, previousUtopia.Spec.Title
		settings.Habitat = spec
		settings.ContentDigest = digest
		settings.ParameterValues = params
		if prevID != spec.HabitatID || previousUtopia.ContentDigest != digest {
			settings.HabitatActivationID = "habact_" + ulid.Make().String()
			settings.ActivatedAt = now
			settings.ActiveEvents = nil
			if prevID != spec.HabitatID {
				relocated = true
				settings.LastRelocation = &lifeUtopiaRelocationSummary{
					FromHabitatID:    prevID,
					FromHabitatTitle: prevTitle,
					ToHabitatID:      spec.HabitatID,
					ToHabitatTitle:   spec.Title,
					RelocatedAt:      now,
				}
			}
		}
	}

	if len(change.ApplyParameters) > 0 {
		if len(change.ApplyParameters) > 4 {
			return lifeUtopiaSettings{}, fmt.Errorf("%w: apply-tuning parameters exceed 4", errLifeUtopiaInvalidChange)
		}
		merged := maps.Clone(settings.ParameterValues)
		if merged == nil {
			merged = settings.Habitat.defaultParameterValues()
		}
		for k, v := range change.ApplyParameters {
			merged[k] = v
		}
		validated, err := settings.Habitat.resolveParameters(merged, true)
		if err != nil {
			return lifeUtopiaSettings{}, fmt.Errorf("%w: %v", errLifeUtopiaInvalidChange, err)
		}
		settings.ParameterValues = validated
	}

	if change.EventMutation != nil {
		mut := change.EventMutation
		switch mut.Kind {
		case "trigger-preset":
			preset, ok := settings.Habitat.eventPresetByID(mut.PresetID)
			if !ok {
				return lifeUtopiaSettings{}, fmt.Errorf("%w: unknown event preset %q", errLifeUtopiaInvalidChange, mut.PresetID)
			}
			dur := preset.DefaultDurationMinutes
			if mut.DurationMinutes != nil {
				dur = *mut.DurationMinutes
			}
			if dur < 30 || dur > 720 {
				return lifeUtopiaSettings{}, fmt.Errorf("%w: event durationMinutes %d outside 30..720", errLifeUtopiaInvalidChange, dur)
			}
			ev := lifeUtopiaActiveEvent{
				EventID:     "utopia_evt_" + ulid.Make().String(),
				Slot:        "preset",
				SceneryKind: preset.SceneryKind,
				Label:       preset.Label,
				Description: preset.Description,
				StartsAt:    now,
				ExpiresAt:   now.Add(time.Duration(dur) * time.Minute),
			}
			if preset.PlaceID != nil {
				cp := *preset.PlaceID
				ev.PlaceID = &cp
			}
			settings.ActiveEvents = upsertUtopiaEventSlot(settings.ActiveEvents, ev)
		case "put-custom":
			dur := 0
			if mut.DurationMinutes != nil {
				dur = *mut.DurationMinutes
			}
			if !validHabitatSceneryKinds[mut.SceneryKind] || !validShortNounLabel(mut.Label) || !validDisplaySummary(mut.Description) || dur < 30 || dur > 720 {
				return lifeUtopiaSettings{}, fmt.Errorf("%w: invalid custom scenery event", errLifeUtopiaInvalidChange)
			}
			var placeID *string
			if mut.PlaceID != nil && *mut.PlaceID != "" {
				found := false
				for _, p := range settings.Habitat.Places {
					if p.ID == *mut.PlaceID {
						found = true
						break
					}
				}
				if !found {
					return lifeUtopiaSettings{}, fmt.Errorf("%w: custom event references unknown public place %q", errLifeUtopiaInvalidChange, *mut.PlaceID)
				}
				cp := *mut.PlaceID
				placeID = &cp
			}
			ev := lifeUtopiaActiveEvent{
				EventID:     "utopia_evt_" + ulid.Make().String(),
				Slot:        "custom",
				SceneryKind: mut.SceneryKind,
				Label:       mut.Label,
				Description: mut.Description,
				PlaceID:     placeID,
				StartsAt:    now,
				ExpiresAt:   now.Add(time.Duration(dur) * time.Minute),
			}
			settings.ActiveEvents = upsertUtopiaEventSlot(settings.ActiveEvents, ev)
		case "clear-event":
			if !validClearEventID(mut.ClearEventID) {
				return lifeUtopiaSettings{}, fmt.Errorf("%w: invalid clear_event_id", errLifeUtopiaInvalidChange)
			}
			filtered := make([]lifeUtopiaActiveEvent, 0, len(settings.ActiveEvents))
			for _, ev := range settings.ActiveEvents {
				if ev.EventID != mut.ClearEventID {
					filtered = append(filtered, ev)
				}
			}
			settings.ActiveEvents = filtered
		default:
			return lifeUtopiaSettings{}, fmt.Errorf("%w: unknown event mutation %q", errLifeUtopiaInvalidChange, mut.Kind)
		}
	}

	if change.Public != nil {
		settings.Public = *change.Public
	}

	settings.Revision++
	settings.validated = false
	if err := settings.validateCore(); err != nil {
		return lifeUtopiaSettings{}, err
	}
	utopia, err := settings.effectiveAt(now)
	if err != nil {
		return lifeUtopiaSettings{}, err
	}
	if !utopia.sameConditions(previousUtopia) || len(change.ApplyParameters) > 0 || change.EventMutation != nil || change.Timezone != nil || relocated {
		settings.ConditionsRevision = settings.Revision
		utopia.ConditionsRevision = settings.ConditionsRevision
	}

	encoded, err := json.Marshal(settings)
	if err != nil {
		return lifeUtopiaSettings{}, fmt.Errorf("encode Utopia settings: %w", err)
	}
	decision, _ := authorizedLocalAppAgentDecision(ctx, localappop.OperationAgentUtopiaSettingsUpdate)
	shared, err := s.readLifeSharedRecords(ctx, accountID)
	if err != nil {
		return lifeUtopiaSettings{}, err
	}
	var closed []lifeSharedRecord
	changedEntries := make(map[string]*agentEntry)
	for _, record := range shared {
		if !record.ClosedAt.IsZero() {
			continue
		}
		unknownTail := record.State == "active" && record.ActiveAccountGeneration != decision.AccountGeneration
		if settled, wasNatural := s.settleNaturalSharedLifeAtLocked(accountID, previousSettings, previousUtopia, record, now, unknownTail); wasNatural {
			record = settled
		} else {
			recordActivation := record.HabitatActivationID
			sameActivation := recordActivation == utopia.HabitatActivationID || (recordActivation == "" && !relocated && utopia.HabitatActivationID == previousUtopia.HabitatActivationID)
			if sameActivation && settings.publicFor(record.Initiator) && settings.publicFor(record.Recipient) && sharedLifeConditionsAllowed(utopia, record) {
				continue
			}
			if !sameActivation {
				record = relocateSharedLife(record, now, unknownTail)
			} else {
				record = invalidateSharedLife(record, now)
			}
		}
		entries, err := s.closeSharedLifeLocked(&record, unknownTail)
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
		changed, err := entry.Life.revalidateUtopia(utopia, settings.publicFor(ref), settings.Solitary[ref], now)
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

func upsertUtopiaEventSlot(events []lifeUtopiaActiveEvent, replacement lifeUtopiaActiveEvent) []lifeUtopiaActiveEvent {
	out := make([]lifeUtopiaActiveEvent, 0, 2)
	replaced := false
	for _, ev := range events {
		if ev.Slot == replacement.Slot {
			out = append(out, replacement)
			replaced = true
		} else {
			out = append(out, ev)
		}
	}
	if !replaced {
		out = append(out, replacement)
	}
	return out
}

func validClearEventID(value string) bool {
	if len(value) < 1 || len(value) > 64 {
		return false
	}
	for i := 0; i < len(value); i++ {
		if value[i] <= 0x20 || value[i] >= 0x7f {
			return false
		}
	}
	return true
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

func (l *agentLifeState) revalidateUtopia(utopia lifeUtopia, public bool, solitary bool, now time.Time) (bool, error) {
	invalidFrame := func(frame lifeFrame, checkDaypart bool) bool {
		if frame.Place == "" {
			return false
		}
		if frame.HabitatActivationID != "" && frame.HabitatActivationID != utopia.HabitatActivationID {
			return true
		}
		if frame.HabitatID != "" && frame.HabitatID != utopia.Spec.HabitatID {
			return true
		}
		if solitary && frame.Place != habitatPersonalQuarterID {
			return true
		}
		if frame.Public && !public {
			return true
		}
		if checkDaypart {
			return !utopia.allowsAt(frame.Place, frame.UtopiaActivity, frame.StartsAt, solitary)
		}
		return !utopia.allowsPlaceAndParameters(frame.Place, frame.UtopiaActivity)
	}
	changed := false
	if l.Current != nil && now.Before(l.Current.EndsAt) && invalidFrame(*l.Current, false) {
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
		if frame.SharedRef == "" && (invalidFrame(frame, true) || frame.StartProgress > established) {
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
