package textbehavior

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	jsonschema "github.com/santhosh-tekuri/jsonschema/v6"
)

const schemaResource = "urn:nimi:text-behavior:schema"

type noNetworkSchemaLoader struct{}

func (noNetworkSchemaLoader) Load(url string) (any, error) {
	return nil, fmt.Errorf("remote JSON Schema resource %q is unavailable", url)
}

// CompileJSONSchema shares the same self-contained schema boundary between
// text adapters and the protected App request boundary.
// @nimi-authority: rule.nimi.runtime.ai-provider.r123
func CompileJSONSchema(document map[string]any) (*jsonschema.Schema, error) {
	compiler := jsonschema.NewCompiler()
	compiler.UseLoader(noNetworkSchemaLoader{})
	if err := compiler.AddResource(schemaResource, document); err != nil {
		return nil, err
	}
	return compiler.Compile(schemaResource)
}

func decodeToolArguments(arguments string) (map[string]any, error) {
	decoder := json.NewDecoder(strings.NewReader(arguments))
	decoder.UseNumber()
	var instance any
	if err := decoder.Decode(&instance); err != nil {
		return nil, fmt.Errorf("decode tool arguments: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil, fmt.Errorf("tool arguments must contain one JSON object")
	}
	object, ok := instance.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("tool arguments must be a JSON object")
	}
	return object, nil
}

// ValidateToolProposalArguments accepts a complete JSON object for host validation.
// @nimi-authority: rule.nimi.runtime.ai-provider.r119
func ValidateToolProposalArguments(_ *runtimev1.ToolSpec, arguments string) error {
	_, err := decodeToolArguments(arguments)
	return err
}

func ValidateToolArguments(tool *runtimev1.ToolSpec, arguments string) error {
	instance, err := decodeToolArguments(arguments)
	if err != nil {
		return err
	}
	if tool == nil || tool.GetInputSchema() == nil {
		return nil
	}
	schema, err := CompileJSONSchema(tool.GetInputSchema().AsMap())
	if err != nil {
		return fmt.Errorf("compile tool schema: %w", err)
	}
	return schema.Validate(instance)
}
