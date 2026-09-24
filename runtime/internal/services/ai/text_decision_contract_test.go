package ai

import (
	"math"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func decisionText(value string) *runtimev1.TextDecisionContent {
	return &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Text{Text: value}}
}

func decisionJSON(value string) *runtimev1.TextDecisionContent {
	return &runtimev1.TextDecisionContent{Value: &runtimev1.TextDecisionContent_Json{Json: value}}
}

func sampleTextDecideSpec() *runtimev1.TextDecideScenarioSpec {
	return &runtimev1.TextDecideScenarioSpec{
		State: decisionJSON(`{"request":"最近一周 DeepSeek 新闻","results":[{"title":"a"}]}`),
		Questions: []*runtimev1.TextDecisionQuestion{
			{
				Id:           "window",
				Instructions: decisionText("How recent should results be?"),
				Kind: &runtimev1.TextDecisionQuestion_Choice{Choice: &runtimev1.TextDecisionChoice{Candidates: []*runtimev1.TextDecisionCandidate{
					{Id: "any", Description: decisionText("any time")},
					{Id: "7d", Description: decisionJSON(`{"label":"past week"}`)},
					{Id: "24h"},
				}}},
			},
			{
				Id:           "source_github",
				Instructions: decisionJSON(`{"goal":"find code","rules":["a","b"]}`),
				Kind: &runtimev1.TextDecisionQuestion_Boolean{Boolean: &runtimev1.TextDecisionBoolean{
					TrueCriterion: decisionText("asks for code"),
				}},
			},
		},
	}
}

func sampleTextDecisionResult() *runtimev1.TextDecisionResult {
	return &runtimev1.TextDecisionResult{Answers: []*runtimev1.TextDecisionAnswer{
		{QuestionId: "window", Result: &runtimev1.TextDecisionAnswer_Choice{Choice: &runtimev1.TextDecisionChoiceAnswer{
			SelectedCandidateId: "7d",
			Probabilities: []*runtimev1.TextDecisionCandidateProbability{
				{CandidateId: "any", Probability: 0.2},
				{CandidateId: "7d", Probability: 0.7},
				{CandidateId: "24h", Probability: 0.1},
			},
		}}},
		{QuestionId: "source_github", Result: &runtimev1.TextDecisionAnswer_Boolean{Boolean: &runtimev1.TextDecisionBooleanAnswer{TrueProbability: 0.83}}},
	}}
}

func requireTextDecisionReason(t *testing.T, err error, want runtimev1.ReasonCode) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %s, got nil", want)
	}
	if got, _ := grpcerr.ExtractReasonCode(err); got != want {
		t.Fatalf("expected %s, got %v (%v)", want, got, err)
	}
}

func TestValidateTextDecideSpecAcceptsTextAndJSONContent(t *testing.T) {
	if err := validateTextDecideSpec(sampleTextDecideSpec()); err != nil {
		t.Fatalf("valid spec rejected: %v", err)
	}
}

func TestValidateTextDecideSpecRejectsContractViolations(t *testing.T) {
	cases := map[string]func(spec *runtimev1.TextDecideScenarioSpec){
		"missing state":       func(spec *runtimev1.TextDecideScenarioSpec) { spec.State = nil },
		"blank text state":    func(spec *runtimev1.TextDecideScenarioSpec) { spec.State = decisionText(" \n") },
		"scalar json state":   func(spec *runtimev1.TextDecideScenarioSpec) { spec.State = decisionJSON(`"text"`) },
		"duplicate json keys": func(spec *runtimev1.TextDecideScenarioSpec) { spec.State = decisionJSON(`{"a":1,"a":2}`) },
		"trailing json":       func(spec *runtimev1.TextDecideScenarioSpec) { spec.State = decisionJSON(`{"a":1} []`) },
		"oversized state": func(spec *runtimev1.TextDecideScenarioSpec) {
			spec.State = decisionText(strings.Repeat("x", maxTextDecisionStateBytes+1))
		},
		"no questions":         func(spec *runtimev1.TextDecideScenarioSpec) { spec.Questions = nil },
		"duplicate question":   func(spec *runtimev1.TextDecideScenarioSpec) { spec.Questions[1].Id = "window" },
		"padded question id":   func(spec *runtimev1.TextDecideScenarioSpec) { spec.Questions[0].Id = " window" },
		"control in id":        func(spec *runtimev1.TextDecideScenarioSpec) { spec.Questions[0].Id = "win\ndow" },
		"missing instructions": func(spec *runtimev1.TextDecideScenarioSpec) { spec.Questions[0].Instructions = nil },
		"missing kind":         func(spec *runtimev1.TextDecideScenarioSpec) { spec.Questions[0].Kind = nil },
		"single candidate": func(spec *runtimev1.TextDecideScenarioSpec) {
			spec.Questions[0].GetChoice().Candidates = spec.Questions[0].GetChoice().Candidates[:1]
		},
		"duplicate candidate": func(spec *runtimev1.TextDecideScenarioSpec) {
			spec.Questions[0].GetChoice().Candidates[1].Id = "any"
		},
		"blank description": func(spec *runtimev1.TextDecideScenarioSpec) {
			spec.Questions[0].GetChoice().Candidates[0].Description = decisionText("  ")
		},
		"separator-only text": func(spec *runtimev1.TextDecideScenarioSpec) { spec.State = decisionText(string([]rune{0x1c, 0x1f})) },
		"overflowing number":  func(spec *runtimev1.TextDecideScenarioSpec) { spec.State = decisionJSON(`{"x":1e400}`) },
		"huge integer": func(spec *runtimev1.TextDecideScenarioSpec) {
			spec.State = decisionJSON(`[` + strings.Repeat("9", 400) + `]`)
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			spec := sampleTextDecideSpec()
			mutate(spec)
			requireTextDecisionReason(t, validateTextDecideSpec(spec), runtimev1.ReasonCode_AI_INPUT_INVALID)
		})
	}
	tooMany := sampleTextDecideSpec()
	for index := 0; index < maxTextDecisionCandidates; index++ {
		tooMany.Questions[0].GetChoice().Candidates = append(tooMany.Questions[0].GetChoice().Candidates, &runtimev1.TextDecisionCandidate{Id: "c" + strings.Repeat("x", index%60) + string(rune('A'+index%26)) + string(rune('a'+index/26))})
	}
	requireTextDecisionReason(t, validateTextDecideSpec(tooMany), runtimev1.ReasonCode_AI_INPUT_INVALID)
}

func TestValidateTextDecideSpecAcceptsFiniteNumbersAndReplacementCharacterIDs(t *testing.T) {
	spec := sampleTextDecideSpec()
	spec.State = decisionJSON(`{"tiny":1e-400,"big":1.7976931348623157e308,"n":-0.5}`)
	spec.Questions[0].Id = "a" + string(rune(0xFFFD))
	if err := validateTextDecideSpec(spec); err != nil {
		t.Fatalf("finite numbers or U+FFFD ID rejected: %v", err)
	}
}

func TestValidateTextDecideSpecRejectsUnpairedSurrogateEscapes(t *testing.T) {
	cases := map[string]bool{
		`{"a":"😀"}`:       true,
		`{"a":"\\ud800"}`: true,
		`{"a":"x\"\\u"}`:  true,
		`{"a":"\ud800"}`:  false,
		`{"a":"\udc00"}`:  false,
		`{"a":"\ud800A"}`: false,
		`["\ud800x"]`:     false,
	}
	// A correctly paired surrogate escape, built without escape text.
	cases[strings.ReplaceAll(`{"a":"%ud83d%ude00"}`, "%", string(rune(92)))] = true
	for raw, valid := range cases {
		spec := sampleTextDecideSpec()
		spec.State = decisionJSON(raw)
		err := validateTextDecideSpec(spec)
		if valid && err != nil {
			t.Fatalf("%s rejected: %v", raw, err)
		}
		if !valid {
			requireTextDecisionReason(t, err, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	}
}

func TestValidateTextDecisionResultAcceptsCompleteDistributionsAndTies(t *testing.T) {
	spec := sampleTextDecideSpec()
	if err := validateTextDecisionResult(spec, sampleTextDecisionResult()); err != nil {
		t.Fatalf("valid result rejected: %v", err)
	}
	tie := sampleTextDecisionResult()
	tie.Answers[0].GetChoice().SelectedCandidateId = "any"
	tie.Answers[0].GetChoice().Probabilities[0].Probability = 0.45
	tie.Answers[0].GetChoice().Probabilities[1].Probability = 0.45
	if err := validateTextDecisionResult(spec, tie); err != nil {
		t.Fatalf("tied argmax rejected: %v", err)
	}
}

func TestValidateTextDecisionResultHoldsTheSumToleranceExactly(t *testing.T) {
	for _, test := range []struct {
		probabilities [3]float64
		valid         bool
	}{
		{[3]float64{0.49, 0.49, 0}, true},
		{[3]float64{0.51, 0.51, 0}, true},
		{[3]float64{0.48, 0.49, 0}, false},
		{[3]float64{0.51, 0.52, 0}, false},
	} {
		result := sampleTextDecisionResult()
		choice := result.Answers[0].GetChoice()
		choice.SelectedCandidateId = "7d"
		choice.Probabilities[0].Probability = test.probabilities[2]
		choice.Probabilities[1].Probability = test.probabilities[1]
		choice.Probabilities[2].Probability = test.probabilities[0]
		err := validateTextDecisionResult(sampleTextDecideSpec(), result)
		if test.valid && err != nil {
			t.Fatalf("%v rejected: %v", test.probabilities, err)
		}
		if !test.valid {
			requireTextDecisionReason(t, err, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
	}
}

func TestValidateTextDecisionResultRejectsIncompleteOrInconsistentAnswers(t *testing.T) {
	cases := map[string]func(result *runtimev1.TextDecisionResult){
		"missing answer": func(result *runtimev1.TextDecisionResult) { result.Answers = result.Answers[:1] },
		"reordered": func(result *runtimev1.TextDecisionResult) {
			result.Answers[0], result.Answers[1] = result.Answers[1], result.Answers[0]
		},
		"wrong type":       func(result *runtimev1.TextDecisionResult) { result.Answers[1].Result = result.Answers[0].Result },
		"unknown selected": func(result *runtimev1.TextDecisionResult) { result.Answers[0].GetChoice().SelectedCandidateId = "30d" },
		"not argmax":       func(result *runtimev1.TextDecisionResult) { result.Answers[0].GetChoice().SelectedCandidateId = "any" },
		"missing candidate": func(result *runtimev1.TextDecisionResult) {
			result.Answers[0].GetChoice().Probabilities = result.Answers[0].GetChoice().Probabilities[:2]
		},
		"unnormalized": func(result *runtimev1.TextDecisionResult) {
			result.Answers[0].GetChoice().Probabilities[2].Probability = 0.5
		},
		"nan probability": func(result *runtimev1.TextDecisionResult) {
			result.Answers[1].GetBoolean().TrueProbability = math.NaN()
		},
		"out of range": func(result *runtimev1.TextDecisionResult) {
			result.Answers[1].GetBoolean().TrueProbability = 1.2
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			result := sampleTextDecisionResult()
			mutate(result)
			requireTextDecisionReason(t, validateTextDecisionResult(sampleTextDecideSpec(), result), runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		})
	}
}
