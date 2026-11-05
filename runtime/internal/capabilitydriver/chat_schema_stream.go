package capabilitydriver

import (
	"encoding/json"
	"io"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

type strictChatSchemaStream struct {
	textbehavior.StreamFragmentAssembler
	spec *runtimev1.TextGenerateScenarioSpec
}

func (s *strictChatSchemaStream) Finish() (textbehavior.NormalizedResult, error) {
	result, err := s.StreamFragmentAssembler.Finish()
	if err != nil {
		return result, err
	}
	return validateStrictChatSchemaResult(result, s.spec)
}

func validateStrictChatSchemaResult(result textbehavior.NormalizedResult, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if result.FinishReason != runtimev1.FinishReason_FINISH_REASON_STOP {
		return textbehavior.NormalizedResult{}, deepseekIncomplete()
	}
	var text strings.Builder
	for _, item := range result.Items {
		if item.Kind == textbehavior.OrderedItemText {
			text.WriteString(item.Text)
		}
	}
	var instance any
	d := json.NewDecoder(strings.NewReader(text.String()))
	d.UseNumber()
	if d.Decode(&instance) != nil || d.Decode(new(any)) != io.EOF {
		return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
	}
	schema, err := textbehavior.CompileJSONSchema(spec.GetResponseFormat().GetJsonSchema().AsMap())
	if err != nil || schema.Validate(instance) != nil {
		return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
	}
	return result, nil
}
