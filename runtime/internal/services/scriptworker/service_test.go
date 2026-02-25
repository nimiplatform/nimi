package scriptworker

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestExecuteExprRuntime(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	resp, err := svc.Execute(context.Background(), &runtimev1.ExecuteRequest{
		TaskId:  "task-1",
		NodeId:  "node-1",
		Runtime: "expr",
		Code:    `1 + 2`,
	})
	if err != nil {
		t.Fatalf("execute expr: %v", err)
	}
	if !resp.GetSuccess() {
		t.Fatalf("expr runtime should succeed: %s", resp.GetErrorMessage())
	}
	if got := int(resp.GetOutput().AsMap()["value"].(float64)); got != 3 {
		t.Fatalf("expr output mismatch: %d", got)
	}
}

func TestExecuteStarlarkRuntime(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	input, err := structpb.NewStruct(map[string]any{"value": "hello"})
	if err != nil {
		t.Fatalf("new struct: %v", err)
	}
	resp, execErr := svc.Execute(context.Background(), &runtimev1.ExecuteRequest{
		TaskId:  "task-2",
		NodeId:  "node-2",
		Runtime: "starlark",
		Code: `
def transform(inputs):
  return {"text": inputs["data"]["value"] + " world"}
`,
		Inputs: map[string]*structpb.Struct{"data": input},
	})
	if execErr != nil {
		t.Fatalf("execute starlark: %v", execErr)
	}
	if !resp.GetSuccess() {
		t.Fatalf("starlark runtime should succeed: %s", resp.GetErrorMessage())
	}
	if got := resp.GetOutput().AsMap()["text"]; got != "hello world" {
		t.Fatalf("starlark output mismatch: %v", got)
	}
}

func TestExecuteInputLimit(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	large := strings.Repeat("a", maxInputBytes+1024)
	input, err := structpb.NewStruct(map[string]any{"value": large})
	if err != nil {
		t.Fatalf("new struct: %v", err)
	}
	resp, execErr := svc.Execute(context.Background(), &runtimev1.ExecuteRequest{
		TaskId:  "task-3",
		NodeId:  "node-3",
		Runtime: "expr",
		Code:    `1`,
		Inputs:  map[string]*structpb.Struct{"payload": input},
	})
	if execErr != nil {
		t.Fatalf("execute input limit: %v", execErr)
	}
	if resp.GetSuccess() {
		t.Fatalf("expected input-limit rejection")
	}
}

func TestExecuteTimeout(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	resp, execErr := svc.Execute(context.Background(), &runtimev1.ExecuteRequest{
		TaskId:    "task-timeout",
		NodeId:    "node-timeout",
		Runtime:   "starlark",
		TimeoutMs: 10,
		Code: `
def transform(inputs):
  total = 0
  for i in range(0, 50000000):
    total += i
  return {"value": total}
`,
	})
	if execErr != nil {
		t.Fatalf("execute timeout: %v", execErr)
	}
	if resp.GetSuccess() {
		t.Fatalf("expected timeout rejection")
	}
	if !strings.Contains(resp.GetErrorMessage(), "timeout") {
		t.Fatalf("expected timeout error message, got=%q", resp.GetErrorMessage())
	}
}

func TestExecuteLoadDisabled(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	resp, execErr := svc.Execute(context.Background(), &runtimev1.ExecuteRequest{
		TaskId:  "task-load",
		NodeId:  "node-load",
		Runtime: "starlark",
		Code: `
load("stdlib.star", "x")
def transform(inputs):
  return {"value": x}
`,
	})
	if execErr != nil {
		t.Fatalf("execute load-disabled: %v", execErr)
	}
	if resp.GetSuccess() {
		t.Fatalf("expected load-disabled rejection")
	}
	if !strings.Contains(resp.GetErrorMessage(), "load() is disabled") {
		t.Fatalf("expected load() disabled message, got=%q", resp.GetErrorMessage())
	}
}

func TestExecuteOutputLimit(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	resp, execErr := svc.Execute(context.Background(), &runtimev1.ExecuteRequest{
		TaskId:  "task-output-limit",
		NodeId:  "node-output-limit",
		Runtime: "starlark",
		Code: `
def transform(inputs):
  return {"value": "a" * 1100000}
`,
	})
	if execErr != nil {
		t.Fatalf("execute output-limit: %v", execErr)
	}
	if resp.GetSuccess() {
		t.Fatalf("expected output-limit rejection")
	}
	if !strings.Contains(resp.GetErrorMessage(), "output exceeds size limit") {
		t.Fatalf("expected output-limit message, got=%q", resp.GetErrorMessage())
	}
}

func TestExecuteMemoryLimit(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	resp, execErr := svc.Execute(context.Background(), &runtimev1.ExecuteRequest{
		TaskId:           "task-memory",
		NodeId:           "node-memory",
		Runtime:          "expr",
		Code:             `1`,
		MemoryLimitBytes: maxMemoryLimitBytes + 1,
	})
	if execErr != nil {
		t.Fatalf("execute memory-limit: %v", execErr)
	}
	if resp.GetSuccess() {
		t.Fatalf("expected memory-limit rejection")
	}
	if !strings.Contains(resp.GetErrorMessage(), "memory limit exceeds runtime maximum") {
		t.Fatalf("expected memory-limit message, got=%q", resp.GetErrorMessage())
	}
}
