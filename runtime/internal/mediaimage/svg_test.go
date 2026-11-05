package mediaimage

import (
	"strings"
	"testing"
)

func TestStaticSVGPreservesVectorViewportAndRejectsActiveContent(t *testing.T) {
	valid := `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs><style>.a { fill: url('#g'); }</style><path class="a" d="M0 0L10 20"/><text x="4" y="20">Hello</text></svg>`
	w, h, err := InspectStaticSVG([]byte(valid), 4<<20)
	if err != nil || w != 640 || h != 480 {
		t.Fatalf("viewport %dx%d: %v", w, h, err)
	}
	viewBoxOnly := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><circle r="3"/></svg>`
	if w, h, err := InspectStaticSVG([]byte(viewBoxOnly), 4<<20); err != nil || w != 0 || h != 0 {
		t.Fatal("invented physical dimensions", w, h, err)
	}
	for name, content := range map[string]string{
		"script":           `<script>alert(1)</script>`,
		"raster":           `<image href="data:image/png;base64,abc"/>`,
		"foreign document": `<foreignObject/>`,
		"animation":        `<animate attributeName="x"/>`,
		"event":            `<path onload="alert(1)"/>`,
		"external use":     `<use href="https://example.com/x.svg#x"/>`,
		"external style":   `<style>path {fill:url(https://example.com/x)}</style>`,
		"comment escape":   `<style>path {fill:u/**/rl(https://example.com/x)}</style>`,
		"css escape":       `<style>path {fill:u\72l(https://example.com/x)}</style>`,
		"base":             `<g xml:base="https://example.com/"><use href="#x"/></g>`,
		"directive":        `<!DOCTYPE svg>`,
		"stylesheet":       `<?xml-stylesheet href="https://example.com/x"?>`,
		"nesting":          strings.Repeat("<g>", 65) + strings.Repeat("</g>", 65),
	} {
		t.Run(name, func(t *testing.T) {
			data := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">` + content + `</svg>`
			if _, _, err := InspectStaticSVG([]byte(data), 4<<20); err == nil {
				t.Fatal("unsafe vector admitted")
			}
		})
	}
	for _, data := range []string{valid + valid, strings.TrimSuffix(valid, "</svg>"), `<svg xmlns="http://www.w3.org/2000/svg"/>`, strings.Replace(viewBoxOnly, "640 480", "NaN 480", 1)} {
		if _, _, err := InspectStaticSVG([]byte(data), 4<<20); err == nil {
			t.Fatal("invalid SVG admitted")
		}
	}
	if _, _, err := InspectStaticSVG([]byte(valid), len(valid)-1); err == nil {
		t.Fatal("byte bound ignored")
	}
}
