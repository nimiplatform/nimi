package runtimeagent

import (
	"strings"
	"testing"
)

func TestPublicChatAPMLPreservesMessageLayout(t *testing.T) {
	for _, body := range []string{
		"进展：资料已整理。\n\n需要你决定：\n1. 选择受众\n2. 确认截止时间",
		"- 第一项\n  - 子项\n\n```text\n  保留  缩进\n```",
		"第一段\r\n\r\n第二段",
	} {
		t.Run(body, func(t *testing.T) {
			envelope, err := parsePublicChatAPMLOutput("<message id=\"message-layout\">\n" + body + "\n</message>")
			if err != nil {
				t.Fatal(err)
			}
			want := strings.ReplaceAll(body, "\r\n", "\n")
			if envelope.Message.Text != want {
				t.Fatalf("message layout changed: got %q, want %q", envelope.Message.Text, want)
			}
		})
	}
}
