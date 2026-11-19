package runtimeagent

import (
	"strings"
	"testing"
)

func TestPublicChatStreamingMessageTextProjectsOnlySafeMessageCharacters(t *testing.T) {
	cases := []struct {
		raw   string
		text  string
		valid bool
	}{
		{raw: `<mes`, text: "", valid: false},
		{raw: `<message intent="reply" id="m1"><emotion>happy</emotion>hello`, text: "hello", valid: true},
		{raw: `<message intent="reply" id="m1"><activity>greet</activity>hello &amp; world</message><action id="a1" kind="image"><prompt-payload kind="image"><prompt-text>private prompt</prompt-text></prompt-payload></action>`, text: "hello & world", valid: true},
		{raw: `<message intent="reply" id="m1">hello<pause>secret</pause>`, text: "hello", valid: true},
		{raw: `<message intent="reply" id="m1">hello<!-- hidden -->`, text: "hello", valid: true},
		{raw: `<message intent="reply" id="m1"><activity>listening</activity>hello</activity>`, text: "hello", valid: true},
	}
	for _, test := range cases {
		text, valid := publicChatStreamingMessageText(test.raw)
		if text != test.text || valid != test.valid {
			t.Fatalf("projection(%q) = %q, %v", test.raw, text, valid)
		}
	}
}

func TestPublicChatStreamingPrefixIsIndependentOfChunks(t *testing.T) {
	for _, raw := range []string{
		`<message intent="reply">Hello</activity>`,
		`<message intent="reply">Hello</message></action>`,
		`<message intent="reply">A &amp; B &broken;</message>`,
		`<message intent="reply">你好 &lt;emotion&gt; 字面标签</message><action kind="image">`,
		`<message intent="reply"><emotion>happy Hello`,
		`<message intent="reply">Hello<!-- hidden -->`,
		`<message intent="reply">Hello<query>private</query></message>`,
		`<message intent="recall"><query>private</query></message>`,
		`<message intent="reply">three ]]></message>`,
	} {
		want, _ := publicChatStreamingMessageText(raw)
		for split := 0; split <= len(raw); split++ {
			first, _ := publicChatStreamingMessageText(raw[:split])
			if !strings.HasPrefix(want, first) {
				t.Fatalf("non-monotone prefix at %d: first=%q final=%q raw=%q", split, first, want, raw)
			}
			final, _ := publicChatStreamingMessageText(raw)
			if first+final[len(first):] != want {
				t.Fatalf("chunk changed public body: %q", raw)
			}
		}
	}
}

func TestFencedAPMLPublishesDeterminedBodyBeforeCompletion(t *testing.T) {
	header := "```xml\n" + `<message intent="reply" id="message-fenced">`
	for _, raw := range []string{
		header + "Hello</message>\n```",
		header + "A &amp; B</message>\n```",
		"Example `<think>private</think>`` more",
		"Example ``<action>literal</action>`` after",
		"Example:\n```xml\n<action>code</action>\n```",
		"<message intent=\"reply\">Example:\n```xml\n&amp; &lt;action&gt;\n```</message>",
	} {
		reply, err := parsePublicChatStructuredEnvelope(raw)
		if err != nil {
			t.Fatal(err)
		}
		prev := ""
		for split := 1; split <= len(raw); split++ {
			got, _ := publicChatStreamingMessageText(raw[:split])
			if !strings.HasPrefix(reply.Message.Text, got) || !strings.HasPrefix(got, prev) {
				t.Fatalf("raw=%q split=%d previous=%q got=%q final=%q", raw, split, prev, got, reply.Message.Text)
			}
			prev = got
		}
	}
	if text, _ := publicChatStreamingMessageText(header + "Hello"); text != "Hello" {
		t.Fatalf("body held until completion: %q", text)
	}
}

func TestStreamingOptimizationAgreesWithInterpreterAtEverySplit(t *testing.T) {
	for _, body := range []string{"hello world", "hello &amp; goodbye", "hello `<think>literal</think>` then", "hello <think>never public</think> friend", "hello\r\nworld", "hello " + string(rune(0xfffe)), "hello 中文", "hello ]]>", "hello <query>private</query>"} {
		raw := `<message intent="reply">` + body + "</message>"
		var p publicChatStreamingProjection
		for end := 1; end <= len(raw); end++ {
			got, ok := p.text(raw[:end], raw[end-1:end])
			want, valid := publicChatStreamingMessageText(raw[:end])
			if got != want || ok != valid {
				t.Fatalf("split %d: %q/%v want %q/%v", end, got, ok, want, valid)
			}
		}
	}
}

func BenchmarkAPMLFragmentedPublicReply(b *testing.B) {
	header := `<message intent="reply">`
	body := strings.Repeat("the island light ", 1024)[:16*1024]
	raw := header + body
	for _, mode := range []string{"interpreter", "stream"} {
		b.Run(mode, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				var p publicChatStreamingProjection
				for end := len(header) + 16; end <= len(raw); end += 16 {
					if mode == "stream" {
						p.text(raw[:end], raw[end-16:end])
					} else {
						publicChatStreamingMessageText(raw[:end])
					}
				}
			}
		})
	}
}
