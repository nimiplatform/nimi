package runtimeagent

import (
	"strings"
	"testing"
)

func TestParsePublicChatAPMLOutput_MessageStatusAndActions(t *testing.T) {
	raw := strings.Join([]string{
		`<message id="m1" style="mixed">`,
		`  <emotion>joy</emotion><activity>wave</activity>Hello APML.`,
		`</message>`,
		`<action id="a1" kind="image" source-message="m1" coupling="after-message">`,
		`  <prompt-payload kind="image"><prompt-text>a sunrise over glass towers</prompt-text></prompt-payload>`,
		`</action>`,
		`<action id="a2" kind="voice" source-message="m1" coupling="with-message">`,
		`  <prompt-payload kind="voice"><prompt-text>say it warmly</prompt-text></prompt-payload>`,
		`</action>`,
	}, "")
	envelope, err := parsePublicChatStructuredEnvelope(raw)
	if err != nil {
		t.Fatalf("parse APML: %v", err)
	}
	if envelope.Message.MessageID != "m1" {
		t.Fatalf("message id mismatch: %#v", envelope.Message)
	}
	if envelope.Message.Text != "Hello APML." {
		t.Fatalf("message text mismatch: %q", envelope.Message.Text)
	}
	if envelope.StatusCue == nil || envelope.StatusCue.Mood != "joy" || envelope.StatusCue.ActionCue != "wave" {
		t.Fatalf("status cue mismatch: %#v", envelope.StatusCue)
	}
	if len(envelope.Actions) != 2 {
		t.Fatalf("expected 2 actions, got %#v", envelope.Actions)
	}
	if got := envelope.Actions[0]; got.Modality != "image" || got.PromptPayload.Kind != "image-prompt" || got.PromptPayload.PromptText != "a sunrise over glass towers" || got.ActionIndex != 0 || got.ActionCount != 2 {
		t.Fatalf("image action mismatch: %#v", got)
	}
	if got := envelope.Actions[1]; got.Modality != "voice" || got.PromptPayload.Kind != "voice-prompt" || got.PromptPayload.PromptText != "say it warmly" || got.DeliveryCoupling != "with-message" || got.ActionIndex != 1 || got.ActionCount != 2 {
		t.Fatalf("voice action mismatch: %#v", got)
	}
}

func TestParsePublicChatAPMLOutput_TimeHookBecomesFollowUpIntent(t *testing.T) {
	raw := `<message id="m1">I will check later.</message><time-hook id="h1"><delay-ms>250</delay-ms><effect kind="follow-up-turn"><prompt-text>continue with the check</prompt-text></effect></time-hook>`
	envelope, err := parsePublicChatStructuredEnvelope(raw)
	if err != nil {
		t.Fatalf("parse APML hook: %v", err)
	}
	if len(envelope.Actions) != 1 {
		t.Fatalf("expected hook action, got %#v", envelope.Actions)
	}
	action := envelope.Actions[0]
	if action.Modality != "follow-up-turn" || action.Operation != "assistant.turn.schedule" {
		t.Fatalf("follow-up action mismatch: %#v", action)
	}
	if action.PromptPayload.DelayMs != 250 || action.PromptPayload.PromptText != "continue with the check" {
		t.Fatalf("follow-up payload mismatch: %#v", action.PromptPayload)
	}
}

func TestParsePublicChatAPMLOutputRejectsVideoAndMalformed(t *testing.T) {
	if _, err := parsePublicChatStructuredEnvelope(`<message id="m1">hello</message><action id="v1" kind="video"><prompt-payload kind="video"><prompt-text>clip</prompt-text></prompt-payload></action>`); err == nil || !strings.Contains(err.Error(), "video") {
		t.Fatalf("expected video rejection, got %v", err)
	}
	if _, err := parsePublicChatStructuredEnvelope(`<message id="m1">hello</message><unknown/>`); err == nil || !strings.Contains(err.Error(), "unsupported APML") {
		t.Fatalf("expected unsupported tag rejection, got %v", err)
	}
	if _, err := parsePublicChatStructuredEnvelope(`<action id="a1" kind="image"><prompt-payload kind="image"><prompt-text>clip</prompt-text></prompt-payload></action><message id="m1">hello</message>`); err == nil || !strings.Contains(err.Error(), "APML beginning with <message>") {
		t.Fatalf("expected first-tag rejection, got %v", err)
	}
	if _, err := parsePublicChatStructuredEnvelope(`<message id="m1"><emotion><nested/></emotion>hello</message>`); err == nil || !strings.Contains(err.Error(), "text only") {
		t.Fatalf("expected nested cue rejection, got %v", err)
	}
	if _, err := parsePublicChatStructuredEnvelope(`<message>missing id</message>`); err == nil || !strings.Contains(err.Error(), "message.id") {
		t.Fatalf("expected missing id rejection, got %v", err)
	}
	if _, err := parsePublicChatStructuredEnvelope(`我是 Gemma，可以帮你。`); err == nil || !strings.Contains(err.Error(), "APML") {
		t.Fatalf("expected APML contract drift rejection, got %v", err)
	}
}

func TestParsePublicChatJSONOutputIsNotModelFacingCompatibility(t *testing.T) {
	raw := `{"schemaId":"nimi.agent.chat.message-action.v1","message":{"messageId":"m1","text":"hello"},"actions":[{"actionId":"v1","actionIndex":0,"actionCount":1,"modality":"video","operation":"video.generate","promptPayload":{"kind":"video-prompt","promptText":"clip"},"sourceMessageId":"m1","deliveryCoupling":"after-message"}]}`
	if _, err := parsePublicChatStructuredEnvelope(raw); err == nil || !strings.Contains(err.Error(), "APML beginning with <message>") {
		t.Fatalf("expected JSON output rejection, got %v", err)
	}
}
