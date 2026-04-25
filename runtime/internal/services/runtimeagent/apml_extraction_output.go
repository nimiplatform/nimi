package runtimeagent

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type apmlBehavioralPosture struct {
	PostureClass     string   `xml:"posture-class"`
	ActionFamily     string   `xml:"action-family"`
	InterruptMode    string   `xml:"interrupt-mode"`
	TransitionReason string   `xml:"transition-reason"`
	TruthBasisIDs    []string `xml:"truth-basis-id"`
	StatusText       string   `xml:"status-text"`
}

type apmlMemoryCandidate struct {
	CanonicalClass string             `xml:"canonical-class,attr"`
	PolicyReason   string             `xml:"policy-reason,attr"`
	Episodic       *apmlEpisodic      `xml:"episodic"`
	Semantic       *apmlSemantic      `xml:"semantic"`
	Observational  *apmlObservational `xml:"observational"`
}

type apmlEpisodic struct {
	Summary      string   `xml:"summary"`
	OccurredAt   string   `xml:"occurred-at"`
	Participants []string `xml:"participant"`
}

type apmlSemantic struct {
	Subject    string  `xml:"subject"`
	Predicate  string  `xml:"predicate"`
	Object     string  `xml:"object"`
	Confidence float64 `xml:"confidence"`
}

type apmlObservational struct {
	Observation string `xml:"observation"`
	ObservedAt  string `xml:"observed-at"`
	SourceRef   string `xml:"source-ref"`
}

type apmlHookIntent struct {
	IntentID      string `xml:"id,attr"`
	TriggerFamily string `xml:"trigger-family,attr"`
	Effect        string `xml:"effect,attr"`
	Reason        string `xml:"reason,attr"`
	Time          *struct {
		Delay   string `xml:"delay,attr"`
		DelayMs string `xml:"delay-ms,attr"`
	} `xml:"time"`
	EventUserIdle *struct {
		IdleFor   string `xml:"idle-for,attr"`
		IdleForMs string `xml:"idle-for-ms,attr"`
	} `xml:"event-user-idle"`
	EventChatEnded *struct{} `xml:"event-chat-ended"`
}

type lifeTurnExecutorAPML struct {
	XMLName                   xml.Name               `xml:"life-turn"`
	BehavioralPosture         *apmlBehavioralPosture `xml:"behavioral-posture"`
	StatusText                *string                `xml:"status-text"`
	Summary                   string                 `xml:"summary"`
	TokensUsed                *int64                 `xml:"tokens-used"`
	CanonicalMemoryCandidates []apmlMemoryCandidate  `xml:"canonical-memory-candidates>candidate"`
	NextHookIntent            *apmlHookIntent        `xml:"next-hook-intent"`
}

type chatTrackSidecarExecutorAPML struct {
	XMLName                   xml.Name               `xml:"chat-track-sidecar"`
	BehavioralPosture         *apmlBehavioralPosture `xml:"behavioral-posture"`
	CancelPendingHookIDs      []string               `xml:"cancel-pending-hook-id"`
	CanonicalMemoryCandidates []apmlMemoryCandidate  `xml:"canonical-memory-candidates>candidate"`
	NextHookIntent            *apmlHookIntent        `xml:"next-hook-intent"`
}

type canonicalReviewExecutorAPML struct {
	XMLName    xml.Name                       `xml:"canonical-review"`
	Summary    string                         `xml:"summary"`
	TokensUsed *int64                         `xml:"tokens-used"`
	Narratives []canonicalReviewAPMLNarrative `xml:"narratives>narrative"`
	Truths     []canonicalReviewAPMLTruth     `xml:"truths>truth"`
	Relations  []canonicalReviewAPMLRelation  `xml:"relations>relation"`
}

type canonicalReviewAPMLNarrative struct {
	NarrativeID     string   `xml:"id,attr"`
	Topic           string   `xml:"topic,attr"`
	SourceVersion   string   `xml:"source-version,attr"`
	Status          string   `xml:"status,attr"`
	Content         string   `xml:"content"`
	SourceMemoryIDs []string `xml:"source-memory-id"`
}

type canonicalReviewAPMLTruth struct {
	TruthID           string   `xml:"id,attr"`
	Dimension         string   `xml:"dimension,attr"`
	NormalizedKey     string   `xml:"normalized-key,attr"`
	Confidence        float64  `xml:"confidence,attr"`
	SourceCount       *int32   `xml:"source-count,attr"`
	ReviewCount       *int32   `xml:"review-count,attr"`
	FirstReviewAt     string   `xml:"first-review-at,attr"`
	LastReviewAt      string   `xml:"last-review-at,attr"`
	Status            string   `xml:"status,attr"`
	SupersedesTruthID string   `xml:"supersedes-truth-id,attr"`
	Statement         string   `xml:"statement"`
	SourceMemoryIDs   []string `xml:"source-memory-id"`
}

type canonicalReviewAPMLRelation struct {
	RelationID   string  `xml:"id,attr"`
	SourceID     string  `xml:"source-id,attr"`
	TargetID     string  `xml:"target-id,attr"`
	RelationType string  `xml:"relation-type,attr"`
	Confidence   float64 `xml:"confidence,attr"`
}

func decodeStrictAPML(raw string, rootName string, out any) error {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fmt.Errorf("APML output is required")
	}
	if !startsWithAPMLRoot(trimmed, rootName) {
		return fmt.Errorf("APML output must begin with <%s>", rootName)
	}
	if err := validateAPMLAllowedShape(trimmed, rootName); err != nil {
		return err
	}
	decoder := xml.NewDecoder(bytes.NewBufferString(trimmed))
	decoder.Strict = false
	if err := decoder.Decode(out); err != nil {
		return fmt.Errorf("APML output invalid: %w", err)
	}
	for {
		token, err := decoder.Token()
		if errorsIsEOF(err) {
			break
		}
		if err != nil {
			return fmt.Errorf("APML output invalid: %w", err)
		}
		if chars, ok := token.(xml.CharData); ok && strings.TrimSpace(string(chars)) == "" {
			continue
		}
		return fmt.Errorf("APML output must contain exactly one <%s> root", rootName)
	}
	return nil
}

func startsWithAPMLRoot(trimmed string, rootName string) bool {
	prefix := "<" + rootName
	if !strings.HasPrefix(trimmed, prefix) {
		return false
	}
	if len(trimmed) == len(prefix) {
		return false
	}
	switch trimmed[len(prefix)] {
	case ' ', '\t', '\n', '\r', '>', '/':
		return true
	default:
		return false
	}
}

func validateAPMLAllowedShape(raw string, rootName string) error {
	allowedTags, allowedAttrs, allowedChildren, textTags, ok := allowedAPMLShape(rootName)
	if !ok {
		return fmt.Errorf("APML root <%s> is not admitted", rootName)
	}
	decoder := xml.NewDecoder(bytes.NewBufferString(raw))
	decoder.Strict = false
	stack := make([]string, 0, 8)
	for {
		token, err := decoder.Token()
		if errorsIsEOF(err) {
			if len(stack) != 0 {
				return fmt.Errorf("APML output invalid: unclosed <%s> tag", stack[len(stack)-1])
			}
			return nil
		}
		if err != nil {
			return fmt.Errorf("APML output invalid: %w", err)
		}
		switch item := token.(type) {
		case xml.StartElement:
			if strings.TrimSpace(item.Name.Space) != "" {
				return fmt.Errorf("APML output must not use XML namespaces")
			}
			tag := item.Name.Local
			if _, ok := allowedTags[tag]; !ok {
				return fmt.Errorf("APML output contains unsupported <%s> tag", tag)
			}
			if len(stack) == 0 {
				if tag != rootName {
					return fmt.Errorf("APML output must begin with <%s>", rootName)
				}
			} else {
				parent := stack[len(stack)-1]
				if _, ok := allowedChildren[parent][tag]; !ok {
					return fmt.Errorf("APML output contains <%s> in unsupported <%s> context", tag, parent)
				}
			}
			tagAttrs := allowedAttrs[tag]
			seenAttrs := make(map[string]struct{}, len(item.Attr))
			for _, attr := range item.Attr {
				if strings.TrimSpace(attr.Name.Space) != "" {
					return fmt.Errorf("APML output must not use XML namespaced attributes")
				}
				if _, ok := seenAttrs[attr.Name.Local]; ok {
					return fmt.Errorf("APML output contains duplicate %s attribute on <%s>", attr.Name.Local, tag)
				}
				seenAttrs[attr.Name.Local] = struct{}{}
				if _, ok := tagAttrs[attr.Name.Local]; !ok {
					return fmt.Errorf("APML output contains unsupported %s attribute on <%s>", attr.Name.Local, tag)
				}
			}
			stack = append(stack, tag)
		case xml.EndElement:
			if len(stack) == 0 {
				return fmt.Errorf("APML output invalid: unexpected closing </%s>", item.Name.Local)
			}
			current := stack[len(stack)-1]
			if item.Name.Local != current {
				return fmt.Errorf("APML output invalid: closing </%s> does not match <%s>", item.Name.Local, current)
			}
			stack = stack[:len(stack)-1]
		case xml.CharData:
			if strings.TrimSpace(string(item)) == "" {
				continue
			}
			if len(stack) == 0 {
				return fmt.Errorf("APML output must contain exactly one <%s> root", rootName)
			}
			current := stack[len(stack)-1]
			if _, ok := textTags[current]; !ok {
				return fmt.Errorf("APML output contains text in unsupported <%s> context", current)
			}
		case xml.Comment:
			return fmt.Errorf("APML output must not contain comments")
		case xml.ProcInst, xml.Directive:
			return fmt.Errorf("APML output must not contain processing instructions or directives")
		}
	}
}

func allowedAPMLShape(rootName string) (map[string]struct{}, map[string]map[string]struct{}, map[string]map[string]struct{}, map[string]struct{}, bool) {
	noAttrs := map[string]struct{}{}
	commonTags := map[string]struct{}{
		"behavioral-posture":          {},
		"posture-class":               {},
		"action-family":               {},
		"interrupt-mode":              {},
		"transition-reason":           {},
		"truth-basis-id":              {},
		"status-text":                 {},
		"summary":                     {},
		"tokens-used":                 {},
		"canonical-memory-candidates": {},
		"candidate":                   {},
		"episodic":                    {},
		"semantic":                    {},
		"observational":               {},
		"occurred-at":                 {},
		"participant":                 {},
		"subject":                     {},
		"predicate":                   {},
		"object":                      {},
		"confidence":                  {},
		"observation":                 {},
		"observed-at":                 {},
		"source-ref":                  {},
		"next-hook-intent":            {},
		"time":                        {},
		"event-user-idle":             {},
		"event-chat-ended":            {},
	}
	commonAttrs := map[string]map[string]struct{}{
		"candidate":        {"canonical-class": {}, "policy-reason": {}},
		"next-hook-intent": {"id": {}, "trigger-family": {}, "effect": {}, "reason": {}},
		"time":             {"delay": {}, "delay-ms": {}},
		"event-user-idle":  {"idle-for": {}, "idle-for-ms": {}},
	}
	for tag := range commonTags {
		if _, ok := commonAttrs[tag]; !ok {
			commonAttrs[tag] = noAttrs
		}
	}
	commonChildren := map[string]map[string]struct{}{
		"behavioral-posture":          {"posture-class": {}, "action-family": {}, "interrupt-mode": {}, "transition-reason": {}, "truth-basis-id": {}, "status-text": {}},
		"canonical-memory-candidates": {"candidate": {}},
		"candidate":                   {"episodic": {}, "semantic": {}, "observational": {}},
		"episodic":                    {"summary": {}, "occurred-at": {}, "participant": {}},
		"semantic":                    {"subject": {}, "predicate": {}, "object": {}, "confidence": {}},
		"observational":               {"observation": {}, "observed-at": {}, "source-ref": {}},
		"next-hook-intent":            {"time": {}, "event-user-idle": {}, "event-chat-ended": {}},
	}
	commonTextTags := map[string]struct{}{
		"posture-class":          {},
		"action-family":          {},
		"interrupt-mode":         {},
		"transition-reason":      {},
		"truth-basis-id":         {},
		"status-text":            {},
		"summary":                {},
		"tokens-used":            {},
		"occurred-at":            {},
		"participant":            {},
		"subject":                {},
		"predicate":              {},
		"object":                 {},
		"confidence":             {},
		"observation":            {},
		"observed-at":            {},
		"source-ref":             {},
		"cancel-pending-hook-id": {},
	}
	switch rootName {
	case "life-turn":
		tags := cloneStringSet(commonTags)
		tags["life-turn"] = struct{}{}
		attrs := cloneAttrSet(commonAttrs)
		attrs["life-turn"] = noAttrs
		children := cloneChildSet(commonChildren)
		children["life-turn"] = map[string]struct{}{"behavioral-posture": {}, "status-text": {}, "summary": {}, "tokens-used": {}, "canonical-memory-candidates": {}, "next-hook-intent": {}}
		ensureLeafChildren(tags, children)
		return tags, attrs, children, cloneStringSet(commonTextTags), true
	case "chat-track-sidecar":
		tags := cloneStringSet(commonTags)
		tags["chat-track-sidecar"] = struct{}{}
		tags["cancel-pending-hook-id"] = struct{}{}
		attrs := cloneAttrSet(commonAttrs)
		attrs["chat-track-sidecar"] = noAttrs
		attrs["cancel-pending-hook-id"] = noAttrs
		children := cloneChildSet(commonChildren)
		children["chat-track-sidecar"] = map[string]struct{}{"behavioral-posture": {}, "cancel-pending-hook-id": {}, "next-hook-intent": {}, "canonical-memory-candidates": {}}
		ensureLeafChildren(tags, children)
		return tags, attrs, children, cloneStringSet(commonTextTags), true
	case "canonical-review":
		tags := map[string]struct{}{
			"canonical-review": {},
			"summary":          {},
			"tokens-used":      {},
			"narratives":       {},
			"narrative":        {},
			"content":          {},
			"source-memory-id": {},
			"truths":           {},
			"truth":            {},
			"statement":        {},
			"relations":        {},
			"relation":         {},
		}
		attrs := map[string]map[string]struct{}{
			"canonical-review": noAttrs,
			"summary":          noAttrs,
			"tokens-used":      noAttrs,
			"narratives":       noAttrs,
			"content":          noAttrs,
			"source-memory-id": noAttrs,
			"truths":           noAttrs,
			"statement":        noAttrs,
			"relations":        noAttrs,
			"narrative":        {"id": {}, "topic": {}, "source-version": {}, "status": {}},
			"truth":            {"id": {}, "dimension": {}, "normalized-key": {}, "confidence": {}, "source-count": {}, "review-count": {}, "first-review-at": {}, "last-review-at": {}, "status": {}, "supersedes-truth-id": {}},
			"relation":         {"id": {}, "source-id": {}, "target-id": {}, "relation-type": {}, "confidence": {}},
		}
		children := map[string]map[string]struct{}{
			"canonical-review": {"summary": {}, "tokens-used": {}, "narratives": {}, "truths": {}, "relations": {}},
			"narratives":       {"narrative": {}},
			"narrative":        {"content": {}, "source-memory-id": {}},
			"truths":           {"truth": {}},
			"truth":            {"statement": {}, "source-memory-id": {}},
			"relations":        {"relation": {}},
		}
		ensureLeafChildren(tags, children)
		textTags := map[string]struct{}{
			"summary":          {},
			"tokens-used":      {},
			"content":          {},
			"source-memory-id": {},
			"statement":        {},
		}
		return tags, attrs, children, textTags, true
	default:
		return nil, nil, nil, nil, false
	}
}

func cloneStringSet(input map[string]struct{}) map[string]struct{} {
	output := make(map[string]struct{}, len(input))
	for key := range input {
		output[key] = struct{}{}
	}
	return output
}

func cloneAttrSet(input map[string]map[string]struct{}) map[string]map[string]struct{} {
	output := make(map[string]map[string]struct{}, len(input))
	for key, attrs := range input {
		output[key] = cloneStringSet(attrs)
	}
	return output
}

func cloneChildSet(input map[string]map[string]struct{}) map[string]map[string]struct{} {
	return cloneAttrSet(input)
}

func ensureLeafChildren(tags map[string]struct{}, children map[string]map[string]struct{}) {
	for tag := range tags {
		if _, ok := children[tag]; !ok {
			children[tag] = map[string]struct{}{}
		}
	}
}

func apmlPosturePatch(input *apmlBehavioralPosture) *BehavioralPosturePatch {
	if input == nil {
		return nil
	}
	return &BehavioralPosturePatch{
		PostureClass:     strings.TrimSpace(input.PostureClass),
		ActionFamily:     strings.TrimSpace(input.ActionFamily),
		InterruptMode:    strings.TrimSpace(input.InterruptMode),
		TransitionReason: strings.TrimSpace(input.TransitionReason),
		TruthBasisIDs:    uniqueNonEmptyStrings(input.TruthBasisIDs),
		StatusText:       strings.TrimSpace(input.StatusText),
	}
}

func apmlMemoryCandidateRaw(input apmlMemoryCandidate) (lifeTurnMemoryCandidate, error) {
	branches := 0
	if input.Episodic != nil {
		branches++
	}
	if input.Semantic != nil {
		branches++
	}
	if input.Observational != nil {
		branches++
	}
	if branches != 1 {
		return lifeTurnMemoryCandidate{}, fmt.Errorf("APML memory candidate must contain exactly one episodic, semantic, or observational payload")
	}
	record := &runtimev1.MemoryRecordInput{}
	switch {
	case input.Episodic != nil:
		record.Kind = runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_EPISODIC
		payload := &runtimev1.EpisodicMemoryRecord{
			Summary:      strings.TrimSpace(input.Episodic.Summary),
			Participants: uniqueNonEmptyStrings(input.Episodic.Participants),
		}
		if at := strings.TrimSpace(input.Episodic.OccurredAt); at != "" {
			parsed, err := time.Parse(time.RFC3339Nano, at)
			if err != nil {
				return lifeTurnMemoryCandidate{}, fmt.Errorf("APML episodic occurred-at invalid: %w", err)
			}
			payload.OccurredAt = timestamppb.New(parsed)
		}
		record.Payload = &runtimev1.MemoryRecordInput_Episodic{Episodic: payload}
	case input.Semantic != nil:
		record.Kind = runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC
		record.Payload = &runtimev1.MemoryRecordInput_Semantic{Semantic: &runtimev1.SemanticMemoryRecord{
			Subject:    strings.TrimSpace(input.Semantic.Subject),
			Predicate:  strings.TrimSpace(input.Semantic.Predicate),
			Object:     strings.TrimSpace(input.Semantic.Object),
			Confidence: input.Semantic.Confidence,
		}}
	case input.Observational != nil:
		record.Kind = runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL
		payload := &runtimev1.ObservationalMemoryRecord{
			Observation: strings.TrimSpace(input.Observational.Observation),
			SourceRef:   strings.TrimSpace(input.Observational.SourceRef),
		}
		if at := strings.TrimSpace(input.Observational.ObservedAt); at != "" {
			parsed, err := time.Parse(time.RFC3339Nano, at)
			if err != nil {
				return lifeTurnMemoryCandidate{}, fmt.Errorf("APML observational observed-at invalid: %w", err)
			}
			payload.ObservedAt = timestamppb.New(parsed)
		}
		record.Payload = &runtimev1.MemoryRecordInput_Observational{Observational: payload}
	}
	raw, err := protojson.MarshalOptions{UseProtoNames: false, EmitUnpopulated: false}.Marshal(record)
	if err != nil {
		return lifeTurnMemoryCandidate{}, fmt.Errorf("APML memory candidate record marshal failed: %w", err)
	}
	return lifeTurnMemoryCandidate{
		CanonicalClass: strings.TrimSpace(input.CanonicalClass),
		PolicyReason:   strings.TrimSpace(input.PolicyReason),
		RecordRaw:      append([]byte(nil), raw...),
	}, nil
}

func apmlHookIntentValue(input *apmlHookIntent) (*runtimev1.HookIntent, error) {
	if input == nil {
		return nil, nil
	}
	intent := &runtimev1.HookIntent{
		IntentId:       strings.TrimSpace(input.IntentID),
		Effect:         runtimev1.HookEffect_HOOK_EFFECT_FOLLOW_UP_TURN,
		AdmissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED,
		Reason:         strings.TrimSpace(input.Reason),
	}
	if intent.IntentId == "" {
		intent.IntentId = "hook_" + ulid.Make().String()
	}
	effect := normalizeEnumLike(input.Effect)
	if effect != "" && effect != "FOLLOW_UP_TURN" && effect != "HOOK_EFFECT_FOLLOW_UP_TURN" {
		return nil, fmt.Errorf("APML hook effect must be follow-up-turn")
	}
	family := normalizeEnumLike(input.TriggerFamily)
	switch {
	case input.Time != nil:
		if family != "" && family != "TIME" && family != "HOOK_TRIGGER_FAMILY_TIME" {
			return nil, fmt.Errorf("APML hook trigger-family must match time")
		}
		delay, err := parseAPMLDuration(input.Time.Delay, input.Time.DelayMs)
		if err != nil {
			return nil, fmt.Errorf("APML hook time delay invalid: %w", err)
		}
		intent.TriggerFamily = runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME
		intent.TriggerDetail = &runtimev1.HookTriggerDetail{Detail: &runtimev1.HookTriggerDetail_Time{Time: &runtimev1.HookTriggerTimeDetail{Delay: delay}}}
	case input.EventUserIdle != nil:
		if family != "" && family != "EVENT" && family != "HOOK_TRIGGER_FAMILY_EVENT" {
			return nil, fmt.Errorf("APML hook trigger-family must match event-user-idle")
		}
		idleFor, err := parseAPMLDuration(input.EventUserIdle.IdleFor, input.EventUserIdle.IdleForMs)
		if err != nil {
			return nil, fmt.Errorf("APML hook event-user-idle idle-for invalid: %w", err)
		}
		intent.TriggerFamily = runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_EVENT
		intent.TriggerDetail = &runtimev1.HookTriggerDetail{Detail: &runtimev1.HookTriggerDetail_EventUserIdle{EventUserIdle: &runtimev1.HookTriggerEventUserIdleDetail{IdleFor: idleFor}}}
	case input.EventChatEnded != nil:
		if family != "" && family != "EVENT" && family != "HOOK_TRIGGER_FAMILY_EVENT" {
			return nil, fmt.Errorf("APML hook trigger-family must match event-chat-ended")
		}
		intent.TriggerFamily = runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_EVENT
		intent.TriggerDetail = &runtimev1.HookTriggerDetail{Detail: &runtimev1.HookTriggerDetail_EventChatEnded{EventChatEnded: &runtimev1.HookTriggerEventChatEndedDetail{}}}
	default:
		return nil, fmt.Errorf("APML hook must include time, event-user-idle, or event-chat-ended")
	}
	if err := validateHookIntent(intent); err != nil {
		return nil, err
	}
	return intent, nil
}

func normalizeEnumLike(value string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(value), "-", "_"))
}

func parseAPMLDuration(value string, msValue string) (*durationpb.Duration, error) {
	if normalized := strings.TrimSpace(msValue); normalized != "" {
		ms, err := strconv.ParseInt(normalized, 10, 64)
		if err != nil || ms <= 0 {
			return nil, fmt.Errorf("duration milliseconds must be positive")
		}
		return durationpb.New(time.Duration(ms) * time.Millisecond), nil
	}
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return nil, fmt.Errorf("duration is required")
	}
	duration, err := time.ParseDuration(normalized)
	if err != nil || duration <= 0 {
		return nil, fmt.Errorf("duration must be positive")
	}
	return durationpb.New(duration), nil
}
