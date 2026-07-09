package runtimeagent

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func TestAgentPresentationProtoContractCarriesTypedRevisionCAS(t *testing.T) {
	t.Parallel()

	assertField := func(message protoreflect.MessageDescriptor, name protoreflect.Name, number protoreflect.FieldNumber, kind protoreflect.Kind) protoreflect.FieldDescriptor {
		t.Helper()
		field := message.Fields().ByName(name)
		if field == nil {
			t.Fatalf("%s.%s is missing", message.FullName(), name)
		}
		if field.Number() != number || field.Kind() != kind {
			t.Fatalf("%s.%s = field %d kind %s, want field %d kind %s", message.FullName(), name, field.Number(), field.Kind(), number, kind)
		}
		return field
	}

	profile := (&runtimev1.AgentPresentationProfile{}).ProtoReflect().Descriptor()
	assertField(profile, "revision", 10, protoreflect.Uint64Kind)
	if !profile.ReservedRanges().Has(9) {
		t.Fatalf("%s field 9 must be explicitly reserved", profile.FullName())
	}
	if field := profile.Fields().ByNumber(9); field != nil {
		t.Fatalf("%s field 9 must remain reserved, got %s", profile.FullName(), field.Name())
	}

	agent := (&runtimev1.AgentRecord{}).ProtoReflect().Descriptor()
	presentationProfile := assertField(agent, "presentation_profile", 8, protoreflect.MessageKind)
	if presentationProfile.Message() == nil || presentationProfile.Message().FullName() != profile.FullName() {
		t.Fatalf("%s.presentation_profile message = %v, want %s", agent.FullName(), presentationProfile.Message(), profile.FullName())
	}
	assertField(agent, "presentation_profile_revision", 9, protoreflect.Uint64Kind)

	request := (&runtimev1.SetAgentPresentationProfileRequest{}).ProtoReflect().Descriptor()
	expectedRevision := assertField(request, "expected_revision", 6, protoreflect.Uint64Kind)
	if !expectedRevision.HasPresence() || expectedRevision.ContainingOneof() == nil || !expectedRevision.ContainingOneof().IsSynthetic() {
		t.Fatalf("%s.expected_revision must be proto3 optional outside the mutation oneof", request.FullName())
	}
	if mutation := request.Oneofs().ByName("mutation"); mutation == nil || expectedRevision.ContainingOneof() == mutation {
		t.Fatalf("%s.expected_revision must not be part of mutation", request.FullName())
	}

	response := (&runtimev1.SetAgentPresentationProfileResponse{}).ProtoReflect().Descriptor()
	assertField(response, "committed_revision", 2, protoreflect.Uint64Kind)

	reason := runtimev1.ReasonCode(614).Type().Descriptor().Values().ByNumber(614)
	if reason == nil || reason.Name() != "AGENT_PRESENTATION_REVISION_CONFLICT" {
		t.Fatalf("ReasonCode 614 = %v, want AGENT_PRESENTATION_REVISION_CONFLICT", reason)
	}
}
