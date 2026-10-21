package runtimeagent

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestParsePublicChatAPMLOutputMessageAndRuntimeIdentity(t *testing.T) {
	raw := `<message intent="reply" id="model-message"><emotion>happy</emotion><activity>greet</activity>Hello APML.</message><action id="model-action" kind="image"><prompt-payload kind="image"><prompt-text>a sunrise</prompt-text></prompt-payload></action>`
	envelope, err := parsePublicChatStructuredEnvelope(raw)
	if err != nil || envelope.ControlError != "" {
		t.Fatalf("parse: %#v %v", envelope, err)
	}
	assignPublicChatOutputIdentities(envelope, "turn-one")
	if envelope.Message.Text != "Hello APML." || envelope.Message.MessageID == "model-message" || envelope.Message.MessageID == "" {
		t.Fatalf("public body/identity: %#v", envelope.Message)
	}
	if envelope.StatusCue == nil || envelope.StatusCue.Mood != "happy" || envelope.StatusCue.ActionCue != "greet" ||
		envelope.StatusCue.SourceMessageID != envelope.Message.MessageID {
		t.Fatalf("cue: %#v", envelope.StatusCue)
	}
	if len(envelope.Actions) != 1 {
		t.Fatalf("actions: %#v", envelope.Actions)
	}
	action := envelope.Actions[0]
	if action.ActionID == "model-action" || action.ActionID == "" || action.SourceMessageID != envelope.Message.MessageID ||
		action.Modality != "image" || action.Operation != "image.generate" || action.PromptPayload.PromptText != "a sunrise" ||
		action.ActionIndex != 0 || action.ActionCount != 1 {
		t.Fatalf("action: %#v", action)
	}
	other, err := parsePublicChatStructuredEnvelope(strings.ReplaceAll(raw, "model-", "untrusted-"))
	if err != nil {
		t.Fatal(err)
	}
	assignPublicChatOutputIdentities(other, "turn-one")
	if other.Message.MessageID != envelope.Message.MessageID || other.Actions[0].ActionID != action.ActionID {
		t.Fatal("model selected product identity")
	}
	assignPublicChatOutputIdentities(other, "turn-two")
	if other.Message.MessageID == envelope.Message.MessageID || other.Actions[0].ActionID == action.ActionID {
		t.Fatal("different turns share product identity")
	}
}

func TestParsePublicChatAPMLOutputOptionalCuesFailLocally(t *testing.T) {
	cases := []struct{ cue, mood, activity string }{
		{"", "", ""},
		{`<emotion>curious</emotion>`, "", ""},
		{`<activity>wave</activity>`, "", ""},
		{`<emotion>happy</emotion><emotion>shy</emotion><activity>greet</activity>`, "", "greet"},
		{`<emotion>happy</emotion><activity>greet</activity><activity>idle</activity>`, "happy", ""},
		{`<emotion intensity="high">happy</emotion><activity>greet</activity>`, "", "greet"},
		{`<emotion><nested>happy</nested></emotion>`, "", ""},
	}
	for _, tc := range cases {
		envelope, err := parsePublicChatStructuredEnvelope("<message intent=\"reply\">" + tc.cue + "hello</message>")
		if err != nil || envelope.Message.Text != "hello" || envelope.ControlError != "" {
			t.Fatalf("cue %q discarded body: %#v %v", tc.cue, envelope, err)
		}
		if tc.mood == "" && tc.activity == "" {
			if envelope.StatusCue != nil {
				t.Fatalf("invalid cue adopted: %#v", envelope.StatusCue)
			}
		} else if envelope.StatusCue == nil || envelope.StatusCue.Mood != tc.mood || envelope.StatusCue.ActionCue != tc.activity {
			t.Fatalf("independent cue lost: %#v", envelope.StatusCue)
		}
	}
}

func TestParsePublicChatAPMLOutputTimeHookBecomesFollowUpIntent(t *testing.T) {
	raw := `<message intent="reply">I will check later.</message><time-hook><delay-ms>250</delay-ms></time-hook>`
	envelope, err := parsePublicChatStructuredEnvelope(raw)
	if err != nil || envelope.ControlError != "" || len(envelope.Actions) != 1 {
		t.Fatalf("parse hook: %#v %v", envelope, err)
	}
	intent, err := publicChatHookIntentFromAction(&envelope.Actions[0], "agent-1")
	if err != nil || intent.GetTriggerFamily() != runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME ||
		intent.GetTriggerDetail().GetTime().GetDelay().AsDuration().Milliseconds() != 250 {
		t.Fatalf("hook: %#v %v", intent, err)
	}
	detail := publicChatPostTurnIndicationDetail(envelope, publicChatFollowUpOutcome{Status: "proposed"})
	hook, ok := detail["hook_intent"].(map[string]any)
	if !ok || hook["admission_state"] != "proposed" {
		t.Fatalf("proposal is not execution: %#v", detail)
	}
	for _, key := range []string{"follow_up_id", "scheduled_for", "status", "reason_code", "trace_id"} {
		if _, exists := hook[key]; exists {
			t.Fatalf("proposal leaked execution field %s", key)
		}
	}
}

func TestParsePublicChatAPMLOutputRejectsControlBatchButRetainsBody(t *testing.T) {
	image := `<action kind="image"><prompt-payload kind="image"><prompt-text>clip</prompt-text></prompt-payload></action>`
	cases := []string{
		`<action kind="image">`,
		`</action>`,
		`<unknown/>`,
		`<!-- hidden -->`,
		`<?hidden value?>`,
		`<!DOCTYPE apml>`,
		`<emotion>happy</emotion>`,
		`<message intent="reply">second message</message>`,
		`<action kind="voice"><prompt-payload kind="voice"><prompt-text>say it</prompt-text></prompt-payload></action>`,
		`<action kind="video"><prompt-payload kind="video"><prompt-text>clip</prompt-text></prompt-payload></action>`,
		`<action kind="image" priority="high"><prompt-payload kind="image"><prompt-text>clip</prompt-text></prompt-payload></action>`,
		`<action kind="image" operation="image.generate"><prompt-payload kind="image"><prompt-text>clip</prompt-text></prompt-payload></action>`,
		`<action kind="image" source-message="m1"><prompt-payload kind="image"><prompt-text>clip</prompt-text></prompt-payload></action>`,
		`<action kind="image" coupling="with-message"><prompt-payload kind="image"><prompt-text>clip</prompt-text></prompt-payload></action>`,
		`<action kind="image"><prompt-text>clip</prompt-text></action>`,
		`<action kind="image"><prompt-payload kind="image"></prompt-payload></action>`,
		`<action kind="image"><prompt-payload kind="image"><prompt-text>clip</prompt-text><style>oil</style></prompt-payload></action>`,
		`<action kind="image"><prompt-payload kind="image"><prompt-text>clip</prompt-text></prompt-payload><prompt-payload kind="image"><prompt-text>again</prompt-text></prompt-payload></action>`,
		image + `<action kind="image">`,
		image + image,
		`<time-hook><delay-ms>250</delay-ms><effect kind="follow-up-turn">` + image + `<prompt-text>continue</prompt-text></effect></time-hook>`,
		`<time-hook><delay-ms>250</delay-ms><effect kind="follow-up-turn"><prompt-text>continue</prompt-text></effect>` + image + `</time-hook>`,
		`<time-hook mode="soft"><delay-ms>250</delay-ms><effect kind="follow-up-turn"><prompt-text>continue</prompt-text></effect></time-hook>`,
		`<time-hook><delay-ms>250</delay-ms><effect kind="follow-up-turn"><prompt-text>arbitrary delayed task</prompt-text></effect></time-hook>`,
		`<time-hook><delay-ms>250</delay-ms><effect kind="follow-up-turn"></effect></time-hook>`,
		`<time-hook><effect kind="follow-up-turn"><delay-ms>250</delay-ms><prompt-text>continue</prompt-text></effect></time-hook>`,
		`<event-hook><event-user-idle idle-for="600s"/><effect kind="follow-up-turn"><prompt-text>continue</prompt-text></effect></event-hook>`,
	}
	for _, tail := range cases {
		envelope, err := parsePublicChatStructuredEnvelope("<message intent=\"reply\">hello</message>" + tail)
		if err != nil || envelope.Message.Text != "hello" || len(envelope.Actions) != 0 || envelope.ControlError == "" {
			t.Fatalf("bad controls must not erase body or execute prefix: tail=%q envelope=%#v err=%v", tail, envelope, err)
		}
	}
}

func TestParsePublicChatAPMLOutputRejectsUnrecognizedBody(t *testing.T) {
	for _, raw := range []string{
		`<message intent="reply"><emotion>happy hello`,
		`<message intent="reply" xmlns="urn:test">hello</message>`,
		`<apml:message xmlns:apml="urn:test">hello</apml:message>`,
		`<emotion>happy</emotion><message intent="reply">hello</message>`,
		`<action kind="image"><prompt-text>clip</prompt-text></action><message intent="reply">hello</message>`,
		`<life-turn><summary>private only</summary></life-turn>`,
		`<message intent="recall"><query>private query</query></message>`,
	} {
		if _, err := parsePublicChatStructuredEnvelope(raw); err == nil {
			t.Fatalf("unrecognized/incomplete body accepted: %q", raw)
		}
	}
	// Unmarked JSON is ordinary text, never a former structured effect carrier.
	reply, err := parsePublicChatStructuredEnvelope(`{"message":{"text":"hello"}}`)
	if err != nil || reply.Message.Text != `{"message":{"text":"hello"}}` || len(reply.Actions) != 0 {
		t.Fatalf("plain JSON became an effect or lost its body: %+v %v", reply, err)
	}
	for _, attrs := range []string{"", ` id="m1"`, ` id="m1" id="m2"`, ` schema="unused"`} {
		envelope, err := parsePublicChatStructuredEnvelope("<message intent=\"reply\"" + attrs + ">hello</message>")
		if err != nil || envelope.Message.Text != "hello" {
			t.Fatalf("unused identity denied body: %#v %v", envelope, err)
		}
	}
}

func TestMalformedReplyDecorationKeepsOnlyStreamedPublicText(t *testing.T) {
	for _, raw := range []string{
		`<message intent="reply">hello<pause>secret</pause></message>`,
		`<message intent="reply">hello<surface>avatar</surface></message>`,
		`<message intent="reply"><emotion>happy</emotion>hello</activity>`,
		`<message intent="reply">hello &nbsp;</message>`,
		`<message intent="reply">hello`,
	} {
		body, err := parsePublicChatStructuredEnvelope(raw)
		if err != nil || body.Message.Text != "hello" || body.StatusCue != nil ||
			len(body.Actions) != 0 || body.IntentionSuggested || body.SelfIntentionRaw != "" || body.IntentionConfirmation != "" {
			t.Fatalf("malformed decoration discarded public text or retained effects: %+v %v", body, err)
		}
		streamed, visible := publicChatStreamingMessageText(raw)
		if !visible || streamed != body.Message.Text {
			t.Fatalf("stream/final text differs: %q %+v", streamed, body)
		}
	}
}

func TestPlainConversationReplyDoesNotNeedAnEffectEnvelope(t *testing.T) {
	raw := "暮色里留一点空白就好。"
	body, err := parsePublicChatStructuredEnvelope(raw)
	if err != nil || body.Message.Text != raw || len(body.Actions) != 0 || body.IntentionSuggested {
		t.Fatalf("plain reply rejected or became an effect: %+v %v", body, err)
	}
	for split := 1; split <= len([]rune(raw)); split++ {
		part := string([]rune(raw)[:split])
		if text, visible := publicChatStreamingMessageText(part); !visible || text != part {
			t.Fatal("plain reply waited for the final envelope")
		}
	}
}
