package runtimeagent

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestParsePublicChatAPMLOutput_MessageStatusAndActions(t *testing.T) {
	raw := strings.Join([]string{
		`<message id="m1">`,
		`  <emotion>joy</emotion><activity>greet</activity>Hello APML.`,
		`</message>`,
		`<action id="a1" kind="image">`,
		`  <prompt-payload kind="image"><prompt-text>a sunrise over glass towers</prompt-text></prompt-payload>`,
		`</action>`,
		`<action id="a2" kind="voice">`,
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
	if envelope.StatusCue == nil || envelope.StatusCue.Mood != "joy" || envelope.StatusCue.ActionCue != "greet" {
		t.Fatalf("status cue mismatch: %#v", envelope.StatusCue)
	}
	if len(envelope.Actions) != 2 {
		t.Fatalf("expected 2 actions, got %#v", envelope.Actions)
	}
	if got := envelope.Actions[0]; got.Modality != "image" || got.PromptPayload.Kind != "image-prompt" || got.PromptPayload.PromptText != "a sunrise over glass towers" || got.ActionIndex != 0 || got.ActionCount != 2 {
		t.Fatalf("image action mismatch: %#v", got)
	}
	if got := envelope.Actions[1]; got.Modality != "voice" || got.PromptPayload.Kind != "voice-prompt" || got.PromptPayload.PromptText != "say it warmly" || got.DeliveryCoupling != "after-message" || got.ActionIndex != 1 || got.ActionCount != 2 {
		t.Fatalf("voice action mismatch: %#v", got)
	}
}

func TestParsePublicChatAPMLOutput_RejectsUnknownActivity(t *testing.T) {
	raw := `<message id="m1"><activity>wave</activity>Hello APML.</message>`
	if _, err := parsePublicChatStructuredEnvelope(raw); err == nil {
		t.Fatalf("expected unknown APML activity to fail closed")
	} else if !strings.Contains(err.Error(), "not admitted by runtime activity ontology") {
		t.Fatalf("expected activity ontology error, got %v", err)
	}
}

func TestParsePublicChatAPMLOutput_RejectsUnknownEmotion(t *testing.T) {
	raw := `<message id="m1"><emotion>curious</emotion>Hello APML.</message>`
	if _, err := parsePublicChatStructuredEnvelope(raw); err == nil {
		t.Fatalf("expected unknown APML emotion to fail closed")
	} else if !strings.Contains(err.Error(), "not admitted by runtime current emotion ontology") {
		t.Fatalf("expected current emotion ontology error, got %v", err)
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
	intent, err := publicChatHookIntentFromAction(&action, "agent-1")
	if err != nil {
		t.Fatalf("build HookIntent from time hook: %v", err)
	}
	if intent.GetTriggerFamily() != runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME {
		t.Fatalf("expected TIME HookIntent, got %#v", intent)
	}
	if got := intent.GetTriggerDetail().GetTime().GetDelay().AsDuration().Milliseconds(); got != 250 {
		t.Fatalf("expected delay 250ms, got %d", got)
	}
}

func TestParsePublicChatAPMLOutput_EventHookBecomesHookIntent(t *testing.T) {
	userIdle := `<message id="m1">I can follow up when you pause.</message><event-hook id="h1"><event-user-idle idle-for="600s"/><effect kind="follow-up-turn"><prompt-text>continue after idle</prompt-text></effect></event-hook>`
	envelope, err := parsePublicChatStructuredEnvelope(userIdle)
	if err != nil {
		t.Fatalf("parse user-idle event hook: %v", err)
	}
	if len(envelope.Actions) != 1 {
		t.Fatalf("expected one event hook action, got %#v", envelope.Actions)
	}
	action := envelope.Actions[0]
	if action.Operation != "assistant.turn.hook" || action.PromptPayload.TriggerFamily != "event" || action.PromptPayload.TriggerEvent != "user-idle" {
		t.Fatalf("event hook action mismatch: %#v", action)
	}
	if action.PromptPayload.IdleMs != 600000 {
		t.Fatalf("expected idle 600000ms, got %#v", action.PromptPayload)
	}
	intent, err := publicChatHookIntentFromAction(&action, "agent-1")
	if err != nil {
		t.Fatalf("build HookIntent from user-idle event hook: %v", err)
	}
	if intent.GetTriggerFamily() != runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_EVENT || intent.GetTriggerDetail().GetEventUserIdle() == nil {
		t.Fatalf("expected EVENT/user-idle HookIntent, got %#v", intent)
	}

	chatEnded := `<message id="m1">I can wrap this after chat ends.</message><event-hook id="h2"><event-chat-ended/><effect kind="follow-up-turn"><prompt-text>close the loop</prompt-text></effect></event-hook>`
	envelope, err = parsePublicChatStructuredEnvelope(chatEnded)
	if err != nil {
		t.Fatalf("parse chat-ended event hook: %v", err)
	}
	action = envelope.Actions[0]
	intent, err = publicChatHookIntentFromAction(&action, "agent-1")
	if err != nil {
		t.Fatalf("build HookIntent from chat-ended event hook: %v", err)
	}
	if intent.GetTriggerFamily() != runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_EVENT || intent.GetTriggerDetail().GetEventChatEnded() == nil {
		t.Fatalf("expected EVENT/chat-ended HookIntent, got %#v", intent)
	}
}

func TestPublicChatPostTurnEventHookIndicationStaysProposed(t *testing.T) {
	raw := `<message id="m1">I can follow up when you pause.</message><event-hook id="h1"><event-user-idle idle-for-ms="120000"/><effect kind="follow-up-turn"><prompt-text>continue after idle</prompt-text></effect></event-hook>`
	envelope, err := parsePublicChatStructuredEnvelope(raw)
	if err != nil {
		t.Fatalf("parse event hook: %v", err)
	}
	detail := publicChatPostTurnIndicationDetail(envelope, publicChatFollowUpOutcome{Status: "proposed"})
	hookIntent, ok := detail["hook_intent"].(map[string]any)
	if !ok {
		t.Fatalf("expected hook_intent indication, got %#v", detail)
	}
	if got := hookIntent["trigger_family"]; got != "event" {
		t.Fatalf("expected event trigger family, got %#v", hookIntent)
	}
	if got := hookIntent["admission_state"]; got != "proposed" {
		t.Fatalf("expected proposed admission state, got %#v", hookIntent)
	}
	triggerDetail, ok := hookIntent["trigger_detail"].(map[string]any)
	if !ok {
		t.Fatalf("expected trigger detail, got %#v", hookIntent)
	}
	userIdle, ok := triggerDetail["event_user_idle"].(map[string]any)
	if !ok {
		t.Fatalf("expected event_user_idle detail, got %#v", triggerDetail)
	}
	if got := userIdle["idle_ms"]; got != float64(120000) {
		t.Fatalf("expected idle_ms=120000, got %#v", userIdle)
	}
	for _, banned := range []string{"follow_up_id", "scheduled_for", "status", "reason_code", "action_hint", "message", "trace_id"} {
		if _, present := hookIntent[banned]; present {
			t.Fatalf("hook_intent indication must not leak execution truth %q, got=%v", banned, hookIntent)
		}
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

func TestParsePublicChatAPMLOutputRejectsUnknownAttributes(t *testing.T) {
	cases := []struct {
		raw     string
		wantErr string
	}{
		{raw: `<message id="m1" schema="v1">hello</message>`, wantErr: "not admitted"},
		{raw: `<message id="m1" id="m2">hello</message>`, wantErr: "duplicated"},
		{raw: `<message id="m1">hello</message><action id="a1" kind="image" priority="high"><prompt-payload kind="image"><prompt-text>clip</prompt-text></prompt-payload></action>`, wantErr: "not admitted"},
		{raw: `<message id="m1">hello</message><action id="a1" kind="image" operation="image.generate"><prompt-payload kind="image"><prompt-text>clip</prompt-text></prompt-payload></action>`, wantErr: "not admitted"},
		{raw: `<message id="m1">hello</message><action id="a1" kind="image" source-message="m1"><prompt-payload kind="image"><prompt-text>clip</prompt-text></prompt-payload></action>`, wantErr: "not admitted"},
		{raw: `<message id="m1">hello</message><action id="a1" kind="image" coupling="with-message"><prompt-payload kind="image"><prompt-text>clip</prompt-text></prompt-payload></action>`, wantErr: "not admitted"},
		{raw: `<message id="m1">hello</message><time-hook id="h1" mode="soft"><delay-ms>250</delay-ms><effect kind="follow-up-turn"><prompt-text>continue</prompt-text></effect></time-hook>`, wantErr: "not admitted"},
		{raw: `<message id="m1">hello</message><event-hook id="h1"><event-user-idle idle-for="600s" mode="soft"/><effect kind="follow-up-turn"><prompt-text>continue</prompt-text></effect></event-hook>`, wantErr: "not admitted"},
	}
	for _, tt := range cases {
		if _, err := parsePublicChatStructuredEnvelope(tt.raw); err == nil || !strings.Contains(err.Error(), tt.wantErr) {
			t.Fatalf("expected attribute rejection containing %q for %s, got %v", tt.wantErr, tt.raw, err)
		}
	}
}

func TestParsePublicChatAPMLOutputRejectsProjectionOnlyAndPayloadShortcuts(t *testing.T) {
	cases := []struct {
		raw     string
		wantErr string
	}{
		{
			raw:     `<message id="m1">hello <pause>bad</pause></message>`,
			wantErr: "unsupported APML message tag <pause>",
		},
		{
			raw:     `<message id="m1">hello <surface>avatar</surface></message>`,
			wantErr: "unsupported APML message tag <surface>",
		},
		{
			raw:     `<message id="m1"><emotion>joy</emotion><emotion>calm</emotion>hello</message>`,
			wantErr: "at most one emotion",
		},
		{
			raw:     `<message id="m1"><activity>greet</activity><activity>idle</activity>hello</message>`,
			wantErr: "at most one activity",
		},
		{
			raw:     `<message id="m1">hello</message><action id="a1" kind="image"><prompt-text>clip</prompt-text></action>`,
			wantErr: "inside prompt-payload",
		},
		{
			raw:     `<message id="m1">hello</message><action id="a1" kind="image"><prompt-payload kind="image"></prompt-payload></action>`,
			wantErr: "prompt-text is required",
		},
		{
			raw:     `<message id="m1">hello</message><action id="a1" kind="image"><prompt-payload kind="image"><prompt-text>clip</prompt-text><style>oil</style></prompt-payload></action>`,
			wantErr: "unsupported APML action tag <style>",
		},
		{
			raw:     `<message id="m1">hello</message><action id="a1" kind="image"><prompt-payload kind="image"><prompt-text>clip</prompt-text></prompt-payload><prompt-payload kind="image"><prompt-text>again</prompt-text></prompt-payload></action>`,
			wantErr: "exactly one prompt-payload",
		},
	}
	for _, tt := range cases {
		if _, err := parsePublicChatStructuredEnvelope(tt.raw); err == nil || !strings.Contains(err.Error(), tt.wantErr) {
			t.Fatalf("expected error containing %q for %s, got %v", tt.wantErr, tt.raw, err)
		}
	}
}

func TestParsePublicChatAPMLOutputRejectsWrappersAndXMLControls(t *testing.T) {
	cases := []struct {
		raw     string
		wantErr string
	}{
		{
			raw:     "```xml\n<message id=\"m1\">hello</message>\n```",
			wantErr: "APML beginning with <message>",
		},
		{
			raw:     "Here is the response:\n<message id=\"m1\">hello</message>",
			wantErr: "APML beginning with <message>",
		},
		{
			raw:     `<message id="m1">hello</message><!-- hidden -->`,
			wantErr: "must not contain comments",
		},
		{
			raw:     `<message id="m1">hello</message><?hidden value?>`,
			wantErr: "processing instructions or directives",
		},
		{
			raw:     `<message id="m1">hello</message><!DOCTYPE apml>`,
			wantErr: "processing instructions or directives",
		},
		{
			raw:     `<apml:message xmlns:apml="urn:test" id="m1">hello</apml:message>`,
			wantErr: "APML beginning with <message>",
		},
		{
			raw:     `<message xmlns="urn:test" id="m1">hello</message>`,
			wantErr: "namespace is not admitted",
		},
		{
			raw:     `<message id="m1">hello &nbsp;</message>`,
			wantErr: "APML output invalid",
		},
	}
	for _, tt := range cases {
		if _, err := parsePublicChatStructuredEnvelope(tt.raw); err == nil || !strings.Contains(err.Error(), tt.wantErr) {
			t.Fatalf("expected error containing %q for %s, got %v", tt.wantErr, tt.raw, err)
		}
	}
}

func TestParsePublicChatAPMLOutputRejectsInvalidEventHook(t *testing.T) {
	cases := []string{
		`<message id="m1">hello</message><event-hook id="h1"><effect kind="follow-up-turn"><prompt-text>continue</prompt-text></effect></event-hook>`,
		`<message id="m1">hello</message><event-hook id="h1"><event-user-idle/><effect kind="follow-up-turn"><prompt-text>continue</prompt-text></effect></event-hook>`,
		`<message id="m1">hello</message><event-hook id="h1"><event-user-idle idle-for="600s"/><event-chat-ended/><effect kind="follow-up-turn"><prompt-text>continue</prompt-text></effect></event-hook>`,
		`<message id="m1">hello</message><event-hook id="h1"><delay-ms>250</delay-ms><effect kind="follow-up-turn"><prompt-text>continue</prompt-text></effect></event-hook>`,
		`<message id="m1">hello</message><time-hook id="h1"><delay-ms>250</delay-ms></time-hook>`,
		`<message id="m1">hello</message><time-hook id="h1"><delay-ms>250</delay-ms><effect kind="follow-up-turn"></effect></time-hook>`,
		`<message id="m1">hello</message><time-hook id="h1"><effect kind="follow-up-turn"><delay-ms>250</delay-ms><prompt-text>continue</prompt-text></effect></time-hook>`,
		`<message id="m1">hello</message><event-hook id="h1"><effect kind="follow-up-turn"><event-chat-ended/><prompt-text>continue</prompt-text></effect></event-hook>`,
	}
	for _, raw := range cases {
		if _, err := parsePublicChatStructuredEnvelope(raw); err == nil {
			t.Fatalf("expected invalid event-hook rejection for %s", raw)
		}
	}
}

func TestParsePublicChatAPMLOutputRejectsPrivateDialectRoot(t *testing.T) {
	raw := `<life-turn><summary>private only</summary><canonical-memory-candidates></canonical-memory-candidates></life-turn>`
	if _, err := parsePublicChatStructuredEnvelope(raw); err == nil || !strings.Contains(err.Error(), "APML beginning with <message>") {
		t.Fatalf("expected private dialect root rejection, got %v", err)
	}
}

func TestParsePublicChatJSONOutputIsNotModelFacingCompatibility(t *testing.T) {
	raw := `{"schemaId":"nimi.agent.chat.message-action.v1","message":{"messageId":"m1","text":"hello"},"actions":[{"actionId":"v1","actionIndex":0,"actionCount":1,"modality":"video","operation":"video.generate","promptPayload":{"kind":"video-prompt","promptText":"clip"},"sourceMessageId":"m1","deliveryCoupling":"after-message"}]}`
	if _, err := parsePublicChatStructuredEnvelope(raw); err == nil || !strings.Contains(err.Error(), "APML beginning with <message>") {
		t.Fatalf("expected JSON output rejection, got %v", err)
	}
}
