package runtimeagent

import (
	"encoding/xml"
	"io"
	"strings"
)

// publicChatStreamingMessageText projects only direct character data inside
// the first APML <message> root. It never exposes markup, emotion/activity
// content, action prompts, or provider reasoning. Incomplete XML is treated as
// a partial prefix; structurally invalid input stops further projection and is
// still rejected by the final canonical APML parser.
func publicChatStreamingMessageText(raw string) (string, bool) {
	decoder := xml.NewDecoder(strings.NewReader(strings.TrimLeft(raw, " \t\r\n")))
	decoder.Strict = true
	depth := 0
	rootSeen := false
	rootClosed := false
	var text strings.Builder
	for {
		token, err := decoder.Token()
		if err != nil {
			if err == io.EOF || (rootSeen && strings.Contains(err.Error(), "unexpected EOF")) {
				return text.String(), rootSeen
			}
			return "", false
		}
		if rootClosed {
			// The public text projection is complete once the first message
			// closes. Later top-level APML belongs to owner action handling and
			// must neither invalidate nor enter the text stream.
			return text.String(), true
		}
		switch item := token.(type) {
		case xml.StartElement:
			if item.Name.Space != "" {
				return "", false
			}
			if !rootSeen {
				if item.Name.Local != "message" {
					return "", false
				}
				rootSeen = true
				depth = 1
				continue
			}
			depth++
			if depth == 2 && item.Name.Local != "emotion" && item.Name.Local != "activity" {
				return "", false
			}
			if depth > 2 {
				return "", false
			}
		case xml.EndElement:
			if !rootSeen || depth <= 0 {
				return "", false
			}
			if depth == 1 {
				if item.Name.Local != "message" {
					return "", false
				}
				rootClosed = true
			}
			depth--
		case xml.CharData:
			if rootSeen && !rootClosed && depth == 1 {
				text.Write([]byte(item))
			}
		case xml.Comment, xml.Directive, xml.ProcInst:
			return "", false
		}
	}
}
