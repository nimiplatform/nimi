package ai

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// Public text.decide request bounds. Implementation-specific encoding limits
// are checked separately by the captured Driver.
const (
	maxTextDecisionStateBytes           = 256 * 1024
	maxTextDecisionQuestions            = 64
	maxTextDecisionInstructionBytes     = 32 * 1024
	maxTextDecisionCriterionBytes       = 8 * 1024
	minTextDecisionCandidates           = 2
	maxTextDecisionCandidates           = 255
	maxTextDecisionIDBytes              = 64
	maxTextDecisionRequestBytes         = 1024 * 1024
	maxTextDecisionJSONDepth            = 64
	textDecisionProbabilitySumTolerance = 0.02
	// A binary64 sum of decimal probabilities that is exactly 0.98 or 1.02
	// lands a few ulps past the bound; this absorbs only that rounding.
	textDecisionProbabilitySumEpsilon = 1e-9
	textDecisionArgmaxTolerance       = 1e-6
)

func textDecisionInputInvalid() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
}

func textDecisionOutputInvalid() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.text-decision
func validateTextDecideSpec(spec *runtimev1.TextDecideScenarioSpec) error {
	if spec == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if proto.Size(spec) > maxTextDecisionRequestBytes {
		return textDecisionInputInvalid()
	}
	if err := validateTextDecisionContent(spec.GetState(), maxTextDecisionStateBytes, true); err != nil {
		return err
	}
	questions := spec.GetQuestions()
	if len(questions) == 0 || len(questions) > maxTextDecisionQuestions {
		return textDecisionInputInvalid()
	}
	seen := make(map[string]struct{}, len(questions))
	for _, question := range questions {
		if question == nil || !validTextDecisionID(question.GetId()) {
			return textDecisionInputInvalid()
		}
		if _, duplicate := seen[question.GetId()]; duplicate {
			return textDecisionInputInvalid()
		}
		seen[question.GetId()] = struct{}{}
		if err := validateTextDecisionContent(question.GetInstructions(), maxTextDecisionInstructionBytes, true); err != nil {
			return err
		}
		switch kind := question.GetKind().(type) {
		case *runtimev1.TextDecisionQuestion_Choice:
			candidates := kind.Choice.GetCandidates()
			if len(candidates) < minTextDecisionCandidates || len(candidates) > maxTextDecisionCandidates {
				return textDecisionInputInvalid()
			}
			candidateIDs := make(map[string]struct{}, len(candidates))
			for _, candidate := range candidates {
				if candidate == nil || !validTextDecisionID(candidate.GetId()) {
					return textDecisionInputInvalid()
				}
				if _, duplicate := candidateIDs[candidate.GetId()]; duplicate {
					return textDecisionInputInvalid()
				}
				candidateIDs[candidate.GetId()] = struct{}{}
				if err := validateTextDecisionContent(candidate.GetDescription(), maxTextDecisionCriterionBytes, false); err != nil {
					return err
				}
			}
		case *runtimev1.TextDecisionQuestion_Boolean:
			if kind.Boolean == nil {
				return textDecisionInputInvalid()
			}
			if err := validateTextDecisionContent(kind.Boolean.GetTrueCriterion(), maxTextDecisionCriterionBytes, false); err != nil {
				return err
			}
			if err := validateTextDecisionContent(kind.Boolean.GetFalseCriterion(), maxTextDecisionCriterionBytes, false); err != nil {
				return err
			}
		default:
			return textDecisionInputInvalid()
		}
	}
	return nil
}

func validTextDecisionID(id string) bool {
	if id == "" || len(id) > maxTextDecisionIDBytes || !utf8.ValidString(id) || strings.TrimSpace(id) != id {
		return false
	}
	for _, r := range id {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// validateTextDecisionContent accepts nonblank Unicode text or one strict JSON
// object or array. Content is never normalized or rewritten.
func validateTextDecisionContent(content *runtimev1.TextDecisionContent, maxBytes int, required bool) error {
	if content == nil || content.GetValue() == nil {
		if required {
			return textDecisionInputInvalid()
		}
		return nil
	}
	switch value := content.GetValue().(type) {
	case *runtimev1.TextDecisionContent_Text:
		if !validTextDecisionText(value.Text, maxBytes) {
			return textDecisionInputInvalid()
		}
	case *runtimev1.TextDecisionContent_Json:
		if len(value.Json) == 0 || len(value.Json) > maxBytes || !utf8.ValidString(value.Json) {
			return textDecisionInputInvalid()
		}
		if err := validateStrictJSONContainer([]byte(value.Json)); err != nil || !validJSONSurrogateEscapes(value.Json) {
			return textDecisionInputInvalid()
		}
	default:
		return textDecisionInputInvalid()
	}
	return nil
}

// textDecisionSpace is Unicode White_Space plus the information separators
// U+001C-U+001F, which implementations such as Python's str.strip also treat
// as space; text made only of these is blank.
func textDecisionSpace(r rune) bool {
	return unicode.IsSpace(r) || (r >= 0x1c && r <= 0x1f)
}

func validTextDecisionText(text string, maxBytes int) bool {
	if len(text) == 0 || len(text) > maxBytes || !utf8.ValidString(text) || strings.TrimFunc(text, textDecisionSpace) == "" {
		return false
	}
	for _, r := range text {
		if r == 0 {
			return false
		}
	}
	return true
}

var errTextDecisionJSON = errors.New("text decision content is not one strict JSON object or array")

// validateStrictJSONContainer requires exactly one JSON object or array with
// unique object keys and bounded nesting.
func validateStrictJSONContainer(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	first, err := decoder.Token()
	if err != nil {
		return errTextDecisionJSON
	}
	delim, ok := first.(json.Delim)
	if !ok || (delim != '{' && delim != '[') {
		return errTextDecisionJSON
	}
	if err := consumeStrictJSONContainer(decoder, delim, 1); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return errTextDecisionJSON
	}
	return nil
}

func consumeStrictJSONContainer(decoder *json.Decoder, open json.Delim, depth int) error {
	if depth > maxTextDecisionJSONDepth {
		return errTextDecisionJSON
	}
	keys := map[string]struct{}{}
	for decoder.More() {
		if open == '{' {
			keyToken, err := decoder.Token()
			if err != nil {
				return errTextDecisionJSON
			}
			key, ok := keyToken.(string)
			if !ok {
				return errTextDecisionJSON
			}
			if _, duplicate := keys[key]; duplicate {
				return errTextDecisionJSON
			}
			keys[key] = struct{}{}
		}
		token, err := decoder.Token()
		if err != nil {
			return errTextDecisionJSON
		}
		if number, ok := token.(json.Number); ok && !finiteJSONNumber(number) {
			return errTextDecisionJSON
		}
		if nested, ok := token.(json.Delim); ok {
			if nested != '{' && nested != '[' {
				return errTextDecisionJSON
			}
			if err := consumeStrictJSONContainer(decoder, nested, depth+1); err != nil {
				return err
			}
		}
	}
	closing, err := decoder.Token()
	if err != nil {
		return errTextDecisionJSON
	}
	if (open == '{' && closing != json.Delim('}')) || (open == '[' && closing != json.Delim(']')) {
		return errTextDecisionJSON
	}
	return nil
}

// finiteJSONNumber reports whether a JSON number is a finite IEEE 754 binary64
// value; implementations read numbers as doubles, so an overflowing literal
// would reach the model as Infinity. Underflow to zero stays finite.
func finiteJSONNumber(number json.Number) bool {
	value, err := strconv.ParseFloat(number.String(), 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return false
	}
	return !math.IsInf(value, 0)
}

// validJSONSurrogateEscapes rejects \u escapes that encode an unpaired UTF-16
// surrogate. The Go decoder would silently replace them, so accepting them
// would change submitted content before an implementation reads it. It runs
// after structural validation, so escapes only occur inside strings.
func validJSONSurrogateEscapes(raw string) bool {
	escape := func(at int) (rune, bool) {
		if at+6 > len(raw) || raw[at] != '\\' || raw[at+1] != 'u' {
			return 0, false
		}
		value, err := strconv.ParseUint(raw[at+2:at+6], 16, 32)
		return rune(value), err == nil
	}
	for index := 0; index < len(raw); index++ {
		if raw[index] != '\\' {
			continue
		}
		if index+1 < len(raw) && raw[index+1] != 'u' {
			index++ // a two-character escape such as \\ or \"
			continue
		}
		value, ok := escape(index)
		if !ok {
			return false
		}
		index += 5
		switch {
		case value >= 0xDC00 && value <= 0xDFFF:
			return false
		case value >= 0xD800 && value <= 0xDBFF:
			low, ok := escape(index + 1)
			if !ok || low < 0xDC00 || low > 0xDFFF {
				return false
			}
			index += 6
		}
	}
	return true
}

// validateTextDecisionResult requires exactly one well-formed answer per
// submitted question in submitted order. It never repairs a result.
// @nimi-authority: rule.nimi.runtime.ai-provider.text-decision
func validateTextDecisionResult(spec *runtimev1.TextDecideScenarioSpec, result *runtimev1.TextDecisionResult) error {
	if spec == nil || result == nil || len(result.GetAnswers()) != len(spec.GetQuestions()) {
		return textDecisionOutputInvalid()
	}
	for index, question := range spec.GetQuestions() {
		answer := result.GetAnswers()[index]
		if answer == nil || answer.GetQuestionId() != question.GetId() {
			return textDecisionOutputInvalid()
		}
		switch kind := question.GetKind().(type) {
		case *runtimev1.TextDecisionQuestion_Choice:
			choice := answer.GetChoice()
			if choice == nil || answer.GetBoolean() != nil {
				return textDecisionOutputInvalid()
			}
			candidates := kind.Choice.GetCandidates()
			probabilities := choice.GetProbabilities()
			if len(probabilities) != len(candidates) {
				return textDecisionOutputInvalid()
			}
			sum := 0.0
			maxProbability := math.Inf(-1)
			selected := math.NaN()
			for position, candidate := range candidates {
				entry := probabilities[position]
				if entry == nil || entry.GetCandidateId() != candidate.GetId() || !validTextDecisionProbability(entry.GetProbability()) {
					return textDecisionOutputInvalid()
				}
				sum += entry.GetProbability()
				maxProbability = math.Max(maxProbability, entry.GetProbability())
				if entry.GetCandidateId() == choice.GetSelectedCandidateId() {
					selected = entry.GetProbability()
				}
			}
			if math.IsNaN(selected) || math.Abs(sum-1) > textDecisionProbabilitySumTolerance+textDecisionProbabilitySumEpsilon || selected < maxProbability-textDecisionArgmaxTolerance {
				return textDecisionOutputInvalid()
			}
		case *runtimev1.TextDecisionQuestion_Boolean:
			boolean := answer.GetBoolean()
			if boolean == nil || answer.GetChoice() != nil || !validTextDecisionProbability(boolean.GetTrueProbability()) {
				return textDecisionOutputInvalid()
			}
		default:
			return textDecisionOutputInvalid()
		}
	}
	return nil
}

func validTextDecisionProbability(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= 1
}
