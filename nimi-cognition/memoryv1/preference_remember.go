package memoryv1

import (
	"regexp"
	"strings"
)

// @nimi-authority: rule.nimi.cognition.memory.local-preference-remember
type preferenceRemember struct{ BaselineRemember }

func (preferenceRemember) Revision() string { return "baseline-3" }

type preparation struct {
	action, item, ingredient string
	without                  bool
}

// Anchor the whole assertion. Only an explicit preference or a recurring
// first-person habit qualifies; comparisons, questions and one-off orders
// must not become a polarity judgement about a different assertion.
const zhDish = "(咖啡|拿铁|茶|红茶|绿茶|牛奶|豆浆|粥|面|汤)"
const zhIngredient = "(糖|牛奶|奶|奶油|盐|辣椒|冰)"

var zhPreference = regexp.MustCompile("^我(?:喜欢|偏好|一向|总是|通常|习惯)(喝|吃)(不?)(?:加|放)" + zhIngredient + "的" + zhDish + "$")
var zhHabit = regexp.MustCompile("^我(喝|吃)" + zhDish + "(?:时)?(?:一向|总是|通常|习惯)(不?)(?:加|放)" + zhIngredient + "$")
var enPreference = regexp.MustCompile(`^i (?:like|prefer|always (?:take|have)|usually (?:take|have)) (?:my )?(coffee|latte|tea|black tea|green tea|milk|porridge|soup) (with no|without|with) (sugar|milk|cream|salt|chili|ice)$`)

func preparationMeaning(text string) (preparation, bool) {
	text = strings.TrimSuffix(strings.TrimSuffix(strings.TrimSpace(text), "。"), ".")
	if m := zhPreference.FindStringSubmatch(text); m != nil {
		return preparation{m[1], m[4], m[3], m[2] == "不"}, true
	}
	if m := zhHabit.FindStringSubmatch(text); m != nil {
		return preparation{m[1], m[2], m[4], m[3] == "不"}, true
	}
	if m := enPreference.FindStringSubmatch(strings.Join(strings.Fields(strings.ToLower(text)), " ")); m != nil {
		return preparation{"have", m[1], m[3], m[2] != "with"}, true
	}
	return preparation{}, false
}

func (p preferenceRemember) Plan(req CommitRequest, current []Memory) (MutationPlan, error) {
	if req.Fact.Kind != EventKindMessage || req.Fact.Message == nil || req.Fact.Message.Actor != ActorUser {
		return p.BaselineRemember.Plan(req, current)
	}
	text := committedMessageText(req.Fact.Message)
	meaning, ok := preparationMeaning(text)
	if !ok {
		return p.BaselineRemember.Plan(req, current)
	}
	if forbiddenMemoryContent(text) {
		return MutationPlan{Outcome: OutcomeRejected}, nil
	}
	mutation := MemoryMutation{Kind: MutationRemember, Content: text, EpistemicStatus: EpistemicExplicit, OccurredAt: req.CommittedAt, SourceExplanation: "Committed user message"}
	for _, item := range current {
		if item.Lifecycle != LifecycleCurrent || (item.ScopeTag != "" && item.ScopeTag != ScopeTagGlobalFact) {
			continue
		}
		other, ok := preparationMeaning(item.Content)
		if !ok || other.action != meaning.action || other.item != meaning.item || other.ingredient != meaning.ingredient {
			continue
		}
		if other.without == meaning.without {
			return MutationPlan{Outcome: OutcomeNoEffect}, nil
		}
		mutation.Kind = MutationConflict
		mutation.TargetMemoryRef = item.MemoryRef
		break
	}
	return MutationPlan{Outcome: OutcomeAdmitted, Mutations: []MemoryMutation{mutation}}, nil
}
