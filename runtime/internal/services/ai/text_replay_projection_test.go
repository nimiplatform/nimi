package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"testing"
)

func TestTextReplayProjectionUsesExactVersionedRegistration(t *testing.T) {
	registrations := productionTextBehaviorAdapterRegistrations()
	for _, test := range []struct{ provider, model, kind string }{
		{"openai", "gpt-6.1-sol", "openai.responses.encrypted-reasoning"},
		{"openai_chatgpt_plan", "gpt-6.1-sol", "openai_chatgpt_plan.responses.encrypted-reasoning"},
		{"anthropic", "claude-opus-5-5", "anthropic.messages.thinking"},
		{"anthropic", "claude-sonnet-4-6", ""},
	} {
		facts := textBehaviorAdapterResolutionFacts{ImplementationID: test.provider, DriverID: "nimillm", DriverDialect: test.provider, CloudTarget: &textBehaviorCloudTarget{Provider: test.provider, ProviderModelID: test.model}}
		replay := projectTextReplay(registrations, facts)
		if replay == nil {
			t.Fatalf("%s/%s compatibility missing", test.provider, test.model)
		}
		if test.kind == "" {
			if len(replay.AcceptedCarriers) != 0 {
				t.Fatal("base protocol gained continuity")
			}
			continue
		}
		if len(replay.AcceptedCarriers) != 1 || replay.AcceptedCarriers[0].Kind != test.kind || replay.AcceptedCarriers[0].Version != 1 || len(replay.AcceptedCarriers[0].ExecutionModes) != 2 {
			t.Fatalf("wrong replay projection: %v", replay)
		}
	}
	facts := textBehaviorAdapterResolutionFacts{ImplementationID: "openai", DriverID: "nimillm", DriverDialect: "openai", CloudTarget: &textBehaviorCloudTarget{Provider: "openai", ProviderModelID: "gpt-6.1-sol"}}
	registration := openAIResponsesTextBehaviorRegistration("gpt-6.1-sol")
	if projectTextReplay([]textBehaviorAdapterRegistration{registration, registration}, facts) != nil {
		t.Fatal("ambiguous adapter projected acceptance")
	}
	replay := projectTextReplay(nil, facts)
	if replay == nil || len(replay.AcceptedCarriers) != 0 {
		t.Fatal("no adapter must have an empty acceptance list")
	}
	if projectTextReplay(nil, textBehaviorAdapterResolutionFacts{}) != nil {
		t.Fatal("invalid facts claimed compatibility")
	}
	if registration.Support.Reasoning.ContinuityVersion != 1 {
		t.Fatal(runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID)
	}
}
