package localexecution

import (
	"context"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/encoding/protojson"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.text-annotation
const (
	MaxTextAnnotationInputBytes  = 512 << 10
	MaxTextAnnotationResultBytes = 16 << 20
	MaxTextAnnotationTokens      = 65536
)

type TextAnnotationExecutionHost interface {
	ExecuteTextAnnotation(context.Context, *capabilitydriver.TextAnnotationInvocationPlan, func() error) (*runtimev1.TextAnnotationResult, error)
}

func ValidateTextAnnotationSpec(spec *runtimev1.TextAnnotateScenarioSpec) error {
	if spec == nil || len(spec.ProtoReflect().GetUnknown()) != 0 || len(spec.Language) < 2 || len(spec.Language) > 16 || len(spec.Texts) == 0 || len(spec.Texts) > 64 {
		return fmt.Errorf("text annotation requires a language and 1 to 64 documents")
	}
	for _, value := range spec.Language {
		if !(value >= 'a' && value <= 'z') && value != '-' {
			return fmt.Errorf("text annotation language is invalid")
		}
	}
	count := 0
	for _, text := range spec.Texts {
		if !utf8.ValidString(text) {
			return fmt.Errorf("text annotation requires valid Unicode")
		}
		count += len(text)
		if count > MaxTextAnnotationInputBytes {
			return fmt.Errorf("text annotation input exceeds 512 KiB")
		}
	}
	return nil
}

func ValidateTextAnnotationResult(result *runtimev1.TextAnnotationResult, spec *runtimev1.TextAnnotateScenarioSpec) error {
	if err := ValidateTextAnnotationSpec(spec); err != nil {
		return err
	}
	if result == nil || len(result.Documents) != len(spec.Texts) || len(result.ProtoReflect().GetUnknown()) != 0 {
		return fmt.Errorf("text annotation result does not preserve its input batch")
	}
	count := 0
	for index, doc := range result.Documents {
		if doc == nil || doc.Text != spec.Texts[index] || doc.Language != spec.Language || len(doc.ProtoReflect().GetUnknown()) != 0 {
			return fmt.Errorf("text annotation result changed source text or language")
		}
		chars := []rune(doc.Text)
		count += len(doc.Tokens)
		if count > MaxTextAnnotationTokens || (len(chars) > 0 && len(doc.Tokens) == 0) {
			return fmt.Errorf("text annotation token count is invalid")
		}
		previous := uint32(0)
		for _, token := range doc.Tokens {
			if token == nil || token.Start < previous || token.End <= token.Start || uint64(token.End) > uint64(len(chars)) ||
				uint64(token.HeadIndex) >= uint64(len(doc.Tokens)) || len(token.ProtoReflect().GetUnknown()) != 0 ||
				!validAnnotationLabel(token.PartOfSpeech) || !validAnnotationLabel(token.Dependency) {
				return fmt.Errorf("text annotation token or head is invalid")
			}
			if token.Text != string(chars[token.Start:token.End]) || strings.TrimFunc(string(chars[previous:token.Start]), unicode.IsSpace) != "" {
				return fmt.Errorf("text annotation token offsets do not preserve source text")
			}
			previous = token.End
		}
		if strings.TrimFunc(string(chars[previous:]), unicode.IsSpace) != "" {
			return fmt.Errorf("text annotation omitted source text")
		}
		previous = 0
		for _, sentence := range doc.Sentences {
			if sentence == nil || sentence.StartToken != previous || sentence.EndToken <= sentence.StartToken || uint64(sentence.EndToken) > uint64(len(doc.Tokens)) || len(sentence.ProtoReflect().GetUnknown()) != 0 {
				return fmt.Errorf("text annotation sentence coverage is invalid")
			}
			previous = sentence.EndToken
		}
		if uint64(previous) != uint64(len(doc.Tokens)) {
			return fmt.Errorf("text annotation lacks complete sentence boundaries")
		}
	}
	encoded, err := (protojson.MarshalOptions{EmitUnpopulated: true}).Marshal(result)
	if err != nil || len(encoded) > MaxTextAnnotationResultBytes {
		return fmt.Errorf("text annotation result exceeds 16 MiB")
	}
	return nil
}

func validAnnotationLabel(value string) bool {
	return value != "" && len(value) <= 128 && utf8.ValidString(value) && strings.TrimSpace(value) == value
}
