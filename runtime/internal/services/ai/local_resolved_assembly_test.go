package ai

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestCloneLocalResolvedAssemblyPreservesRequestPayloadBytes(t *testing.T) {
	input := &localResolvedAssembly{
		Request: localResolvedAssemblyRequest{
			Kind:    "text.generate",
			Payload: json.RawMessage(`{"systemPrompt":"<runtime-agent-context>"}`),
		},
	}
	cloned, err := cloneLocalResolvedAssembly(input)
	if err != nil {
		t.Fatalf("clone local ResolvedAssembly: %v", err)
	}
	if !bytes.Equal(cloned.Request.Payload, input.Request.Payload) {
		t.Fatalf("request payload changed during clone: got=%q want=%q", cloned.Request.Payload, input.Request.Payload)
	}
}

func TestValidateRehydratedResolvedAssemblyPlanRejectsCompleteRequestDrift(t *testing.T) {
	captured := &localResolvedAssembly{
		Request: localResolvedAssemblyRequest{
			Kind:        "speech.transcribe",
			Payload:     json.RawMessage(`{"language":"en"}`),
			BinaryInput: []byte{1, 2, 3},
			MIMEType:    "audio/wav",
		},
		LoadPlan:        localResolvedAssemblyLoadPlan{Kind: "speech", Speech: &localResolvedAssemblySpeechPlan{Operation: "transcribe", DriverID: "driver"}},
		ProcessIdentity: localResolvedAssemblyProcessIdentity{ProcessKey: "process", DriverID: "driver"},
	}
	for _, test := range []struct {
		name   string
		mutate func(*localResolvedAssembly)
	}{
		{name: "payload", mutate: func(value *localResolvedAssembly) { value.Request.Payload = json.RawMessage(`{"language":"zh"}`) }},
		{name: "binary input", mutate: func(value *localResolvedAssembly) { value.Request.BinaryInput = []byte{1, 2, 4} }},
		{name: "MIME type", mutate: func(value *localResolvedAssembly) { value.Request.MIMEType = "audio/mpeg" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			reprojected, err := cloneLocalResolvedAssembly(captured)
			if err != nil {
				t.Fatal(err)
			}
			test.mutate(reprojected)
			err = validateRehydratedResolvedAssemblyPlan(captured, reprojected)
			if err == nil || !strings.Contains(err.Error(), "request") {
				t.Fatalf("request drift was not rejected: %v", err)
			}
		})
	}
}
