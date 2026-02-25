package scriptworker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/expr-lang/expr"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"go.starlark.net/starlark"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	defaultExecuteTimeout = 5 * time.Second
	maxExecuteTimeout     = 15 * time.Second
	maxInputBytes         = 1 << 20
	maxOutputBytes        = 1 << 20
	maxMemoryLimitBytes   = 64 << 20
)

type Service struct {
	runtimev1.UnimplementedScriptWorkerServiceServer
	logger *slog.Logger
}

func New(logger *slog.Logger) *Service {
	return &Service{logger: logger}
}

func (s *Service) Execute(ctx context.Context, req *runtimev1.ExecuteRequest) (*runtimev1.ExecuteResponse, error) {
	if req == nil {
		return failed("request is required"), nil
	}
	if strings.TrimSpace(req.GetTaskId()) == "" || strings.TrimSpace(req.GetNodeId()) == "" {
		return failed("task_id and node_id are required"), nil
	}
	runtimeName := strings.ToLower(strings.TrimSpace(req.GetRuntime()))
	if runtimeName != "expr" && runtimeName != "starlark" {
		return failed("unsupported runtime"), nil
	}
	if strings.TrimSpace(req.GetCode()) == "" {
		return failed("code is required"), nil
	}
	if req.GetMemoryLimitBytes() > maxMemoryLimitBytes {
		return failed("memory limit exceeds runtime maximum"), nil
	}
	if estimateInputSize(req.GetInputs()) > maxInputBytes {
		return failed("input exceeds size limit"), nil
	}

	executeTimeout := resolveTimeout(req.GetTimeoutMs())
	runCtx, cancel := context.WithTimeout(ctx, executeTimeout)
	defer cancel()

	type outcome struct {
		output *structpb.Struct
		err    error
	}
	resultCh := make(chan outcome, 1)
	go func() {
		output, err := s.executeRuntime(runCtx, runtimeName, req.GetCode(), req.GetInputs())
		resultCh <- outcome{output: output, err: err}
	}()

	select {
	case <-runCtx.Done():
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return failed("script execution timeout"), nil
		}
		return failed("script execution canceled"), nil
	case result := <-resultCh:
		if result.err != nil {
			if s.logger != nil {
				s.logger.Warn("script worker execution failed", "runtime", runtimeName, "error", result.err)
			}
			return failed(result.err.Error()), nil
		}
		if estimateOutputSize(result.output) > maxOutputBytes {
			return failed("output exceeds size limit"), nil
		}
		return &runtimev1.ExecuteResponse{
			Output:       result.output,
			Success:      true,
			ErrorMessage: "",
		}, nil
	}
}

func (s *Service) executeRuntime(ctx context.Context, runtimeName string, code string, inputs map[string]*structpb.Struct) (*structpb.Struct, error) {
	inputMap := make(map[string]any, len(inputs))
	for key, value := range inputs {
		if value == nil {
			inputMap[key] = map[string]any{}
			continue
		}
		inputMap[key] = value.AsMap()
	}

	var (
		rawOutput any
		err       error
	)
	switch runtimeName {
	case "expr":
		rawOutput, err = runExpr(code, inputMap)
	case "starlark":
		rawOutput, err = runStarlark(ctx, code, inputMap)
	default:
		return nil, fmt.Errorf("unsupported runtime %q", runtimeName)
	}
	if err != nil {
		return nil, err
	}
	return toStruct(rawOutput)
}

func runExpr(code string, inputs map[string]any) (any, error) {
	env := map[string]any{"inputs": inputs}
	program, err := expr.Compile(code, expr.Env(env), expr.AsAny())
	if err != nil {
		return nil, err
	}
	return expr.Run(program, env)
}

func runStarlark(ctx context.Context, code string, inputs map[string]any) (any, error) {
	thread := &starlark.Thread{Name: "nimi-script-worker"}
	thread.Load = func(_ *starlark.Thread, _ string) (starlark.StringDict, error) {
		return nil, fmt.Errorf("load() is disabled")
	}

	cancelDone := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			thread.Cancel(ctx.Err().Error())
		case <-cancelDone:
		}
	}()
	defer close(cancelDone)

	globals, err := starlark.ExecFile(thread, "script.star", code, nil)
	if err != nil {
		return nil, err
	}
	transformFn, ok := globals["transform"]
	if !ok {
		return nil, fmt.Errorf("starlark script must define transform(inputs)")
	}

	inputsValue, err := goToStarlark(inputs)
	if err != nil {
		return nil, err
	}
	result, err := starlark.Call(thread, transformFn, starlark.Tuple{inputsValue}, nil)
	if err != nil {
		return nil, err
	}
	return starlarkToGo(result)
}

func goToStarlark(value any) (starlark.Value, error) {
	switch cast := value.(type) {
	case nil:
		return starlark.None, nil
	case bool:
		return starlark.Bool(cast), nil
	case string:
		return starlark.String(cast), nil
	case float64:
		return starlark.Float(cast), nil
	case float32:
		return starlark.Float(cast), nil
	case int:
		return starlark.MakeInt(cast), nil
	case int32:
		return starlark.MakeInt64(int64(cast)), nil
	case int64:
		return starlark.MakeInt64(cast), nil
	case uint:
		return starlark.MakeUint64(uint64(cast)), nil
	case uint32:
		return starlark.MakeUint64(uint64(cast)), nil
	case uint64:
		return starlark.MakeUint64(cast), nil
	case []any:
		items := make([]starlark.Value, 0, len(cast))
		for _, item := range cast {
			converted, err := goToStarlark(item)
			if err != nil {
				return nil, err
			}
			items = append(items, converted)
		}
		return starlark.NewList(items), nil
	case map[string]any:
		dict := starlark.NewDict(len(cast))
		for key, item := range cast {
			converted, err := goToStarlark(item)
			if err != nil {
				return nil, err
			}
			if err := dict.SetKey(starlark.String(key), converted); err != nil {
				return nil, err
			}
		}
		return dict, nil
	default:
		return starlark.String(fmt.Sprintf("%v", cast)), nil
	}
}

func starlarkToGo(value starlark.Value) (any, error) {
	switch cast := value.(type) {
	case starlark.NoneType:
		return nil, nil
	case starlark.Bool:
		return bool(cast), nil
	case starlark.String:
		return string(cast), nil
	case starlark.Int:
		if asInt64, ok := cast.Int64(); ok {
			return asInt64, nil
		}
		return cast.String(), nil
	case starlark.Float:
		return float64(cast), nil
	case *starlark.List:
		result := make([]any, 0, cast.Len())
		for i := 0; i < cast.Len(); i++ {
			item, err := starlarkToGo(cast.Index(i))
			if err != nil {
				return nil, err
			}
			result = append(result, item)
		}
		return result, nil
	case starlark.Tuple:
		result := make([]any, 0, len(cast))
		for _, item := range cast {
			converted, err := starlarkToGo(item)
			if err != nil {
				return nil, err
			}
			result = append(result, converted)
		}
		return result, nil
	case *starlark.Dict:
		result := make(map[string]any, cast.Len())
		for _, item := range cast.Items() {
			keyRaw, err := starlarkToGo(item.Index(0))
			if err != nil {
				return nil, err
			}
			valueRaw, err := starlarkToGo(item.Index(1))
			if err != nil {
				return nil, err
			}
			result[fmt.Sprintf("%v", keyRaw)] = valueRaw
		}
		return result, nil
	default:
		return cast.String(), nil
	}
}

func resolveTimeout(timeoutMs int32) time.Duration {
	if timeoutMs <= 0 {
		return defaultExecuteTimeout
	}
	timeout := time.Duration(timeoutMs) * time.Millisecond
	if timeout > maxExecuteTimeout {
		return maxExecuteTimeout
	}
	return timeout
}

func estimateInputSize(inputs map[string]*structpb.Struct) int {
	mapped := make(map[string]any, len(inputs))
	for key, value := range inputs {
		if value == nil {
			mapped[key] = map[string]any{}
			continue
		}
		mapped[key] = value.AsMap()
	}
	raw, _ := json.Marshal(mapped)
	return len(raw)
}

func estimateOutputSize(output *structpb.Struct) int {
	if output == nil {
		return 0
	}
	raw, _ := json.Marshal(output.AsMap())
	return len(raw)
}

func toStruct(value any) (*structpb.Struct, error) {
	if value == nil {
		return structpb.NewStruct(map[string]any{"value": nil})
	}
	if cast, ok := value.(*structpb.Struct); ok {
		cloned := proto.Clone(cast)
		copied, ok := cloned.(*structpb.Struct)
		if !ok {
			return structpb.NewStruct(map[string]any{})
		}
		return copied, nil
	}
	if asMap, ok := value.(map[string]any); ok {
		return structpb.NewStruct(asMap)
	}
	return structpb.NewStruct(map[string]any{"value": value})
}

func failed(message string) *runtimev1.ExecuteResponse {
	return &runtimev1.ExecuteResponse{Output: nil, Success: false, ErrorMessage: message}
}
