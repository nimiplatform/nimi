package runtimeagent

import (
	"bufio"
	"bytes"
	"html"
	"strings"
	"unicode/utf8"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	extast "github.com/yuin/goldmark/extension/ast"
	goldhtml "github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
)

const conversationQuoteFormat = "nimi.quote-text.v1"
const conversationQuoteMaxBytes = 16 * 1024
const conversationQuoteMaxScalars = 4096
const conversationSnapshotClosureMaxBytes = 160 * 1024
const conversationReadWindowMaxBytes = 256 * 1024

// @nimi-authority: rule.nimi.runtime.conversation-message-interaction.quote-format
func conversationQuoteText(body string) (string, error) {
	if !utf8.ValidString(body) || len(body) > localAppConversationMaxTextBytes {
		return "", localAppConversationInvalid("quotation source text is invalid")
	}
	source := []byte(strings.ReplaceAll(strings.ReplaceAll(body, "\r\n", "\n"), "\r", "\n"))
	document := goldmark.New(goldmark.WithExtensions(extension.GFM)).Parser().Parse(text.NewReader(source))
	value := quoteNodeText(document, source)
	if len(value) > localAppConversationMaxTextBytes {
		return "", localAppConversationInvalid("quotation source text exceeds its bound")
	}
	return value, nil
}

func quoteNodeText(node ast.Node, source []byte) string {
	children := func(separator string) string {
		parts := make([]string, 0, node.ChildCount())
		for child := node.FirstChild(); child != nil; child = child.NextSibling() {
			value := quoteNodeText(child, source)
			if value != "" {
				parts = append(parts, value)
			}
		}
		return strings.Join(parts, separator)
	}
	switch value := node.(type) {
	case *ast.Image, *extast.TaskCheckBox, *ast.ThematicBreak:
		return ""
	case *ast.Text:
		result := string(value.Value(source))
		if !value.IsRaw() {
			result = quoteDecodedText([]byte(result))
		}
		if value.SoftLineBreak() || value.HardLineBreak() {
			result += "\n"
		}
		return result
	case *ast.String:
		if value.IsRaw() || value.IsCode() {
			return string(value.Value)
		}
		return quoteDecodedText(value.Value)
	case *ast.AutoLink:
		return string(value.Label(source))
	case *ast.CodeSpan:
		return strings.ReplaceAll(children(""), "\n", " ")
	case *ast.FencedCodeBlock, *ast.CodeBlock:
		var out strings.Builder
		for i := 0; i < node.Lines().Len(); i++ {
			line := node.Lines().At(i)
			out.Write(line.Value(source))
		}
		return strings.TrimSuffix(out.String(), "\n")
	case *ast.RawHTML:
		var out strings.Builder
		for i := 0; i < value.Segments.Len(); i++ {
			segment := value.Segments.At(i)
			out.Write(segment.Value(source))
		}
		return out.String()
	case *ast.HTMLBlock:
		return strings.TrimSuffix(string(value.Text(source)), "\n")
	case *ast.List:
		return children("\n")
	case *extast.Table:
		return children("\n")
	case *extast.TableHeader, *extast.TableRow:
		// Empty cells are meaningful columns and must not be skipped.
		parts := make([]string, 0, node.ChildCount())
		for child := node.FirstChild(); child != nil; child = child.NextSibling() {
			parts = append(parts, quoteNodeText(child, source))
		}
		return strings.Join(parts, "\t")
	case *ast.Document, *ast.Blockquote, *ast.ListItem:
		return children("\n\n")
	default:
		return children("")
	}
}

func quoteDecodedText(value []byte) string {
	// The CommonMark writer distinguishes escaped ampersands from entity references.
	// Decode its safely escaped output once; no HTML is executed or interpreted.
	var out bytes.Buffer
	writer := bufio.NewWriter(&out)
	goldhtml.NewWriter().Write(writer, value)
	_ = writer.Flush()
	return html.UnescapeString(out.String())
}
