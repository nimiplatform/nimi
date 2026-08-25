package nimillm

import (
	"encoding/json"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textwire"
	"google.golang.org/grpc/codes"
)

type textWireFields struct {
	values map[string]any
}

type textDialectAdapter interface {
	Fields(textwire.Directives) (*textWireFields, error)
}

type deepSeekTextDialectAdapter struct{}

func (deepSeekTextDialectAdapter) Fields(directives textwire.Directives) (*textWireFields, error) {
	if !directives.Valid() || directives.ReasoningToggle != textwire.ReasoningToggleDisabled {
		return nil, unsupportedTextWireDirective("deepseek")
	}
	return &textWireFields{values: map[string]any{
		"thinking": map[string]any{"type": "disabled"},
	}}, nil
}

func resolveTextWireFields(provider string, directives textwire.Directives) (*textWireFields, error) {
	if !directives.Valid() {
		return nil, unsupportedTextWireDirective(provider)
	}
	if directives.Empty() {
		return nil, nil
	}
	var adapter textDialectAdapter
	switch provider {
	case "deepseek":
		adapter = deepSeekTextDialectAdapter{}
	default:
		return nil, unsupportedTextWireDirective(provider)
	}
	return adapter.Fields(directives)
}

func unsupportedTextWireDirective(provider string) error {
	return grpcerr.WrapWithReasonCode(
		codes.InvalidArgument,
		runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED,
		fmt.Errorf("provider %q cannot honor the mapped text wire directive", provider),
		grpcerr.ReasonOptions{Message: "provider text reasoning directive is unsupported"},
	)
}

func mergeTextWireFields(base any, fields *textWireFields) (any, error) {
	if fields == nil || len(fields.values) == 0 {
		return base, nil
	}
	raw, err := json.Marshal(base)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	merged := map[string]any{}
	if err := json.Unmarshal(raw, &merged); err != nil {
		return nil, MapProviderRequestError(err)
	}
	for key, value := range fields.values {
		if _, exists := merged[key]; exists {
			return nil, grpcerr.WrapWithReasonCode(
				codes.Internal,
				runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
				fmt.Errorf("provider text wire field %q collides with canonical request", key),
				grpcerr.ReasonOptions{Message: "provider text wire directive collided with canonical request"},
			)
		}
		merged[key] = value
	}
	return merged, nil
}
