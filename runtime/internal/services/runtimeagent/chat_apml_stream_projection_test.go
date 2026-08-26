package runtimeagent

import "testing"

func TestPublicChatStreamingMessageTextProjectsOnlySafeMessageCharacters(t *testing.T) {
	cases := []struct {
		raw   string
		text  string
		valid bool
	}{
		{raw: `<mes`, text: "", valid: false},
		{raw: `<message id="m1"><emotion>happy</emotion>hello`, text: "hello", valid: true},
		{raw: `<message id="m1"><activity>greet</activity>hello &amp; world</message><action id="a1" kind="image"><prompt-payload kind="image"><prompt-text>private prompt</prompt-text></prompt-payload></action>`, text: "hello & world", valid: true},
		{raw: `<message id="m1">hello<pause>secret</pause>`, text: "", valid: false},
		{raw: `<message id="m1">hello<!-- hidden -->`, text: "", valid: false},
	}
	for _, test := range cases {
		text, valid := publicChatStreamingMessageText(test.raw)
		if text != test.text || valid != test.valid {
			t.Fatalf("projection(%q) = %q, %v", test.raw, text, valid)
		}
	}
}
