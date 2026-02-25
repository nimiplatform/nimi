package scriptworker

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func TestScriptWorkerExecuteRequestSchema(t *testing.T) {
	desc := (&runtimev1.ExecuteRequest{}).ProtoReflect().Descriptor()
	expectField(t, desc, "task_id", 1, protoreflect.StringKind)
	expectField(t, desc, "node_id", 2, protoreflect.StringKind)
	inputs := expectField(t, desc, "inputs", 3, protoreflect.MessageKind)
	if !inputs.IsMap() {
		t.Fatalf("inputs field must be map, got kind=%v", inputs.Kind())
	}
	expectField(t, desc, "runtime", 4, protoreflect.StringKind)
	expectField(t, desc, "code", 5, protoreflect.StringKind)
	expectField(t, desc, "timeout_ms", 6, protoreflect.Int32Kind)
	expectField(t, desc, "memory_limit_bytes", 7, protoreflect.Int64Kind)
}

func TestScriptWorkerExecuteResponseSchema(t *testing.T) {
	desc := (&runtimev1.ExecuteResponse{}).ProtoReflect().Descriptor()
	expectField(t, desc, "output", 1, protoreflect.MessageKind)
	expectField(t, desc, "success", 2, protoreflect.BoolKind)
	expectField(t, desc, "error_message", 3, protoreflect.StringKind)
}

func expectField(t *testing.T, desc protoreflect.MessageDescriptor, name string, number protoreflect.FieldNumber, kind protoreflect.Kind) protoreflect.FieldDescriptor {
	t.Helper()
	field := desc.Fields().ByName(protoreflect.Name(name))
	if field == nil {
		t.Fatalf("field %q not found on %s", name, desc.FullName())
	}
	if field.Number() != number {
		t.Fatalf("field %q number mismatch: got=%d want=%d", name, field.Number(), number)
	}
	if field.Kind() != kind {
		t.Fatalf("field %q kind mismatch: got=%v want=%v", name, field.Kind(), kind)
	}
	return field
}
