package mediaimage

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

var svgElements = map[string]bool{"svg": true, "g": true, "path": true, "rect": true, "circle": true, "ellipse": true, "line": true, "polyline": true, "polygon": true, "text": true, "tspan": true, "textPath": true, "defs": true, "symbol": true, "use": true, "clipPath": true, "mask": true, "linearGradient": true, "radialGradient": true, "stop": true, "pattern": true, "marker": true, "title": true, "desc": true, "style": true, "filter": true, "feGaussianBlur": true, "feOffset": true, "feBlend": true, "feColorMatrix": true, "feComposite": true, "feFlood": true, "feMerge": true, "feMergeNode": true, "feDropShadow": true, "feComponentTransfer": true, "feFuncA": true, "feFuncR": true, "feFuncG": true, "feFuncB": true, "feMorphology": true, "feTurbulence": true, "feDisplacementMap": true, "feDiffuseLighting": true, "feSpecularLighting": true, "feDistantLight": true, "fePointLight": true, "feSpotLight": true}
var svgCSSComments = regexp.MustCompile(`(?s)/\*.*?\*/`)
var svgCSSURLs = regexp.MustCompile(`(?i)url\s*\(([^)]*)\)`)

func staticSVGValue(value string) bool {
	clean := svgCSSComments.ReplaceAllString(value, "")
	lower := strings.ToLower(clean)
	if strings.ContainsAny(clean, "\\@") || strings.Contains(lower, "expression(") || strings.Contains(lower, "behavior:") || strings.Contains(lower, "animation") || strings.Contains(lower, "transition") {
		return false
	}
	for _, m := range svgCSSURLs.FindAllStringSubmatch(clean, -1) {
		ref := strings.Trim(strings.TrimSpace(m[1]), "\"'")
		if !strings.HasPrefix(ref, "#") || len(ref) < 2 {
			return false
		}
	}
	return true
}

// @nimi-authority: rule.nimi.runtime.ai-provider.openai-image26
// SVG is admitted as static vector output, not as an executable document or
// a raster-input carrier. Returned bytes are validated, never silently edited.
func InspectStaticSVG(data []byte, maxBytes int) (int32, int32, error) {
	invalid := fmt.Errorf("SVG is not a bounded static vector document")
	if len(data) == 0 || len(data) > maxBytes || !utf8.Valid(data) {
		return 0, 0, invalid
	}
	decoder := xml.NewDecoder(bytes.NewReader(data))
	depth, nodes := 0, 0
	seen, closed := false, false
	var width, height int32
	viewport := false
	styleDepth := 0
	var style strings.Builder
	dimension := func(value string) int32 {
		value = strings.TrimSuffix(strings.TrimSpace(value), "px")
		n, err := strconv.ParseFloat(value, 64)
		if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n <= 0 || n > 8192 || math.Trunc(n) != n {
			return 0
		}
		return int32(n)
	}
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return 0, 0, invalid
		}
		switch t := token.(type) {
		case xml.StartElement:
			if closed || !svgElements[t.Name.Local] || t.Name.Space != "http://www.w3.org/2000/svg" {
				return 0, 0, invalid
			}
			if depth == 0 {
				if seen || t.Name.Local != "svg" {
					return 0, 0, invalid
				}
				seen = true
			}
			depth++
			nodes++
			if depth > 64 || nodes > 100000 || len(t.Attr) > 256 {
				return 0, 0, invalid
			}
			if t.Name.Local == "style" {
				if styleDepth != 0 {
					return 0, 0, invalid
				}
				styleDepth = depth
				style.Reset()
			}
			for _, a := range t.Attr {
				name := strings.ToLower(a.Name.Local)
				if name == "xmlns" || a.Name.Space == "xmlns" {
					if a.Value != "http://www.w3.org/2000/svg" && a.Value != "http://www.w3.org/1999/xlink" {
						return 0, 0, invalid
					}
					continue
				}
				if strings.HasPrefix(name, "on") || name == "src" || name == "base" || !staticSVGValue(a.Value) {
					return 0, 0, invalid
				}
				if name == "href" && (!strings.HasPrefix(a.Value, "#") || len(a.Value) < 2) {
					return 0, 0, invalid
				}
				if depth == 1 {
					switch a.Name.Local {
					case "width":
						width = dimension(a.Value)
					case "height":
						height = dimension(a.Value)
					case "viewBox":
						parts := strings.Fields(strings.ReplaceAll(a.Value, ",", " "))
						if len(parts) != 4 {
							return 0, 0, invalid
						}
						for i, v := range parts {
							n, e := strconv.ParseFloat(v, 64)
							if e != nil || math.IsNaN(n) || math.IsInf(n, 0) || math.Abs(n) > 1e7 || i >= 2 && n <= 0 {
								return 0, 0, invalid
							}
						}
						viewport = true
					}
				}
			}
		case xml.EndElement:
			if depth == styleDepth {
				if !staticSVGValue(style.String()) {
					return 0, 0, invalid
				}
				styleDepth = 0
			}
			depth--
			if depth == 0 {
				closed = true
			}
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(t)) != "" {
				return 0, 0, invalid
			}
			if styleDepth > 0 {
				style.Write(t)
			}
		case xml.Directive:
			return 0, 0, invalid
		case xml.ProcInst:
			if t.Target != "xml" || seen {
				return 0, 0, invalid
			}
		}
	}
	if !seen || !closed || depth != 0 || (!viewport && (width == 0 || height == 0)) || int64(width)*int64(height) > 64<<20 {
		return 0, 0, invalid
	}
	return width, height, nil
}
