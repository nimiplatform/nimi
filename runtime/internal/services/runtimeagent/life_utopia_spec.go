package runtimeagent

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	habitatSchemaVersionV1   = "1.0"
	habitatPersonalQuarterID = "personal-quarter"
	habitatSpecMaxJSONBytes  = 16384

	builtinHabitatSeasideIsland    = "nimi.builtin.seaside-island"
	builtinHabitatPolarStation     = "nimi.builtin.polar-station"
	builtinHabitatCloudBambooAbode = "nimi.builtin.cloud-bamboo-abode"

	legacyUtopiaLabelFallback = "旧版住地记录"
)

var (
	habitatNamespacedIDPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$`)
	habitatLocalSlugPattern    = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
)

var (
	validHabitatThemeTags = map[string]bool{
		"seaside":     true,
		"polar":       true,
		"xianxia":     true,
		"farming":     true,
		"woodland":    true,
		"mountain":    true,
		"harbor":      true,
		"observatory": true,
		"courtyard":   true,
		"shelter":     true,
	}
	validHabitatPlaceArchetypes = map[string]bool{
		"lookout":   true,
		"workshop":  true,
		"garden":    true,
		"waterside": true,
		"hearth":    true,
		"library":   true,
		"courtyard": true,
		"shelter":   true,
	}
	validHabitatSocialModes = map[string]bool{
		"solo":          true,
		"co_present":    true,
		"shared_invite": true,
	}
	validHabitatDayparts = map[string]bool{
		"morning": true,
		"day":     true,
		"dusk":    true,
		"night":   true,
	}
	allHabitatDayparts = []string{"morning", "day", "dusk", "night"}

	validHabitatSceneryKinds = map[string]bool{
		"clear-sky":      true,
		"rain":           true,
		"snowfall":       true,
		"mist":           true,
		"aurora":         true,
		"meteor-shower":  true,
		"blossom":        true,
		"wildlife-visit": true,
		"tide-pooling":   true,
		"harvest":        true,
		"hearth-lit":     true,
		"radio-signal":   true,
	}
)

type lifeHabitatCondition struct {
	ParameterKey  string   `json:"parameterKey"`
	AllowedValues []string `json:"allowedValues"`
}

type lifeHabitatParameterOption struct {
	Value   string `json:"value"`
	Label   string `json:"label"`
	Summary string `json:"summary"`
}

type lifeHabitatParameter struct {
	Key          string                       `json:"key"`
	Label        string                       `json:"label"`
	DefaultValue string                       `json:"defaultValue"`
	Options      []lifeHabitatParameterOption `json:"options"`
}

type lifeHabitatPersonalQuarter struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	SensoryTraits string `json:"sensoryTraits"`
}

type lifeHabitatPlace struct {
	ID            string                 `json:"id"`
	Name          string                 `json:"name"`
	Archetype     string                 `json:"archetype"`
	Indoor        bool                   `json:"indoor"`
	SensoryTraits string                 `json:"sensoryTraits"`
	OpenWhen      []lifeHabitatCondition `json:"openWhen"`
}

type lifeHabitatActivity struct {
	ID                 string                 `json:"id"`
	Name               string                 `json:"name"`
	PlaceIDs           []string               `json:"placeIds"`
	SocialMode         string                 `json:"socialMode"`
	AllowedDayparts    []string               `json:"allowedDayparts"`
	When               []lifeHabitatCondition `json:"when"`
	MinDurationMinutes int                    `json:"minDurationMinutes"`
	MaxDurationMinutes int                    `json:"maxDurationMinutes"`
	SceneHint          string                 `json:"sceneHint"`
}

type lifeHabitatEventPreset struct {
	ID                     string  `json:"id"`
	SceneryKind            string  `json:"sceneryKind"`
	Label                  string  `json:"label"`
	Description            string  `json:"description"`
	PlaceID                *string `json:"placeId"`
	DefaultDurationMinutes int     `json:"defaultDurationMinutes"`
}

// @nimi-authority: definition.nimi.runtime.agent-life.utopia
type lifeHabitatSpec struct {
	SchemaVersion   string                     `json:"schemaVersion"`
	HabitatID       string                     `json:"habitatId"`
	Title           string                     `json:"title"`
	ThemeTag        string                     `json:"themeTag"`
	BackdropSummary string                     `json:"backdropSummary"`
	PersonalQuarter lifeHabitatPersonalQuarter `json:"personalQuarter"`
	Places          []lifeHabitatPlace         `json:"places"`
	Activities      []lifeHabitatActivity      `json:"activities"`
	Parameters      []lifeHabitatParameter     `json:"parameters"`
	EventPresets    []lifeHabitatEventPreset   `json:"eventPresets"`
}

func validNamespacedID(value string) bool {
	return len(value) >= 3 && len(value) <= 64 && habitatNamespacedIDPattern.MatchString(value)
}

func validLocalSlug(value string) bool {
	return len(value) >= 1 && len(value) <= 32 && habitatLocalSlugPattern.MatchString(value)
}

func validShortNounLabel(value string) bool {
	if !utf8.ValidString(value) || strings.TrimSpace(value) == "" || strings.TrimSpace(value) != value || len(value) > 48 || utf8.RuneCountInString(value) > 16 {
		return false
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return false
		}
		switch r {
		case '.', '!', '?', '。', '！', '？', ';', '；', ':', '：', '\r', '\n', '\t', '<', '>', '[', ']', '{', '}':
			return false
		}
	}
	return true
}

func validDisplaySummary(value string) bool {
	if !utf8.ValidString(value) || strings.TrimSpace(value) != value || len(value) > 480 || utf8.RuneCountInString(value) > 120 {
		return false
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

func validBackdropProse(value string) bool {
	if !utf8.ValidString(value) || strings.TrimSpace(value) == "" || strings.TrimSpace(value) != value || len(value) > 960 || utf8.RuneCountInString(value) > 240 {
		return false
	}
	for _, r := range value {
		if (r < 0x20 && r != '\n') || r == 0x7f {
			return false
		}
	}
	return true
}

func validateHabitatTimezone(tz string) (*time.Location, error) {
	if len(tz) < 1 || len(tz) > 64 || strings.TrimSpace(tz) != tz || strings.EqualFold(tz, "Local") {
		return nil, fmt.Errorf("invalid IANA timezone %q", tz)
	}
	for i := 0; i < len(tz); i++ {
		if tz[i] <= 0x20 || tz[i] >= 0x7f {
			return nil, fmt.Errorf("invalid IANA timezone %q", tz)
		}
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, fmt.Errorf("unknown IANA timezone %q: %w", tz, err)
	}
	return loc, nil
}

func normalizeSlicesInHabitatSpec(spec lifeHabitatSpec) lifeHabitatSpec {
	out := spec
	if out.Places == nil {
		out.Places = []lifeHabitatPlace{}
	} else {
		out.Places = append([]lifeHabitatPlace(nil), out.Places...)
	}
	for i := range out.Places {
		if out.Places[i].OpenWhen == nil {
			out.Places[i].OpenWhen = []lifeHabitatCondition{}
		} else {
			conds := make([]lifeHabitatCondition, len(out.Places[i].OpenWhen))
			for j, c := range out.Places[i].OpenWhen {
				conds[j] = lifeHabitatCondition{ParameterKey: c.ParameterKey, AllowedValues: append([]string(nil), c.AllowedValues...)}
			}
			out.Places[i].OpenWhen = conds
		}
	}
	if out.Activities == nil {
		out.Activities = []lifeHabitatActivity{}
	} else {
		out.Activities = append([]lifeHabitatActivity(nil), out.Activities...)
	}
	for i := range out.Activities {
		out.Activities[i].PlaceIDs = append([]string(nil), out.Activities[i].PlaceIDs...)
		out.Activities[i].AllowedDayparts = append([]string(nil), out.Activities[i].AllowedDayparts...)
		if out.Activities[i].When == nil {
			out.Activities[i].When = []lifeHabitatCondition{}
		} else {
			conds := make([]lifeHabitatCondition, len(out.Activities[i].When))
			for j, c := range out.Activities[i].When {
				conds[j] = lifeHabitatCondition{ParameterKey: c.ParameterKey, AllowedValues: append([]string(nil), c.AllowedValues...)}
			}
			out.Activities[i].When = conds
		}
	}
	if out.Parameters == nil {
		out.Parameters = []lifeHabitatParameter{}
	} else {
		out.Parameters = append([]lifeHabitatParameter(nil), out.Parameters...)
	}
	for i := range out.Parameters {
		out.Parameters[i].Options = append([]lifeHabitatParameterOption(nil), out.Parameters[i].Options...)
	}
	if out.EventPresets == nil {
		out.EventPresets = []lifeHabitatEventPreset{}
	} else {
		presets := make([]lifeHabitatEventPreset, len(out.EventPresets))
		for i, p := range out.EventPresets {
			presets[i] = p
			if p.PlaceID != nil {
				cp := *p.PlaceID
				presets[i].PlaceID = &cp
			}
		}
		out.EventPresets = presets
	}
	return out
}

// @nimi-authority: rule.nimi.runtime.agent-life.utopia-settings
func validateAndDigestHabitatSpec(spec lifeHabitatSpec) (lifeHabitatSpec, string, error) {
	normalized := normalizeSlicesInHabitatSpec(spec)
	rawJSON, err := json.Marshal(normalized)
	if err != nil {
		return lifeHabitatSpec{}, "", fmt.Errorf("encode habitat spec: %w", err)
	}
	if len(rawJSON) > habitatSpecMaxJSONBytes {
		return lifeHabitatSpec{}, "", fmt.Errorf("habitat spec exceeds %d bytes", habitatSpecMaxJSONBytes)
	}
	if normalized.SchemaVersion != habitatSchemaVersionV1 {
		return lifeHabitatSpec{}, "", fmt.Errorf("unsupported habitat schemaVersion %q", normalized.SchemaVersion)
	}
	if !validNamespacedID(normalized.HabitatID) {
		return lifeHabitatSpec{}, "", fmt.Errorf("invalid habitatId %q", normalized.HabitatID)
	}
	if !validShortNounLabel(normalized.Title) {
		return lifeHabitatSpec{}, "", fmt.Errorf("invalid habitat title")
	}
	if !validHabitatThemeTags[normalized.ThemeTag] {
		return lifeHabitatSpec{}, "", fmt.Errorf("invalid habitat themeTag %q", normalized.ThemeTag)
	}
	if !validBackdropProse(normalized.BackdropSummary) {
		return lifeHabitatSpec{}, "", fmt.Errorf("invalid habitat backdropSummary")
	}
	if normalized.PersonalQuarter.ID != habitatPersonalQuarterID || !validShortNounLabel(normalized.PersonalQuarter.Name) || !validDisplaySummary(normalized.PersonalQuarter.SensoryTraits) {
		return lifeHabitatSpec{}, "", fmt.Errorf("invalid personalQuarter")
	}
	if len(normalized.Parameters) > 4 {
		return lifeHabitatSpec{}, "", fmt.Errorf("habitat parameters exceed 4")
	}
	paramOptions := make(map[string]map[string]bool, len(normalized.Parameters))
	for _, param := range normalized.Parameters {
		if !validLocalSlug(param.Key) || paramOptions[param.Key] != nil || !validShortNounLabel(param.Label) || len(param.Options) < 2 || len(param.Options) > 5 {
			return lifeHabitatSpec{}, "", fmt.Errorf("invalid habitat parameter %q", param.Key)
		}
		opts := make(map[string]bool, len(param.Options))
		for _, opt := range param.Options {
			if !validLocalSlug(opt.Value) || opts[opt.Value] || !validShortNounLabel(opt.Label) || !validDisplaySummary(opt.Summary) {
				return lifeHabitatSpec{}, "", fmt.Errorf("invalid option %q in parameter %q", opt.Value, param.Key)
			}
			opts[opt.Value] = true
		}
		if !opts[param.DefaultValue] {
			return lifeHabitatSpec{}, "", fmt.Errorf("parameter %q defaultValue %q is not an option", param.Key, param.DefaultValue)
		}
		paramOptions[param.Key] = opts
	}
	validateConditions := func(conds []lifeHabitatCondition) error {
		seenKeys := make(map[string]bool, len(conds))
		for _, cond := range conds {
			opts := paramOptions[cond.ParameterKey]
			if opts == nil || seenKeys[cond.ParameterKey] || len(cond.AllowedValues) == 0 {
				return fmt.Errorf("invalid parameter condition on %q", cond.ParameterKey)
			}
			seenKeys[cond.ParameterKey] = true
			seenValues := make(map[string]bool, len(cond.AllowedValues))
			for _, val := range cond.AllowedValues {
				if !opts[val] || seenValues[val] {
					return fmt.Errorf("invalid allowedValue %q on parameter %q", val, cond.ParameterKey)
				}
				seenValues[val] = true
			}
		}
		return nil
	}

	if len(normalized.Places) < 1 || len(normalized.Places) > 8 {
		return lifeHabitatSpec{}, "", fmt.Errorf("habitat places count must be 1..8")
	}
	publicPlaces := make(map[string]bool, len(normalized.Places))
	for _, place := range normalized.Places {
		if !validLocalSlug(place.ID) || place.ID == habitatPersonalQuarterID || publicPlaces[place.ID] ||
			!validShortNounLabel(place.Name) || !validHabitatPlaceArchetypes[place.Archetype] || !validDisplaySummary(place.SensoryTraits) {
			return lifeHabitatSpec{}, "", fmt.Errorf("invalid habitat place %q", place.ID)
		}
		if err := validateConditions(place.OpenWhen); err != nil {
			return lifeHabitatSpec{}, "", err
		}
		publicPlaces[place.ID] = true
	}

	if len(normalized.Activities) < 2 || len(normalized.Activities) > 24 {
		return lifeHabitatSpec{}, "", fmt.Errorf("habitat activities count must be 2..24")
	}
	seenActivities := make(map[string]bool, len(normalized.Activities))
	hasAllDayFallback := false
	for _, act := range normalized.Activities {
		if !validLocalSlug(act.ID) || seenActivities[act.ID] || !validShortNounLabel(act.Name) ||
			!validHabitatSocialModes[act.SocialMode] || !validDisplaySummary(act.SceneHint) ||
			len(act.PlaceIDs) < 1 || len(act.PlaceIDs) > 4 ||
			len(act.AllowedDayparts) < 1 || len(act.AllowedDayparts) > 4 ||
			act.MinDurationMinutes < 15 || act.MinDurationMinutes > 240 ||
			act.MaxDurationMinutes < act.MinDurationMinutes || act.MaxDurationMinutes > 240 {
			return lifeHabitatSpec{}, "", fmt.Errorf("invalid habitat activity %q", act.ID)
		}
		seenActivities[act.ID] = true
		seenPlaces := make(map[string]bool, len(act.PlaceIDs))
		usesPersonalQuarter := false
		for _, pid := range act.PlaceIDs {
			if seenPlaces[pid] {
				return lifeHabitatSpec{}, "", fmt.Errorf("duplicate placeId %q in activity %q", pid, act.ID)
			}
			if pid == habitatPersonalQuarterID {
				usesPersonalQuarter = true
			} else if !publicPlaces[pid] {
				return lifeHabitatSpec{}, "", fmt.Errorf("unknown placeId %q in activity %q", pid, act.ID)
			}
			seenPlaces[pid] = true
		}
		if usesPersonalQuarter && (len(act.PlaceIDs) != 1 || act.SocialMode != "solo") {
			return lifeHabitatSpec{}, "", fmt.Errorf("personal-quarter activity %q must be solo and exclusive to personal-quarter", act.ID)
		}
		seenDayparts := make(map[string]bool, len(act.AllowedDayparts))
		for _, dp := range act.AllowedDayparts {
			if !validHabitatDayparts[dp] || seenDayparts[dp] {
				return lifeHabitatSpec{}, "", fmt.Errorf("invalid daypart %q in activity %q", dp, act.ID)
			}
			seenDayparts[dp] = true
		}
		if err := validateConditions(act.When); err != nil {
			return lifeHabitatSpec{}, "", err
		}
		if usesPersonalQuarter && act.SocialMode == "solo" && len(act.When) == 0 && len(seenDayparts) == 4 {
			hasAllDayFallback = true
		}
	}
	if !hasAllDayFallback {
		return lifeHabitatSpec{}, "", fmt.Errorf("habitat spec must include at least one condition-free all-day solo activity on personal-quarter")
	}

	if len(normalized.EventPresets) > 8 {
		return lifeHabitatSpec{}, "", fmt.Errorf("habitat eventPresets exceed 8")
	}
	seenPresets := make(map[string]bool, len(normalized.EventPresets))
	for _, preset := range normalized.EventPresets {
		if !validLocalSlug(preset.ID) || seenPresets[preset.ID] ||
			!validHabitatSceneryKinds[preset.SceneryKind] || !validShortNounLabel(preset.Label) ||
			!validDisplaySummary(preset.Description) ||
			preset.DefaultDurationMinutes < 30 || preset.DefaultDurationMinutes > 720 {
			return lifeHabitatSpec{}, "", fmt.Errorf("invalid habitat eventPreset %q", preset.ID)
		}
		if preset.PlaceID != nil && !publicPlaces[*preset.PlaceID] {
			return lifeHabitatSpec{}, "", fmt.Errorf("eventPreset %q references unknown public place %q", preset.ID, *preset.PlaceID)
		}
		seenPresets[preset.ID] = true
	}

	canonical, err := canonicalizeSourceMaterializationJCS(normalized)
	if err != nil {
		return lifeHabitatSpec{}, "", fmt.Errorf("canonicalize habitat spec: %w", err)
	}
	if len(canonical) > habitatSpecMaxJSONBytes {
		return lifeHabitatSpec{}, "", fmt.Errorf("canonical habitat spec exceeds %d bytes", habitatSpecMaxJSONBytes)
	}
	return normalized, "sha256:" + sha256HexBytes(canonical), nil
}

func (spec lifeHabitatSpec) defaultParameterValues() map[string]string {
	values := make(map[string]string, len(spec.Parameters))
	for _, p := range spec.Parameters {
		values[p.Key] = p.DefaultValue
	}
	return values
}

func (spec lifeHabitatSpec) resolveParameters(overrides map[string]string, strict bool) (map[string]string, error) {
	resolved := spec.defaultParameterValues()
	if len(overrides) == 0 {
		return resolved, nil
	}
	optionLookup := make(map[string]map[string]bool, len(spec.Parameters))
	for _, p := range spec.Parameters {
		opts := make(map[string]bool, len(p.Options))
		for _, o := range p.Options {
			opts[o.Value] = true
		}
		optionLookup[p.Key] = opts
	}
	for k, v := range overrides {
		opts := optionLookup[k]
		if opts == nil || !opts[v] {
			if strict {
				return nil, fmt.Errorf("invalid parameter %q=%q for habitat %q", k, v, spec.HabitatID)
			}
			continue
		}
		resolved[k] = v
	}
	return resolved, nil
}

func evalHabitatConditions(conds []lifeHabitatCondition, params map[string]string) bool {
	for _, cond := range conds {
		val := params[cond.ParameterKey]
		if !slices.Contains(cond.AllowedValues, val) {
			return false
		}
	}
	return true
}

func evalHabitatDaypart(at time.Time, tz string) string {
	loc, err := time.LoadLocation(tz)
	if err != nil || tz == "" {
		loc = time.UTC
	}
	hour := at.In(loc).Hour()
	switch {
	case hour >= 5 && hour <= 10:
		return "morning"
	case hour >= 11 && hour <= 16:
		return "day"
	case hour >= 17 && hour <= 20:
		return "dusk"
	default:
		return "night"
	}
}

func (spec lifeHabitatSpec) evalOpenPlaceIDs(params map[string]string) []string {
	open := make([]string, 0, len(spec.Places))
	for _, place := range spec.Places {
		if evalHabitatConditions(place.OpenWhen, params) {
			open = append(open, place.ID)
		}
	}
	return open
}

func (spec lifeHabitatSpec) placeLabel(placeID string) string {
	if placeID == habitatPersonalQuarterID {
		return spec.PersonalQuarter.Name
	}
	for _, p := range spec.Places {
		if p.ID == placeID {
			return p.Name
		}
	}
	return ""
}

func (spec lifeHabitatSpec) activityByID(activityID string) (lifeHabitatActivity, bool) {
	for _, a := range spec.Activities {
		if a.ID == activityID {
			return a, true
		}
	}
	return lifeHabitatActivity{}, false
}

func (spec lifeHabitatSpec) eventPresetByID(presetID string) (lifeHabitatEventPreset, bool) {
	for _, p := range spec.EventPresets {
		if p.ID == presetID {
			return p, true
		}
	}
	return lifeHabitatEventPreset{}, false
}

func habitatSpecFromProto(pb *runtimev1.LocalAppUtopiaHabitatSpec) (lifeHabitatSpec, error) {
	if pb == nil || len(pb.ProtoReflect().GetUnknown()) != 0 {
		return lifeHabitatSpec{}, fmt.Errorf("habitat spec is required")
	}
	if pb.PersonalQuarter == nil || len(pb.PersonalQuarter.ProtoReflect().GetUnknown()) != 0 {
		return lifeHabitatSpec{}, fmt.Errorf("personalQuarter is required")
	}
	convertConds := func(items []*runtimev1.LocalAppUtopiaParameterCondition) ([]lifeHabitatCondition, error) {
		out := make([]lifeHabitatCondition, 0, len(items))
		for _, item := range items {
			if item == nil || len(item.ProtoReflect().GetUnknown()) != 0 {
				return nil, fmt.Errorf("invalid parameter condition")
			}
			out = append(out, lifeHabitatCondition{
				ParameterKey:  item.GetParameterKey(),
				AllowedValues: append([]string(nil), item.GetAllowedValues()...),
			})
		}
		return out, nil
	}
	places := make([]lifeHabitatPlace, 0, len(pb.GetPlaces()))
	for _, p := range pb.GetPlaces() {
		if p == nil || len(p.ProtoReflect().GetUnknown()) != 0 {
			return lifeHabitatSpec{}, fmt.Errorf("invalid place spec")
		}
		conds, err := convertConds(p.GetOpenWhen())
		if err != nil {
			return lifeHabitatSpec{}, err
		}
		places = append(places, lifeHabitatPlace{
			ID:            p.GetId(),
			Name:          p.GetName(),
			Archetype:     p.GetArchetype(),
			Indoor:        p.GetIndoor(),
			SensoryTraits: p.GetSensoryTraits(),
			OpenWhen:      conds,
		})
	}
	activities := make([]lifeHabitatActivity, 0, len(pb.GetActivities()))
	for _, a := range pb.GetActivities() {
		if a == nil || len(a.ProtoReflect().GetUnknown()) != 0 {
			return lifeHabitatSpec{}, fmt.Errorf("invalid activity spec")
		}
		conds, err := convertConds(a.GetWhen())
		if err != nil {
			return lifeHabitatSpec{}, err
		}
		activities = append(activities, lifeHabitatActivity{
			ID:                 a.GetId(),
			Name:               a.GetName(),
			PlaceIDs:           append([]string(nil), a.GetPlaceIds()...),
			SocialMode:         a.GetSocialMode(),
			AllowedDayparts:    append([]string(nil), a.GetAllowedDayparts()...),
			When:               conds,
			MinDurationMinutes: int(a.GetMinDurationMinutes()),
			MaxDurationMinutes: int(a.GetMaxDurationMinutes()),
			SceneHint:          a.GetSceneHint(),
		})
	}
	params := make([]lifeHabitatParameter, 0, len(pb.GetParameters()))
	for _, param := range pb.GetParameters() {
		if param == nil || len(param.ProtoReflect().GetUnknown()) != 0 {
			return lifeHabitatSpec{}, fmt.Errorf("invalid parameter spec")
		}
		opts := make([]lifeHabitatParameterOption, 0, len(param.GetOptions()))
		for _, opt := range param.GetOptions() {
			if opt == nil || len(opt.ProtoReflect().GetUnknown()) != 0 {
				return lifeHabitatSpec{}, fmt.Errorf("invalid parameter option")
			}
			opts = append(opts, lifeHabitatParameterOption{
				Value:   opt.GetValue(),
				Label:   opt.GetLabel(),
				Summary: opt.GetSummary(),
			})
		}
		params = append(params, lifeHabitatParameter{
			Key:          param.GetKey(),
			Label:        param.GetLabel(),
			DefaultValue: param.GetDefaultValue(),
			Options:      opts,
		})
	}
	presets := make([]lifeHabitatEventPreset, 0, len(pb.GetEventPresets()))
	for _, ep := range pb.GetEventPresets() {
		if ep == nil || len(ep.ProtoReflect().GetUnknown()) != 0 {
			return lifeHabitatSpec{}, fmt.Errorf("invalid event preset")
		}
		var placeID *string
		if ep.PlaceId != nil {
			v := ep.GetPlaceId()
			placeID = &v
		}
		presets = append(presets, lifeHabitatEventPreset{
			ID:                     ep.GetId(),
			SceneryKind:            ep.GetSceneryKind(),
			Label:                  ep.GetLabel(),
			Description:            ep.GetDescription(),
			PlaceID:                placeID,
			DefaultDurationMinutes: int(ep.GetDefaultDurationMinutes()),
		})
	}
	return lifeHabitatSpec{
		SchemaVersion:   pb.GetSchemaVersion(),
		HabitatID:       pb.GetHabitatId(),
		Title:           pb.GetTitle(),
		ThemeTag:        pb.GetThemeTag(),
		BackdropSummary: pb.GetBackdropSummary(),
		PersonalQuarter: lifeHabitatPersonalQuarter{
			ID:            pb.PersonalQuarter.GetId(),
			Name:          pb.PersonalQuarter.GetName(),
			SensoryTraits: pb.PersonalQuarter.GetSensoryTraits(),
		},
		Places:       places,
		Activities:   activities,
		Parameters:   params,
		EventPresets: presets,
	}, nil
}

func (spec lifeHabitatSpec) toProto() *runtimev1.LocalAppUtopiaHabitatSpec {
	convertConds := func(conds []lifeHabitatCondition) []*runtimev1.LocalAppUtopiaParameterCondition {
		out := make([]*runtimev1.LocalAppUtopiaParameterCondition, 0, len(conds))
		for _, c := range conds {
			out = append(out, &runtimev1.LocalAppUtopiaParameterCondition{
				ParameterKey:  c.ParameterKey,
				AllowedValues: append([]string(nil), c.AllowedValues...),
			})
		}
		return out
	}
	places := make([]*runtimev1.LocalAppUtopiaPlaceSpec, 0, len(spec.Places))
	for _, p := range spec.Places {
		places = append(places, &runtimev1.LocalAppUtopiaPlaceSpec{
			Id:            p.ID,
			Name:          p.Name,
			Archetype:     p.Archetype,
			Indoor:        p.Indoor,
			SensoryTraits: p.SensoryTraits,
			OpenWhen:      convertConds(p.OpenWhen),
		})
	}
	activities := make([]*runtimev1.LocalAppUtopiaActivitySpec, 0, len(spec.Activities))
	for _, a := range spec.Activities {
		activities = append(activities, &runtimev1.LocalAppUtopiaActivitySpec{
			Id:                 a.ID,
			Name:               a.Name,
			PlaceIds:           append([]string(nil), a.PlaceIDs...),
			SocialMode:         a.SocialMode,
			AllowedDayparts:    append([]string(nil), a.AllowedDayparts...),
			When:               convertConds(a.When),
			MinDurationMinutes: int32(a.MinDurationMinutes),
			MaxDurationMinutes: int32(a.MaxDurationMinutes),
			SceneHint:          a.SceneHint,
		})
	}
	params := make([]*runtimev1.LocalAppUtopiaParameterSpec, 0, len(spec.Parameters))
	for _, param := range spec.Parameters {
		opts := make([]*runtimev1.LocalAppUtopiaParameterOption, 0, len(param.Options))
		for _, o := range param.Options {
			opts = append(opts, &runtimev1.LocalAppUtopiaParameterOption{
				Value:   o.Value,
				Label:   o.Label,
				Summary: o.Summary,
			})
		}
		params = append(params, &runtimev1.LocalAppUtopiaParameterSpec{
			Key:          param.Key,
			Label:        param.Label,
			DefaultValue: param.DefaultValue,
			Options:      opts,
		})
	}
	presets := make([]*runtimev1.LocalAppUtopiaEventPresetSpec, 0, len(spec.EventPresets))
	for _, ep := range spec.EventPresets {
		item := &runtimev1.LocalAppUtopiaEventPresetSpec{
			Id:                     ep.ID,
			SceneryKind:            ep.SceneryKind,
			Label:                  ep.Label,
			Description:            ep.Description,
			DefaultDurationMinutes: int32(ep.DefaultDurationMinutes),
		}
		if ep.PlaceID != nil {
			v := *ep.PlaceID
			item.PlaceId = &v
		}
		presets = append(presets, item)
	}
	return &runtimev1.LocalAppUtopiaHabitatSpec{
		SchemaVersion:   spec.SchemaVersion,
		HabitatId:       spec.HabitatID,
		Title:           spec.Title,
		ThemeTag:        spec.ThemeTag,
		BackdropSummary: spec.BackdropSummary,
		PersonalQuarter: &runtimev1.LocalAppUtopiaPersonalQuarterSpec{
			Id:            spec.PersonalQuarter.ID,
			Name:          spec.PersonalQuarter.Name,
			SensoryTraits: spec.PersonalQuarter.SensoryTraits,
		},
		Places:       places,
		Activities:   activities,
		Parameters:   params,
		EventPresets: presets,
	}
}

func strPtr(v string) *string { return &v }

func builtinSeasideIslandSpec() lifeHabitatSpec {
	return lifeHabitatSpec{
		SchemaVersion:   habitatSchemaVersionV1,
		HabitatID:       builtinHabitatSeasideIsland,
		Title:           "海风渔岛",
		ThemeTag:        "seaside",
		BackdropSummary: "安静的临海小岛，木栈道连着遮蔽观鸟棚、礁石滩涂与木船工坊，海风与潮汐决定每日去处。",
		PersonalQuarter: lifeHabitatPersonalQuarter{
			ID:            habitatPersonalQuarterID,
			Name:          "海边木屋",
			SensoryTraits: "松木地板带着淡淡海盐味，窗外能听见远处规律的潮声。",
		},
		Places: []lifeHabitatPlace{
			{
				ID:            "bird-hide",
				Name:          "遮蔽观鸟棚",
				Archetype:     "lookout",
				Indoor:        true,
				SensoryTraits: "半敞木窗朝向湿地芦苇与浅湾，适合安静驻足。",
				OpenWhen:      []lifeHabitatCondition{},
			},
			{
				ID:            "tidal-reef",
				Name:          "礁石滩涂",
				Archetype:     "waterside",
				Indoor:        false,
				SensoryTraits: "退潮后露出平滑岩池与细沙浅滩。",
				OpenWhen: []lifeHabitatCondition{
					{ParameterKey: "tide", AllowedValues: []string{"low-tide"}},
					{ParameterKey: "weather", AllowedValues: []string{"sunny-breeze", "sea-mist"}},
				},
			},
			{
				ID:            "island-deck",
				Name:          "海岸木平台",
				Archetype:     "courtyard",
				Indoor:        false,
				SensoryTraits: "临海开阔甲板，摆放着木桌与防风提灯。",
				OpenWhen: []lifeHabitatCondition{
					{ParameterKey: "weather", AllowedValues: []string{"sunny-breeze", "sea-mist"}},
				},
			},
			{
				ID:            "boat-workshop",
				Name:          "木船工坊",
				Archetype:     "workshop",
				Indoor:        true,
				SensoryTraits: "干燥温暖的木梁棚屋，墙边整齐挂着刨刀、画板与渔网。",
				OpenWhen:      []lifeHabitatCondition{},
			},
		},
		Activities: []lifeHabitatActivity{
			{
				ID:                 "cabin-quiet-rest",
				Name:               "木屋读书小憩",
				PlaceIDs:           []string{habitatPersonalQuarterID},
				SocialMode:         "solo",
				AllowedDayparts:    []string{"morning", "day", "dusk", "night"},
				When:               []lifeHabitatCondition{},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 120,
				SceneHint:          "在海边木屋翻书或整理随身小物件，听窗外风声。",
			},
			{
				ID:                 "watch-birds",
				Name:               "棚内观鸟",
				PlaceIDs:           []string{"bird-hide"},
				SocialMode:         "co_present",
				AllowedDayparts:    []string{"morning", "day", "dusk", "night"},
				When:               []lifeHabitatCondition{},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 75,
				SceneHint:          "在观鸟棚木窗旁辨认掠过浅湾的海鸟与夜鹭。",
			},
			{
				ID:                 "reef-combing",
				Name:               "赶海拾贝",
				PlaceIDs:           []string{"tidal-reef"},
				SocialMode:         "shared_invite",
				AllowedDayparts:    []string{"day", "dusk"},
				When:               []lifeHabitatCondition{{ParameterKey: "tide", AllowedValues: []string{"low-tide"}}},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 90,
				SceneHint:          "趁大退潮沿着岩池寻找贝壳与海玻璃。",
			},
			{
				ID:                 "watch-waves",
				Name:               "木台听涛写生",
				PlaceIDs:           []string{"island-deck"},
				SocialMode:         "shared_invite",
				AllowedDayparts:    []string{"morning", "day", "dusk"},
				When:               []lifeHabitatCondition{{ParameterKey: "weather", AllowedValues: []string{"sunny-breeze", "sea-mist"}}},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 90,
				SceneHint:          "在海岸木平台凭栏看浪或速写海平面。",
			},
			{
				ID:                 "mend-gear",
				Name:               "合力修整渔具",
				PlaceIDs:           []string{"boat-workshop"},
				SocialMode:         "shared_invite",
				AllowedDayparts:    []string{"morning", "day", "dusk", "night"},
				When:               []lifeHabitatCondition{},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 90,
				SceneHint:          "在木船工坊灯下打磨木浆、修补浮标或整理画稿。",
			},
		},
		Parameters: []lifeHabitatParameter{
			{
				Key:          "weather",
				Label:        "海岛天气",
				DefaultValue: "sunny-breeze",
				Options: []lifeHabitatParameterOption{
					{Value: "sunny-breeze", Label: "晴风", Summary: "海面清朗，微风拂过栈道与木台。"},
					{Value: "sea-mist", Label: "海雾", Summary: "薄雾拢着远礁，光线柔和安静。"},
					{Value: "rain", Label: "阵雨", Summary: "海雨敲打屋檐，露天滩涂与木台暂时收起。"},
				},
			},
			{
				Key:          "tide",
				Label:        "潮汐水位",
				DefaultValue: "low-tide",
				Options: []lifeHabitatParameterOption{
					{Value: "high-tide", Label: "涨潮", Summary: "海水漫过低处礁盘，拍岸声清晰。"},
					{Value: "low-tide", Label: "大退潮", Summary: "礁石滩涂完整显露，可以缓步赶海。"},
				},
			},
		},
		EventPresets: []lifeHabitatEventPreset{
			{
				ID:                     "sea-glass",
				SceneryKind:            "tide-pooling",
				Label:                  "礁石留着海玻璃",
				Description:            "退潮后的岩池边缘散落着被海浪磨圆的透亮海玻璃。",
				PlaceID:                strPtr("tidal-reef"),
				DefaultDurationMinutes: 180,
			},
			{
				ID:                     "dolphin-pod",
				SceneryKind:            "wildlife-visit",
				Label:                  "远海有海豚跃过",
				Description:            "几道银灰背鳍顺着暖流掠过外湾水面。",
				PlaceID:                strPtr("island-deck"),
				DefaultDurationMinutes: 120,
			},
		},
	}
}

func builtinPolarStationSpec() lifeHabitatSpec {
	return lifeHabitatSpec{
		SchemaVersion:   habitatSchemaVersionV1,
		HabitatID:       builtinHabitatPolarStation,
		Title:           "极地科考站",
		ThemeTag:        "polar",
		BackdropSummary: "冰脊雪原上的多舱段暖光科考聚落，防风木栈桥串联室外气象台、雪橇补给坪、冰芯样本库、双层玻璃穹顶、地热暖炉厅与极夜电台室。",
		PersonalQuarter: lifeHabitatPersonalQuarter{
			ID:            habitatPersonalQuarterID,
			Name:          "保温个人舱",
			SensoryTraits: "高脚恒温圆顶舱室，舷窗凝着细霜，床畔亮着柔和琥珀阅读灯。",
		},
		Places: []lifeHabitatPlace{
			{
				ID:            "weather-deck",
				Name:          "室外气象台",
				Archetype:     "lookout",
				Indoor:        false,
				SensoryTraits: "架在西侧冰脊上的防滑钢栈桥、风向袋与风速仪。",
				OpenWhen: []lifeHabitatCondition{
					{ParameterKey: "weather", AllowedValues: []string{"crisp-clear"}},
				},
			},
			{
				ID:            "rover-apron",
				Name:          "雪橇补给坪",
				Archetype:     "workshop",
				Indoor:        false,
				SensoryTraits: "停靠橙色履带雪地车与木制物资箱的开阔雪坪。",
				OpenWhen: []lifeHabitatCondition{
					{ParameterKey: "weather", AllowedValues: []string{"crisp-clear"}},
				},
			},
			{
				ID:            "ice-core-vault",
				Name:          "冰芯样本库",
				Archetype:     "library",
				Indoor:        true,
				SensoryTraits: "半嵌冰岩的恒低温拱廊，透出清澈冰蓝色观测冷光。",
				OpenWhen:      []lifeHabitatCondition{},
			},
			{
				ID:            "observation-window",
				Name:          "全景观测窗",
				Archetype:     "lookout",
				Indoor:        true,
				SensoryTraits: "山脊高处的暖光几何玻璃穹顶，配有望远镜与软垫躺椅。",
				OpenWhen:      []lifeHabitatCondition{},
			},
			{
				ID:            "hydro-garden",
				Name:          "水培温室",
				Archetype:     "garden",
				Indoor:        true,
				SensoryTraits: "湿润温暖的球形植物温室，藤蔓翠绿、蔬果清香。",
				OpenWhen:      []lifeHabitatCondition{},
			},
			{
				ID:            "geothermal-hearth",
				Name:          "地热暖炉厅",
				Archetype:     "hearth",
				Indoor:        true,
				SensoryTraits: "紧邻露天温泉眼的松木尖顶木屋，壁炉松柴噼啪作响。",
				OpenWhen:      []lifeHabitatCondition{},
			},
			{
				ID:            "radio-comms-room",
				Name:          "极夜电台室",
				Archetype:     "workshop",
				Indoor:        true,
				SensoryTraits: "红白通信塔下的安静木舱，电子管电台闪烁着温暖绿光。",
				OpenWhen:      []lifeHabitatCondition{},
			},
			{
				ID:            "common-lab",
				Name:          "公共工作间",
				Archetype:     "workshop",
				Indoor:        true,
				SensoryTraits: "挂满极地海图与地质剖面图的宽敞长桌研究室。",
				OpenWhen:      []lifeHabitatCondition{},
			},
		},
		Activities: []lifeHabitatActivity{
			{
				ID:                 "bunk-quiet-rest",
				Name:               "舱内整理休息",
				PlaceIDs:           []string{habitatPersonalQuarterID},
				SocialMode:         "solo",
				AllowedDayparts:    []string{"morning", "day", "dusk", "night"},
				When:               []lifeHabitatCondition{},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 120,
				SceneHint:          "在保温个人舱阅读笔记或静静小憩。",
			},
			{
				ID:                 "wind-reading",
				Name:               "室外测风记录",
				PlaceIDs:           []string{"weather-deck"},
				SocialMode:         "co_present",
				AllowedDayparts:    []string{"morning", "day", "dusk"},
				When:               []lifeHabitatCondition{{ParameterKey: "weather", AllowedValues: []string{"crisp-clear"}}},
				MinDurationMinutes: 15,
				MaxDurationMinutes: 60,
				SceneHint:          "趁晴冷无暴雪登上室外气象台校准风速读数。",
			},
			{
				ID:                 "rover-gear-check",
				Name:               "清点雪车补给",
				PlaceIDs:           []string{"rover-apron"},
				SocialMode:         "co_present",
				AllowedDayparts:    []string{"morning", "day"},
				When:               []lifeHabitatCondition{{ParameterKey: "weather", AllowedValues: []string{"crisp-clear"}}},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 70,
				SceneHint:          "在雪橇补给坪检查履带雪地车与防寒装备箱。",
			},
			{
				ID:                 "ice-core-catalog",
				Name:               "描摹冰芯年轮",
				PlaceIDs:           []string{"ice-core-vault"},
				SocialMode:         "co_present",
				AllowedDayparts:    []string{"morning", "day", "dusk"},
				When:               []lifeHabitatCondition{},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 75,
				SceneHint:          "在冰芯样本库记录远古气泡层序。",
			},
			{
				ID:                 "observe-snow",
				Name:               "并肩看雪观极光",
				PlaceIDs:           []string{"observation-window"},
				SocialMode:         "shared_invite",
				AllowedDayparts:    []string{"morning", "day", "dusk", "night"},
				When:               []lifeHabitatCondition{},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 90,
				SceneHint:          "在全景观测窗穹顶下捧着热茶仰望雪峰与极光。",
			},
			{
				ID:                 "tend-seedlings",
				Name:               "照料温室幼苗",
				PlaceIDs:           []string{"hydro-garden"},
				SocialMode:         "shared_invite",
				AllowedDayparts:    []string{"morning", "day", "dusk"},
				When:               []lifeHabitatCondition{},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 75,
				SceneHint:          "在水培温室修剪番茄藤叶、记录营养液温度。",
			},
			{
				ID:                 "hearth-cocoa-chat",
				Name:               "暖炉热可可夜话",
				PlaceIDs:           []string{"geothermal-hearth"},
				SocialMode:         "shared_invite",
				AllowedDayparts:    []string{"dusk", "night"},
				When:               []lifeHabitatCondition{},
				MinDurationMinutes: 25,
				MaxDurationMinutes: 95,
				SceneHint:          "在地热暖炉厅围坐壁炉旁分享热可可与旅途见闻。",
			},
			{
				ID:                 "night-radio-watch",
				Name:               "守听极夜短波",
				PlaceIDs:           []string{"radio-comms-room"},
				SocialMode:         "co_present",
				AllowedDayparts:    []string{"dusk", "night"},
				When:               []lifeHabitatCondition{},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 80,
				SceneHint:          "在极夜电台室调谐短波频率，抄收远洋船队问候。",
			},
			{
				ID:                 "log-review",
				Name:               "核对科考海图",
				PlaceIDs:           []string{"common-lab"},
				SocialMode:         "co_present",
				AllowedDayparts:    []string{"morning", "day", "dusk", "night"},
				When:               []lifeHabitatCondition{},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 90,
				SceneHint:          "在公共工作间长桌旁整理地形卡片与观测图表。",
			},
		},
		Parameters: []lifeHabitatParameter{
			{
				Key:          "weather",
				Label:        "站外气象",
				DefaultValue: "crisp-clear",
				Options: []lifeHabitatParameterOption{
					{Value: "crisp-clear", Label: "晴冷", Summary: "冰原视野通透，室外气象台与雪橇补给坪安全开放。"},
					{Value: "blizzard", Label: "暴风雪", Summary: "风雪呼啸封锁外坪，全员留在温暖室内舱段活动。"},
				},
			},
			{
				Key:          "sky-phenomenon",
				Label:        "极夜天象",
				DefaultValue: "quiet-sky",
				Options: []lifeHabitatParameterOption{
					{Value: "quiet-sky", Label: "静谧夜空", Summary: "清澈深蓝星幕映着冰脊微光。"},
					{Value: "aurora-band", Label: "极光带", Summary: "翠绿与淡紫光幕在雪峰上空缓缓流动。"},
				},
			},
		},
		EventPresets: []lifeHabitatEventPreset{
			{
				ID:                     "first-tomato",
				SceneryKind:            "harvest",
				Label:                  "温室番茄结果了",
				Description:            "水培温室第一串红透的小番茄挂上藤蔓。",
				PlaceID:                strPtr("hydro-garden"),
				DefaultDurationMinutes: 240,
			},
			{
				ID:                     "shortwave-music",
				SceneryKind:            "radio-signal",
				Label:                  "电台飘来古典乐",
				Description:            "极夜电台室清晰收到一段温暖的大提琴广播。",
				PlaceID:                strPtr("radio-comms-room"),
				DefaultDurationMinutes: 120,
			},
			{
				ID:                     "hearth-soup-pot",
				SceneryKind:            "hearth-lit",
				Label:                  "暖炉炖上奶油浓汤",
				Description:            "地热暖炉厅铜锅咕嘟冒泡，满屋弥漫烤面包与浓汤香。",
				PlaceID:                strPtr("geothermal-hearth"),
				DefaultDurationMinutes: 150,
			},
		},
	}
}

func builtinCloudBambooAbodeSpec() lifeHabitatSpec {
	return lifeHabitatSpec{
		SchemaVersion:   habitatSchemaVersionV1,
		HabitatID:       builtinHabitatCloudBambooAbode,
		Title:           "云水山居",
		ThemeTag:        "xianxia",
		BackdropSummary: "云海竹林环抱的青绿水墨洞天，青石阶与曲水拱桥串联观云剑坪、松风晨钟台、飞瀑听泉亭、灵草药圃、暖火丹房与藏经茶阁。",
		PersonalQuarter: lifeHabitatPersonalQuarter{
			ID:            habitatPersonalQuarterID,
			Name:          "青竹静室",
			SensoryTraits: "翠竹掩映素纸窗棂，室内清幽安宁，案头温着一盏清茶。",
		},
		Places: []lifeHabitatPlace{
			{
				ID:            "cloud-terrace",
				Name:          "观云剑坪",
				Archetype:     "lookout",
				Indoor:        false,
				SensoryTraits: "古松临崖的圆石平台，四周云涛翻涌，山风清冽。",
				OpenWhen: []lifeHabitatCondition{
					{ParameterKey: "weather", AllowedValues: []string{"clear-mist", "auspicious-snow"}},
					{ParameterKey: "mountain-array", AllowedValues: []string{"normal"}},
				},
			},
			{
				ID:            "pine-bell-platform",
				Name:          "松风晨钟台",
				Archetype:     "lookout",
				Indoor:        false,
				SensoryTraits: "山门牌坊旁的青铜古钟亭，钟声悠远涤荡山岚。",
				OpenWhen: []lifeHabitatCondition{
					{ParameterKey: "mountain-array", AllowedValues: []string{"normal"}},
				},
			},
			{
				ID:            "waterfall-pavilion",
				Name:          "飞瀑听泉亭",
				Archetype:     "waterside",
				Indoor:        false,
				SensoryTraits: "临近银练飞瀑的六角木亭，水雾清凉沁人。",
				OpenWhen: []lifeHabitatCondition{
					{ParameterKey: "mountain-array", AllowedValues: []string{"normal"}},
				},
			},
			{
				ID:            "herb-terrace",
				Name:          "灵草药圃",
				Archetype:     "garden",
				Indoor:        false,
				SensoryTraits: "竹笕引泉灌溉的层叠药畦，弥漫清润草木香。",
				OpenWhen: []lifeHabitatCondition{
					{ParameterKey: "mountain-array", AllowedValues: []string{"normal"}},
				},
			},
			{
				ID:            "elixir-hearth",
				Name:          "暖火丹房",
				Archetype:     "hearth",
				Indoor:        true,
				SensoryTraits: "中庭铜鼎松炭恒温不熄，药香混着焙茶暖意。",
				OpenWhen:      []lifeHabitatCondition{},
			},
			{
				ID:            "bamboo-cloister",
				Name:          "曲水竹廊院",
				Archetype:     "waterside",
				Indoor:        true,
				SensoryTraits: "折廊凌波映着荷叶粉莲，凭栏可听雨打青瓦。",
				OpenWhen:      []lifeHabitatCondition{},
			},
			{
				ID:            "craft-scroll-hall",
				Name:          "鲁班木艺坊",
				Archetype:     "workshop",
				Indoor:        true,
				SensoryTraits: "敞轩内陈列彩绘油纸伞、墨竹画卷与木作案几。",
				OpenWhen:      []lifeHabitatCondition{},
			},
			{
				ID:            "tea-pavilion",
				Name:          "藏经茶阁",
				Archetype:     "library",
				Indoor:        true,
				SensoryTraits: "双层木楼珍藏古卷棋枰，檐下悬着避风宫灯。",
				OpenWhen:      []lifeHabitatCondition{},
			},
		},
		Activities: []lifeHabitatActivity{
			{
				ID:                 "quiet-reading",
				Name:               "静室读书调息",
				PlaceIDs:           []string{habitatPersonalQuarterID},
				SocialMode:         "solo",
				AllowedDayparts:    []string{"morning", "day", "dusk", "night"},
				When:               []lifeHabitatCondition{},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 120,
				SceneHint:          "在青竹静室静坐翻卷，听窗外竹叶轻响。",
			},
			{
				ID:                 "terrace-cloud-watch",
				Name:               "临崖晨练观云",
				PlaceIDs:           []string{"cloud-terrace", "pine-bell-platform"},
				SocialMode:         "co_present",
				AllowedDayparts:    []string{"morning", "day", "dusk"},
				When:               []lifeHabitatCondition{{ParameterKey: "mountain-array", AllowedValues: []string{"normal"}}},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 75,
				SceneHint:          "在观云剑坪或晨钟台远眺峰间云海。",
			},
			{
				ID:                 "waterfall-tea-listen",
				Name:               "飞瀑亭畔听泉",
				PlaceIDs:           []string{"waterfall-pavilion"},
				SocialMode:         "shared_invite",
				AllowedDayparts:    []string{"morning", "day", "dusk"},
				When:               []lifeHabitatCondition{{ParameterKey: "mountain-array", AllowedValues: []string{"normal"}}},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 75,
				SceneHint:          "在飞瀑听泉亭凭栏赏潭，闲谈山中风物。",
			},
			{
				ID:                 "water-herbs",
				Name:               "药圃引泉浇灌",
				PlaceIDs:           []string{"herb-terrace"},
				SocialMode:         "co_present",
				AllowedDayparts:    []string{"morning", "day"},
				When:               []lifeHabitatCondition{{ParameterKey: "mountain-array", AllowedValues: []string{"normal"}}},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 75,
				SceneHint:          "引清泉竹笕润泽灵草新芽。",
			},
			{
				ID:                 "tend-hearth-tea",
				Name:               "丹房看火煮茶",
				PlaceIDs:           []string{"elixir-hearth"},
				SocialMode:         "shared_invite",
				AllowedDayparts:    []string{"morning", "day", "dusk", "night"},
				When:               []lifeHabitatCondition{},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 90,
				SceneHint:          "在暖火丹房围炉焙茶，看松炭微红。",
			},
			{
				ID:                 "cloister-lotus-stroll",
				Name:               "竹廊凭栏赏荷",
				PlaceIDs:           []string{"bamboo-cloister"},
				SocialMode:         "co_present",
				AllowedDayparts:    []string{"morning", "day", "dusk", "night"},
				When:               []lifeHabitatCondition{},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 80,
				SceneHint:          "在曲水竹廊院慢步赏莲，听溪水穿桥。",
			},
			{
				ID:                 "umbrella-scroll-craft",
				Name:               "彩绘纸伞题卷",
				PlaceIDs:           []string{"craft-scroll-hall"},
				SocialMode:         "co_present",
				AllowedDayparts:    []string{"day", "dusk"},
				When:               []lifeHabitatCondition{},
				MinDurationMinutes: 25,
				MaxDurationMinutes: 85,
				SceneHint:          "在鲁班木艺坊描绘油纸伞面或装裱山水小品。",
			},
			{
				ID:                 "pavilion-board-talk",
				Name:               "茶阁对弈夜话",
				PlaceIDs:           []string{"tea-pavilion"},
				SocialMode:         "shared_invite",
				AllowedDayparts:    []string{"day", "dusk", "night"},
				When:               []lifeHabitatCondition{},
				MinDurationMinutes: 20,
				MaxDurationMinutes: 90,
				SceneHint:          "在藏经茶阁灯下摆棋翻卷，闲话日常。",
			},
		},
		Parameters: []lifeHabitatParameter{
			{
				Key:          "weather",
				Label:        "山间天象",
				DefaultValue: "clear-mist",
				Options: []lifeHabitatParameterOption{
					{Value: "clear-mist", Label: "晴岚", Summary: "山间清朗微岚，云海平铺于剑坪之下。"},
					{Value: "mountain-rain", Label: "山雨", Summary: "细雨穿过竹林石阶，宜在竹廊与阁内听雨。"},
					{Value: "auspicious-snow", Label: "瑞雪", Summary: "轻雪落满松枝青瓦，丹房炭火更显温暖。"},
				},
			},
			{
				Key:          "mountain-array",
				Label:        "山门云阵",
				DefaultValue: "normal",
				Options: []lifeHabitatParameterOption{
					{Value: "normal", Label: "云开常态", Summary: "云径畅通，外坪飞瀑与药圃皆可自由往来。"},
					{Value: "secluded", Label: "护山静息", Summary: "云雾合拢护院，众人皆在室内廊阁静修叙话。"},
				},
			},
		},
		EventPresets: []lifeHabitatEventPreset{
			{
				ID:                     "white-blossom",
				SceneryKind:            "blossom",
				Label:                  "后山古树落白花",
				Description:            "山风拂过古木，细白花瓣顺着云阶飘落药圃庭前。",
				PlaceID:                strPtr("herb-terrace"),
				DefaultDurationMinutes: 240,
			},
			{
				ID:                     "terrace-meteors",
				SceneryKind:            "meteor-shower",
				Label:                  "观云坪流萤星雨",
				Description:            "清夜云海之上掠过成串澄澈星痕。",
				PlaceID:                strPtr("cloud-terrace"),
				DefaultDurationMinutes: 180,
			},
			{
				ID:                     "cloister-lotus-lantern",
				SceneryKind:            "hearth-lit",
				Label:                  "竹廊荷池放河灯",
				Description:            "曲水竹廊下的碧荷间漂起盏盏暖黄纸莲灯。",
				PlaceID:                strPtr("bamboo-cloister"),
				DefaultDurationMinutes: 150,
			},
		},
	}
}

func builtinHabitatSpecByID(id string) (lifeHabitatSpec, bool) {
	switch id {
	case builtinHabitatSeasideIsland:
		return builtinSeasideIslandSpec(), true
	case builtinHabitatPolarStation:
		return builtinPolarStationSpec(), true
	case builtinHabitatCloudBambooAbode:
		return builtinCloudBambooAbodeSpec(), true
	default:
		return lifeHabitatSpec{}, false
	}
}
