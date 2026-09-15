package localexecution

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestTextAnnotationAcceptsLongCompleteDocument(t *testing.T) {
	const count = 9000
	text := strings.TrimSuffix(strings.Repeat("annotation ", count), " ")
	spec := &runtimev1.TextAnnotateScenarioSpec{Language: "en", Texts: []string{text}}
	doc := &runtimev1.TextAnnotationDocument{Text: text, Language: "en", Sentences: []*runtimev1.TextAnnotationSentence{{EndToken: count}}}
	for index := 0; index < count; index++ {
		doc.Tokens = append(doc.Tokens, &runtimev1.TextAnnotationToken{Text: "annotation", Start: uint32(index * 11), End: uint32(index*11 + 10), PartOfSpeech: "NOUN", Dependency: "dep"})
	}
	if err := ValidateTextAnnotationResult(&runtimev1.TextAnnotationResult{Documents: []*runtimev1.TextAnnotationDocument{doc}}, spec); err != nil {
		t.Fatal(err)
	}
}

func TestTextAnnotationPreservesUnicodeSourceAndRejectsBrokenSyntax(t *testing.T) {
	spec := &runtimev1.TextAnnotateScenarioSpec{Language: "en", Texts: []string{" 😀 hi ", ""}}
	result := &runtimev1.TextAnnotationResult{Documents: []*runtimev1.TextAnnotationDocument{{
		Text: spec.Texts[0], Language: "en",
		Tokens: []*runtimev1.TextAnnotationToken{
			{Text: "😀", Start: 1, End: 2, HeadIndex: 1, PartOfSpeech: "INTJ", Dependency: "intj"},
			{Text: "hi", Start: 3, End: 5, HeadIndex: 1, PartOfSpeech: "INTJ", Dependency: "ROOT"},
		},
		Sentences: []*runtimev1.TextAnnotationSentence{{StartToken: 0, EndToken: 2}},
	}, {Text: "", Language: "en"}}}
	if err := ValidateTextAnnotationResult(result, spec); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*runtimev1.TextAnnotationResult){
		"UTF16 offset":     func(r *runtimev1.TextAnnotationResult) { r.Documents[0].Tokens[0].End = 3 },
		"bad head":         func(r *runtimev1.TextAnnotationResult) { r.Documents[0].Tokens[0].HeadIndex = 2 },
		"missing sentence": func(r *runtimev1.TextAnnotationResult) { r.Documents[0].Sentences = nil },
		"changed source":   func(r *runtimev1.TextAnnotationResult) { r.Documents[0].Text = "changed" },
		"missing document": func(r *runtimev1.TextAnnotationResult) { r.Documents = r.Documents[:1] },
		"missing labels":   func(r *runtimev1.TextAnnotationResult) { r.Documents[0].Tokens[0].Dependency = "" },
	} {
		t.Run(name, func(t *testing.T) {
			bad := proto.Clone(result).(*runtimev1.TextAnnotationResult)
			change(bad)
			if err := ValidateTextAnnotationResult(bad, spec); err == nil {
				t.Fatal("invalid annotation accepted")
			}
		})
	}
}
