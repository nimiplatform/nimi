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
