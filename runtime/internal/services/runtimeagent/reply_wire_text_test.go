package runtimeagent

import (
	"strings"
	"testing"
	"time"
)

func TestNestedPrivateReplyElementsKeepTheirOuterBoundary(t *testing.T) {
	for _, hidden := range []string{
		"<think>PRIVATE_OUTER <think>PRIVATE_INNER</think> PRIVATE_REMAINDER</think>",
		"<think>PRIVATE_OUTER <think/> PRIVATE_REMAINDER</think>",
		"<think><response>PRIVATE_INNER</response> PRIVATE_REMAINDER</think>",
	} {
		body := "Before " + hidden + " after."
		for _, raw := range []string{body, `<message intent="reply">` + body + `</message>`} {
			reply, err := parsePublicChatStructuredEnvelope(raw)
			if err != nil || reply.Message.Text != "Before  after." || len(reply.Actions) != 0 || reply.SelfIntentionRaw != "" {
				t.Fatalf("nested private content changed public reply: %+v %v", reply, err)
			}
			for i := 1; i <= len(raw); i++ {
				visible, _ := publicChatStreamingMessageText(raw[:i])
				if strings.Contains(visible, "PRIVATE") {
					t.Fatalf("nested private stream leaked at %d: %q", i, visible)
				}
			}
		}
		visible, private := realtimeReplyProjection(body)
		if visible != "Before  after." || !private {
			t.Fatalf("nested realtime projection: %q private=%v", visible, private)
		}
	}
}

func TestEOFFencedReplyRemainsInsideThePublicBody(t *testing.T) {
	for _, body := range []string{
		"Example:\n```xml\n<action>literal</action>",
		"Example:\n   ~~~xml\n<self-intention>literal</self-intention>",
	} {
		for _, raw := range []string{body, `<message intent="reply">` + body + `</message>`} {
			reply, err := parsePublicChatStructuredEnvelope(raw)
			if err != nil || reply.Message.Text != body || len(reply.Actions) != 0 || reply.IntentionSuggested {
				t.Fatalf("EOF code changed or became an effect: %+v %v", reply, err)
			}
			for i := 1; i <= len(raw); i++ {
				visible, _ := publicChatStreamingMessageText(raw[:i])
				if !strings.HasPrefix(body, visible) {
					t.Fatalf("EOF code stream changed at %d: %q", i, visible)
				}
			}
		}
		// An APML body end still wins over a code fence: tail payloads never
		// become public code, and the optional suggestion remains unmodified.
		tail := `<self-intention>{"action":"adopt","title":"PRIVATE_DIRECTION","kind":"project"}</self-intention><intention-confirmation>PRIVATE_CONFIRMATION</intention-confirmation>`
		reply, err := parsePublicChatStructuredEnvelope(`<message intent="reply">` + body + `</message>` + tail)
		if err != nil || reply.Message.Text != body || !reply.IntentionSuggested || reply.IntentionConfirmation != "PRIVATE_CONFIRMATION" {
			t.Fatalf("fence crossed the body/effect boundary: %+v %v", reply, err)
		}
	}
}

func TestPlainReplyAutolinksAndLiteralCodeStayPublic(t *testing.T) {
	for _, raw := range []string{"<https://example.com>\nA page.", "<reader@example.com>", "Use `<self-intention>` as literal code.", "Example:\n```xml\n<action>literal</action>\n```"} {
		reply, err := parsePublicChatStructuredEnvelope(raw)
		if err != nil || reply.Message.Text != raw || len(reply.Actions) != 0 || reply.SelfIntentionRaw != "" {
			t.Fatalf("ordinary content changed: %+v %v", reply, err)
		}
		for i := range raw {
			visible, _ := publicChatStreamingMessageText(raw[:i])
			if !strings.HasPrefix(raw, visible) {
				t.Fatalf("stream changed literal code: %q", visible)
			}
		}
	}
}

func TestAPMLReplyKeepsLiteralMarkdownTags(t *testing.T) {
	encoded, err := parsePublicChatStructuredEnvelope(`<message intent="reply">Use ` + "`&lt;time-hook&gt;`" + ` as code.</message>`)
	if err != nil || encoded.Message.Text != "Use `<time-hook>` as code." {
		t.Fatalf("already escaped code changed: %+v %v", encoded, err)
	}
	for _, body := range []string{"Use `<time-hook>` as a literal example.", "Example:\n```xml\n<action>literal</action>\n```", "`<query>literal</query>`"} {
		raw := `<message intent="reply">` + body + `</message>`
		reply, err := parsePublicChatStructuredEnvelope(raw)
		if err != nil || reply.Message.Text != body || len(reply.Actions) != 0 {
			t.Fatalf("public code changed: %+v %v", reply, err)
		}
		for i := range raw {
			visible, _ := publicChatStreamingMessageText(raw[:i])
			if !strings.HasPrefix(body, visible) {
				t.Fatalf("public code stream changed: %q", visible)
			}
		}
	}
}

func TestInvalidExperienceKeepsIndependentReplyWithoutAConfirmation(t *testing.T) {
	raw := `<message intent="reply">An ordinary reply.</message><self-intention>{"action":"change","activity_ref":"existing","title":"New study","experience":{"action":"create","object":"Cloud study","result":"direction_changed"}}</self-intention><intention-confirmation>PRIVATE_CONFIRMATION</intention-confirmation>`
	reply, err := parsePublicChatStructuredEnvelope(raw)
	if err != nil || reply.Message.Text != "An ordinary reply." {
		t.Fatalf("invalid experience affected ordinary reply: %+v %v", reply, err)
	}
	if _, err := decodeSelfIntention(reply.SelfIntentionRaw); err == nil {
		t.Fatal("missing outcome was accepted as an experience")
	}
}

func TestReplyProjectionMarkdownCodeExamplePreserved(t *testing.T) {
	raw := "Use `<time-hook><delay-ms>1000</delay-ms></time-hook>` inline."
	reply, err := parsePublicChatStructuredEnvelope(raw)
	if err != nil {
		t.Fatalf("ordinary Markdown code example rejected: %v", err)
	}
	if len(reply.Actions) != 0 {
		t.Fatalf("ordinary Markdown code example produced effects: %#v", reply.Actions)
	}
	if reply.Message.Text != raw {
		t.Fatalf("ordinary Markdown code example changed: got %q want %q", reply.Message.Text, raw)
	}
}

func TestReplyProjectionRealtimeTrailingPrivateFragmentHidden(t *testing.T) {
	visible, private := realtimeReplyProjection("好的。<action>change</action>")
	if visible != "好的。" || !private {
		t.Fatalf("trailing private fragment leaked: visible=%q private=%v", visible, private)
	}
}

func TestReplyProjectionProbeControls(t *testing.T) {
	visible, private := realtimeReplyProjection("<action>change</action>好的。")
	if visible != "好的。" || !private {
		t.Fatalf("leading-fragment control failed: visible=%q private=%v", visible, private)
	}
	raw := "风速 2 > 1，不代表风更自由。"
	reply, err := parsePublicChatStructuredEnvelope(raw)
	if err != nil || reply.Message.Text != raw {
		t.Fatalf("ordinary comparison control failed: reply=%#v err=%v", reply, err)
	}
}

func TestReplyBoundaryLiteralAPML(t *testing.T) {
	cases := []struct{ name, body, want string }{
		{"autolink", "Visit <https://example.com> after.", "Visit <https://example.com> after."},
		{"email", "Write <reader@example.com> after.", "Write <reader@example.com> after."},
		{"code_raw_amp", "Use `a && b` after.", "Use `a && b` after."},
		{"code_entity", "Use `&lt;time-hook&gt; &amp; a` after.", "Use `<time-hook> & a` after."},
		{"code_double_entity", "Use `&amp;lt;time-hook&amp;gt;` after.", "Use `&lt;time-hook&gt;` after."},
		{"code_link", "Visit `<https://example.com>` after.", "Visit `<https://example.com>` after."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw := `<message intent="reply">` + tc.body + `</message>`
			got, err := parsePublicChatStructuredEnvelope(raw)
			stream, _ := publicChatStreamingMessageText(raw)
			if got == nil {
				t.Fatalf("reply=nil err=%v stream=%q", err, stream)
			}
			t.Logf("final=%q err=%v stream=%q", got.Message.Text, err, stream)
			if err != nil || got.Message.Text != tc.want || stream != tc.want {
				t.Errorf("literal body changed; want %q", tc.want)
			}
		})
	}
}

func TestReplyBoundaryUnclosedCodeCannotExposePrivateTail(t *testing.T) {
	raw := "<message intent=\"reply\">A stray ` in public text.</message>" + `<self-intention>{"action":"adopt","title":"Private direction","kind":"project"}</self-intention><intention-confirmation>PRIVATE_UNCOMMITTED_CONFIRMATION</intention-confirmation>`
	direct := interpretPublicChatXML(raw)
	reply, err := parsePublicChatStructuredEnvelope(raw)
	stream, _ := publicChatStreamingMessageText(raw)
	if reply == nil {
		t.Fatalf("reply=nil err=%v stream=%q", err, stream)
	}
	t.Logf("final=%q err=%v stream=%q suggested=%v raw=%q; originalXML text=%q suggested=%v complete=%v err=%v", reply.Message.Text, err, stream, reply.IntentionSuggested, reply.SelfIntentionRaw, direct.Envelope.Message.Text, direct.Envelope.IntentionSuggested, direct.BodyComplete, direct.Err)
	if strings.Contains(reply.Message.Text, "PRIVATE_UNCOMMITTED_CONFIRMATION") || strings.Contains(stream, "PRIVATE_UNCOMMITTED_CONFIRMATION") {
		t.Error("uncommitted private tail became public text")
	}
}

func TestReplyBoundarySanitizerCannotRepairEffectAction(t *testing.T) {
	raw := `<message intent="reply">Independent.</message><self-intention>{"action":"ad<think>private</think>opt","title":"Cloud study","kind":"project"}</self-intention><intention-confirmation>I adopted it.</intention-confirmation>`
	direct := interpretPublicChatXML(raw)
	reply, err := parsePublicChatStructuredEnvelope(raw)
	if reply == nil {
		t.Fatalf("reply=nil err=%v", err)
	}
	p, decodeErr := decodeSelfIntention(reply.SelfIntentionRaw)
	t.Logf("originalXML error=%v raw=%q; filtered raw=%q ControlError=%q decode=%v", direct.Err, direct.Envelope.SelfIntentionRaw, reply.SelfIntentionRaw, reply.ControlError, decodeErr)
	if decodeErr == nil && reply.ControlError == "" {
		state := newAgentLifeState()
		accepted, acceptErr := acceptSelfIntention(state, p, time.Now().UTC())
		t.Logf("owner accepted=%+v err=%v activities=%d", accepted, acceptErr, len(state.Activities))
		t.Error("public sanitizer converted an invalid effect into an admissible action")
	}
}

func TestReplyScopePrivateTailCannotClosePublicCode(t *testing.T) {
	for _, tc := range []struct{ name, tail string }{
		{"title_tick", "<self-intention>{\"action\":\"adopt\",\"title\":\"PRIVATE ` direction\",\"kind\":\"project\"}</self-intention><intention-confirmation>UNACCEPTED_CONFIRMATION</intention-confirmation>"},
		{"confirmation_tick", "<self-intention>{\"action\":\"adopt\",\"title\":\"PRIVATE direction\",\"kind\":\"project\"}</self-intention><intention-confirmation>UNACCEPTED_CONFIRMATION `</intention-confirmation>"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := "A stray ` in public text."
			raw := `<message intent="reply">` + body + `</message>` + tc.tail
			direct := interpretPublicChatXML(raw)
			decoded, decodeErr := decodeSelfIntention(direct.Envelope.SelfIntentionRaw)
			state := newAgentLifeState()
			accepted, acceptErr := acceptSelfIntention(state, decoded, time.Now().UTC())
			if direct.Err != nil || !direct.BodyComplete || decodeErr != nil || acceptErr != nil || !accepted.Accepted {
				t.Fatalf("raw tail is not valid: direct=%v decode=%v accepted=%+v err=%v", direct.Err, decodeErr, accepted, acceptErr)
			}
			final, err := parsePublicChatStructuredEnvelope(raw)
			stream, _ := publicChatStreamingMessageText(raw)
			t.Logf("direct body=%q complete=%v suggestion=%v err=%v rawOwnerAccepted=%v", direct.Envelope.Message.Text, direct.BodyComplete, direct.Envelope.IntentionSuggested, direct.Err, accepted.Accepted)
			if final == nil {
				t.Fatalf("final nil err=%v", err)
			}
			t.Logf("final=%q stream=%q suggestion=%v control=%q err=%v", final.Message.Text, stream, final.IntentionSuggested, final.ControlError, err)
			if final.Message.Text != body || stream != body {
				t.Error("private tail crossed the closed message boundary")
			}
		})
	}
}

func TestReplyScopeAPMLPublicCharacters(t *testing.T) {
	for _, body := range []string{"Research at R&D continues.", "Use AT&T after.", "Try a&b then c.", "Visit <https://example.com?a=1&b=2> after.", "Use `a && b` after.", "Write <reader@example.com> after.", "Use `</message>` as a literal closing tag."} {
		t.Run(body, func(t *testing.T) {
			raw := `<message intent="reply">` + body + `</message>`
			final, err := parsePublicChatStructuredEnvelope(raw)
			stream, _ := publicChatStreamingMessageText(raw)
			if final == nil {
				t.Fatalf("nil final err=%v stream=%q", err, stream)
			}
			t.Logf("final=%q stream=%q err=%v", final.Message.Text, stream, err)
			if final.Message.Text != body || stream != body {
				t.Error("ordinary public text was changed")
			}
		})
	}
	for _, body := range []string{"Research at R&D continues.", "Use AT&T after."} {
		plain, err := parsePublicChatStructuredEnvelope(body)
		encoded, encodedErr := parsePublicChatStructuredEnvelope(`<message intent="reply">` + strings.ReplaceAll(body, "&", "&amp;") + `</message>`)
		t.Logf("amp controls plain=%q err=%v encoded=%q err=%v", plain.Message.Text, err, encoded.Message.Text, encodedErr)
		if err != nil || encodedErr != nil || plain.Message.Text != body || encoded.Message.Text != body {
			t.Error("amp positive control failed")
		}
	}
}

func TestReplyScopeClosedLiteralCodeHasMonotonicStream(t *testing.T) {
	body := "Example `<think>literal</think> more` then continue."
	for _, raw := range []string{body, `<message intent="reply">` + body + `</message>`} {
		var firstMismatch string
		for i := 1; i <= len(raw); i++ {
			visible, _ := publicChatStreamingMessageText(raw[:i])
			if !strings.HasPrefix(body, visible) {
				firstMismatch = visible
				break
			}
		}
		final, err := parsePublicChatStructuredEnvelope(raw)
		t.Logf("raw=%q firstNonPrefix=%q final=%q err=%v", raw, firstMismatch, final.Message.Text, err)
		if firstMismatch != "" {
			t.Error("valid code exposes a stream that is not a prefix of final text")
		}
	}
}

func TestReplyBodyClosingTagLiteralDoesNotConsumeEffectTail(t *testing.T) {
	body := "Use `</message>` as literal code."
	tail := `<self-intention>{"action":"adopt","title":"Cloud study","kind":"project"}</self-intention><intention-confirmation>Accepted ` + "`" + `</intention-confirmation>`
	reply, err := parsePublicChatStructuredEnvelope(`<message intent="reply">` + body + `</message>` + tail)
	if err != nil || reply.Message.Text != body || !reply.IntentionSuggested || reply.ControlError != "" {
		t.Fatalf("body/tail partition changed: %+v %v", reply, err)
	}
	raw := "<message intent=\"reply\">A stray `.</message>invalid trailer " + tail + `</message>`
	reply, err = parsePublicChatStructuredEnvelope(raw)
	if err != nil || strings.Contains(reply.Message.Text, "self-intention") || strings.Contains(reply.Message.Text, "Accepted") {
		t.Fatalf("invalid tail reopened body: %+v %v", reply, err)
	}
}
