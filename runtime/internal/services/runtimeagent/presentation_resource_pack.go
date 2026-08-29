package runtimeagent

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"path"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	_ "golang.org/x/image/webp"
	"google.golang.org/protobuf/proto"
)

const (
	resourcePackMediaType        = "application/vnd.nimi.resource-pack+zip"
	resourcePackTargetID         = "zhiyu-experience-surface"
	resourcePackTargetVersion    = uint32(1)
	resourcePackSchemaVersion    = 1
	resourcePackManifestPath     = "manifest.json"
	maxResourcePackArchiveBytes  = 2 << 20
	maxResourcePackExpandedBytes = 8 << 20
	maxResourcePackEntries       = 32
	maxResourcePackManifestBytes = 32 << 10
	maxResourcePackStyleBytes    = 128 << 10
	maxResourcePackResources     = 24
	maxResourcePackResourceBytes = 4 << 20
)

type validatedResourcePackEnvelope struct {
	targetID      string
	targetVersion uint32
}

type resourcePackManifest struct {
	SchemaVersion int                        `json:"schemaVersion"`
	Target        resourcePackManifestTarget `json:"target"`
	StyleEntry    string                     `json:"styleEntry"`
	Resources     []string                   `json:"resources"`
}

type resourcePackManifestTarget struct {
	ID      string `json:"id"`
	Version uint32 `json:"version"`
}

// validatePresentationResourcePackArchive independently enforces the bounded
// Zhiyu W1 envelope, manifest, resource, and CSS admission grammar. It does not
// produce renderer CSS or create candidate state.
// @nimi-authority: rule.nimi.runtime.agent-participation.r193
func validatePresentationResourcePackArchive(content []byte) (*validatedResourcePackEnvelope, error) {
	reader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil || len(reader.File) == 0 || len(reader.File) > maxResourcePackEntries {
		return nil, invalidPresentationResourcePack("archive", "The Resource Pack is not a bounded ZIP archive.", "rebuild_resource_pack")
	}
	entries := make(map[string][]byte, len(reader.File))
	seen := make(map[string]struct{}, len(reader.File))
	var expanded uint64
	for _, file := range reader.File {
		name, err := normalizeResourcePackPath(file.Name, file.FileInfo().IsDir())
		if err != nil {
			return nil, err
		}
		if _, duplicate := seen[name]; duplicate {
			return nil, invalidPresentationResourcePack("archive", "The Resource Pack contains a duplicate entry.", "remove_duplicate_resource_pack_entry")
		}
		seen[name] = struct{}{}
		if file.Method != zip.Store && file.Method != zip.Deflate {
			return nil, invalidPresentationResourcePack("archive", "The Resource Pack uses an unsupported ZIP compression method.", "rebuild_resource_pack")
		}
		expanded += file.UncompressedSize64
		if expanded > maxResourcePackExpandedBytes {
			return nil, invalidPresentationResourcePack("size", "The expanded Resource Pack exceeds the W1 limit.", "reduce_resource_pack_size")
		}
		if file.FileInfo().IsDir() || strings.HasSuffix(name, "/") {
			continue
		}
		entry, err := readResourcePackEntry(file, maxResourcePackExpandedBytes)
		if err != nil {
			return nil, err
		}
		entries[name] = entry
	}

	manifestBytes, ok := entries[resourcePackManifestPath]
	if !ok || len(manifestBytes) > maxResourcePackManifestBytes || !utf8.Valid(manifestBytes) {
		return nil, invalidPresentationResourcePack("manifest", "The Resource Pack manifest is missing, too large, or not UTF-8.", "repair_resource_pack_manifest")
	}
	manifest, err := decodeResourcePackManifest(manifestBytes)
	if err != nil {
		return nil, err
	}
	style, ok := entries[manifest.StyleEntry]
	if !ok || len(style) > maxResourcePackStyleBytes || !utf8.Valid(style) {
		return nil, invalidPresentationResourcePack("style", "The declared Resource Pack stylesheet is missing, too large, or not UTF-8.", "repair_resource_pack_stylesheet")
	}

	expected := map[string]struct{}{resourcePackManifestPath: {}, manifest.StyleEntry: {}}
	for _, resource := range manifest.Resources {
		if _, duplicate := expected[resource]; duplicate {
			return nil, invalidPresentationResourcePack("manifest", "The Resource Pack declares a duplicate resource path.", "remove_duplicate_resource_pack_resource")
		}
		expected[resource] = struct{}{}
		resourceBytes, exists := entries[resource]
		if !exists || len(resourceBytes) > maxResourcePackResourceBytes || !validResourcePackImage(resource, resourceBytes) {
			return nil, invalidPresentationResourcePack("resource", "A declared Resource Pack image is missing, too large, or has an invalid type signature.", "repair_resource_pack_resource")
		}
	}
	if len(entries) != len(expected) {
		return nil, invalidPresentationResourcePack("archive", "The Resource Pack contains an undeclared entry.", "remove_undeclared_resource_pack_entry")
	}
	for name := range entries {
		if _, admitted := expected[name]; !admitted {
			return nil, invalidPresentationResourcePack("archive", "The Resource Pack contains an undeclared entry.", "remove_undeclared_resource_pack_entry")
		}
	}
	if err := validateResourcePackStyle(string(style), manifest.Resources); err != nil {
		return nil, err
	}
	return &validatedResourcePackEnvelope{targetID: manifest.Target.ID, targetVersion: manifest.Target.Version}, nil
}

func decodeResourcePackManifest(content []byte) (*resourcePackManifest, error) {
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.UseNumber()
	var decoded any
	if err := decoder.Decode(&decoded); err != nil {
		return nil, invalidPresentationResourcePack("manifest", "The Resource Pack manifest does not match the W1 shape.", "repair_resource_pack_manifest")
	}
	if err := requireResourcePackJSONEOF(decoder); err != nil {
		return nil, err
	}
	root, ok := decoded.(map[string]any)
	if !ok || !exactResourcePackJSONKeys(root, "resources", "schemaVersion", "styleEntry", "target") {
		return nil, invalidPresentationResourcePack("manifest", "The Resource Pack manifest does not match the exact W1 shape.", "repair_resource_pack_manifest")
	}
	target, ok := root["target"].(map[string]any)
	if !ok || !exactResourcePackJSONKeys(target, "id", "version") {
		return nil, invalidPresentationResourcePack("manifest", "The Resource Pack target does not match the exact W1 shape.", "repair_resource_pack_manifest")
	}
	targetID, targetIDOK := target["id"].(string)
	styleEntryRaw, styleEntryOK := root["styleEntry"].(string)
	resourcesRaw, resourcesOK := root["resources"].([]any)
	if !resourcePackJSONNumberEqualsOne(root["schemaVersion"]) ||
		!resourcePackJSONNumberEqualsOne(target["version"]) ||
		!targetIDOK || targetID != resourcePackTargetID || !styleEntryOK || !resourcesOK ||
		len(resourcesRaw) > maxResourcePackResources {
		return nil, invalidPresentationResourcePack("target", "The Resource Pack schema or Zhiyu target is unsupported.", "select_supported_resource_pack_target")
	}
	styleEntry, err := normalizeResourcePackPath(styleEntryRaw, false)
	if err != nil {
		return nil, err
	}
	if !strings.HasSuffix(strings.ToLower(styleEntry), ".css") {
		return nil, invalidPresentationResourcePack("style", "The Resource Pack styleEntry must name a relative CSS file.", "use_css_resource_pack_style_entry")
	}
	if styleEntry == resourcePackManifestPath {
		return nil, invalidPresentationResourcePack("style", "The Resource Pack manifest cannot also be its stylesheet.", "use_distinct_resource_pack_style_entry")
	}
	resources := make([]string, len(resourcesRaw))
	for index, raw := range resourcesRaw {
		resource, ok := raw.(string)
		if !ok {
			return nil, invalidPresentationResourcePack("manifest", "The Resource Pack resources field must contain only paths.", "repair_resource_pack_manifest")
		}
		normalized, err := normalizeResourcePackPath(resource, false)
		if err != nil {
			return nil, err
		}
		resources[index] = normalized
	}
	return &resourcePackManifest{
		SchemaVersion: resourcePackSchemaVersion,
		Target: resourcePackManifestTarget{
			ID: resourcePackTargetID, Version: resourcePackTargetVersion,
		},
		StyleEntry: styleEntry,
		Resources:  resources,
	}, nil
}

func exactResourcePackJSONKeys(value map[string]any, expected ...string) bool {
	if len(value) != len(expected) {
		return false
	}
	for _, key := range expected {
		if _, ok := value[key]; !ok {
			return false
		}
	}
	return true
}

func resourcePackJSONNumberEqualsOne(value any) bool {
	number, ok := value.(json.Number)
	if !ok {
		return false
	}
	parsed, err := strconv.ParseFloat(number.String(), 64)
	return err == nil && parsed == 1
}

func requireResourcePackJSONEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return invalidPresentationResourcePack("manifest", "The Resource Pack manifest contains trailing JSON content.", "repair_resource_pack_manifest")
	}
	return nil
}

func normalizeResourcePackPath(raw string, directory bool) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" || len(value) > 200 || strings.HasPrefix(value, "/") || strings.Contains(value, `\`) || strings.ContainsRune(value, '\x00') ||
		(len(value) >= 2 && ((value[0] >= 'a' && value[0] <= 'z') || (value[0] >= 'A' && value[0] <= 'Z')) && value[1] == ':') {
		return "", invalidPresentationResourcePack("path", "The Resource Pack contains an invalid entry path.", "use_relative_resource_pack_paths")
	}
	cleaned := strings.TrimSuffix(value, "/")
	if cleaned == "" || path.Clean(cleaned) != cleaned {
		return "", invalidPresentationResourcePack("path", "The Resource Pack contains an invalid entry path.", "use_relative_resource_pack_paths")
	}
	for _, segment := range strings.Split(cleaned, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return "", invalidPresentationResourcePack("path", "The Resource Pack contains an invalid entry path.", "use_relative_resource_pack_paths")
		}
	}
	if directory || strings.HasSuffix(value, "/") {
		return cleaned + "/", nil
	}
	return cleaned, nil
}

var (
	resourcePackContainerQueryPattern  = regexp.MustCompile(`^\((?:min|max)-width:[ \t\r\n\f]*[0-9]+(?:\.[0-9]+)?(?:px|rem|em)\)$`)
	resourcePackContainerAmountPattern = regexp.MustCompile(`[0-9]+(?:\.[0-9]+)?`)
	resourcePackLayoutValuePattern     = regexp.MustCompile(`^[a-z0-9.,%() \t\r\n\f+\-]+$`)
	resourcePackLayoutNumberPattern    = regexp.MustCompile(`-?[0-9]*\.?[0-9]+[ \t\r\n\f]*(?:px|rem|em|%|fr)?`)
	resourcePackRepeatAutoPattern      = regexp.MustCompile(`\brepeat\([ \t\r\n\f]*(?:auto-fill|auto-fit)`)
	resourcePackRepeatCountPattern     = regexp.MustCompile(`\brepeat\([ \t\r\n\f]*([0-9]+)`)
)

var resourcePackLayoutProperties = map[string]struct{}{
	"align-content": {}, "align-items": {}, "align-self": {}, "column-gap": {},
	"display": {}, "flex-direction": {}, "flex-wrap": {}, "gap": {}, "grid-auto-flow": {},
	"grid-template-columns": {}, "grid-template-rows": {}, "justify-content": {},
	"justify-items": {}, "justify-self": {}, "max-width": {}, "min-width": {},
	"padding": {}, "padding-block": {}, "padding-bottom": {}, "padding-inline": {},
	"padding-left": {}, "padding-right": {}, "padding-top": {}, "row-gap": {}, "width": {},
}

var resourcePackVisualProperties = map[string]struct{}{
	"background-color": {}, "background-image": {}, "background-position": {},
	"background-repeat": {}, "background-size": {}, "border": {}, "border-bottom": {},
	"border-color": {}, "border-left": {}, "border-radius": {}, "border-right": {},
	"border-style": {}, "border-top": {}, "border-width": {}, "box-shadow": {},
	"color": {}, "font-family": {}, "font-size": {}, "font-style": {}, "font-weight": {},
	"letter-spacing": {}, "line-height": {}, "text-align": {},
}

var resourcePackAlignmentValues = map[string]struct{}{
	"baseline": {}, "center": {}, "end": {}, "flex-end": {}, "flex-start": {},
	"space-around": {}, "space-between": {}, "space-evenly": {}, "start": {}, "stretch": {},
}

var resourcePackForbiddenValueFragments = []string{
	"attr(", "behavior:", "expression(", "javascript:", "var(", "vh", "vmax", "vmin", "vw",
}

type resourcePackCSSParser struct {
	input      string
	offset     int
	resources  map[string]struct{}
	referenced map[string]struct{}
}

func validateResourcePackStyle(style string, declaredResources []string) error {
	if strings.Contains(style, `\`) {
		return invalidPresentationResourcePack("style", "Resource Pack CSS escapes are not supported in W1.", "use_literal_resource_pack_css")
	}
	cleaned, err := stripResourcePackCSSComments(style)
	if err != nil {
		return err
	}
	resources := make(map[string]struct{}, len(declaredResources))
	for _, resource := range declaredResources {
		resources[resource] = struct{}{}
	}
	parser := &resourcePackCSSParser{
		input: cleaned, resources: resources, referenced: make(map[string]struct{}, len(resources)),
	}
	if err := parser.parseRules(false); err != nil {
		return err
	}
	for _, resource := range declaredResources {
		if _, used := parser.referenced[resource]; !used {
			return invalidPresentationResourcePack("manifest", "A declared Resource Pack image is not referenced by the stylesheet.", "remove_unused_resource_pack_resource")
		}
	}
	return nil
}

func stripResourcePackCSSComments(style string) (string, error) {
	var result strings.Builder
	result.Grow(len(style))
	var quote byte
	for index := 0; index < len(style); {
		current := style[index]
		if quote != 0 {
			result.WriteByte(current)
			if current == quote {
				quote = 0
			}
			index++
			continue
		}
		if current == '\'' || current == '"' {
			quote = current
			result.WriteByte(current)
			index++
			continue
		}
		if current == '/' && index+1 < len(style) && style[index+1] == '*' {
			end := strings.Index(style[index+2:], "*/")
			if end < 0 {
				return "", invalidPresentationResourcePack("style", "The Resource Pack stylesheet contains an unterminated comment.", "repair_resource_pack_stylesheet")
			}
			result.WriteByte(' ')
			index += end + 4
			continue
		}
		if current == 0 || (current < 0x20 && !isResourcePackCSSSpace(current)) {
			return "", invalidPresentationResourcePack("style", "The Resource Pack stylesheet contains an unsupported control character.", "repair_resource_pack_stylesheet")
		}
		result.WriteByte(current)
		index++
	}
	if quote != 0 {
		return "", invalidPresentationResourcePack("style", "The Resource Pack stylesheet contains an unterminated string.", "repair_resource_pack_stylesheet")
	}
	return result.String(), nil
}

func (p *resourcePackCSSParser) parseRules(stopAtBrace bool) error {
	for {
		p.skipSpace()
		if p.offset >= len(p.input) {
			if stopAtBrace {
				return invalidPresentationResourcePack("style", "The Resource Pack stylesheet contains an unterminated block.", "repair_resource_pack_stylesheet")
			}
			return nil
		}
		if p.input[p.offset] == '}' {
			if !stopAtBrace {
				return invalidPresentationResourcePack("style", "The Resource Pack stylesheet contains an unmatched block terminator.", "repair_resource_pack_stylesheet")
			}
			p.offset++
			return nil
		}
		header, err := p.readRuleHeader()
		if err != nil {
			return err
		}
		if strings.HasPrefix(strings.TrimSpace(header), "@") {
			if err := validateResourcePackContainerHeader(header); err != nil {
				return err
			}
			if err := p.parseRules(true); err != nil {
				return err
			}
			continue
		}
		if err := validateResourcePackSelectors(header); err != nil {
			return err
		}
		if err := p.parseDeclarations(); err != nil {
			return err
		}
	}
}

func (p *resourcePackCSSParser) readRuleHeader() (string, error) {
	start := p.offset
	var quote byte
	for p.offset < len(p.input) {
		current := p.input[p.offset]
		if quote != 0 {
			if current == quote {
				quote = 0
			}
			p.offset++
			continue
		}
		if current == '\'' || current == '"' {
			quote = current
			p.offset++
			continue
		}
		switch current {
		case '{':
			header := strings.TrimSpace(p.input[start:p.offset])
			p.offset++
			if header == "" {
				return "", invalidPresentationResourcePack("style", "A Resource Pack style rule has no selector.", "use_resource_pack_semantic_selector")
			}
			return header, nil
		case '}', ';':
			return "", invalidPresentationResourcePack("style", "The Resource Pack stylesheet contains an invalid rule.", "repair_resource_pack_stylesheet")
		}
		p.offset++
	}
	return "", invalidPresentationResourcePack("style", "The Resource Pack stylesheet contains an unterminated rule.", "repair_resource_pack_stylesheet")
}

func validateResourcePackContainerHeader(header string) error {
	trimmed := strings.TrimSpace(header)
	separator := strings.IndexFunc(trimmed, isResourcePackCSSSpaceRune)
	if separator < 0 || !strings.EqualFold(trimmed[:separator], "@container") {
		return invalidPresentationResourcePack("style", "Only a bounded W1 @container rule is allowed.", "use_bounded_resource_pack_container")
	}
	query := strings.ToLower(strings.TrimSpace(trimmed[separator:]))
	if !resourcePackContainerQueryPattern.MatchString(query) {
		return invalidPresentationResourcePack("style", "The Resource Pack uses an unsupported container query.", "use_bounded_resource_pack_container")
	}
	amountText := resourcePackContainerAmountPattern.FindString(query)
	amount, err := strconv.ParseFloat(amountText, 64)
	if err != nil {
		return invalidPresentationResourcePack("style", "The Resource Pack uses an invalid container query bound.", "use_bounded_resource_pack_container")
	}
	if strings.HasSuffix(query, "px)") {
		if amount <= 1600 {
			return nil
		}
	} else if amount <= 100 {
		return nil
	}
	return invalidPresentationResourcePack("style", "The Resource Pack container query exceeds the W1 bound.", "reduce_resource_pack_container_bound")
}

func validateResourcePackSelectors(header string) error {
	selectors := strings.Split(header, ",")
	if len(selectors) == 0 {
		return invalidPresentationResourcePack("style", "A Resource Pack style rule has no semantic selector.", "use_resource_pack_semantic_selector")
	}
	for _, raw := range selectors {
		selector := strings.TrimSpace(raw)
		if selector != `[data-nimi-pack-zone="surface"]` && selector != `[data-nimi-pack-zone='surface']` {
			return invalidPresentationResourcePack("style", "A Resource Pack selector is outside the W1 semantic zone.", "use_resource_pack_semantic_selector")
		}
	}
	return nil
}

func (p *resourcePackCSSParser) parseDeclarations() error {
	for {
		p.skipSpace()
		if p.offset >= len(p.input) {
			return invalidPresentationResourcePack("style", "The Resource Pack stylesheet contains an unterminated declaration block.", "repair_resource_pack_stylesheet")
		}
		if p.input[p.offset] == '}' {
			p.offset++
			return nil
		}
		if p.input[p.offset] == ';' {
			p.offset++
			continue
		}
		propertyStart := p.offset
		for p.offset < len(p.input) && p.input[p.offset] != ':' {
			if p.input[p.offset] == ';' || p.input[p.offset] == '{' || p.input[p.offset] == '}' || p.input[p.offset] == '@' {
				return invalidPresentationResourcePack("style", "The Resource Pack stylesheet contains an invalid declaration.", "repair_resource_pack_stylesheet")
			}
			p.offset++
		}
		if p.offset >= len(p.input) {
			return invalidPresentationResourcePack("style", "The Resource Pack stylesheet contains an unterminated declaration.", "repair_resource_pack_stylesheet")
		}
		property := strings.TrimSpace(p.input[propertyStart:p.offset])
		p.offset++
		value, closesBlock, err := p.readDeclarationValue()
		if err != nil {
			return err
		}
		if err := p.validateDeclaration(property, value); err != nil {
			return err
		}
		if closesBlock {
			return nil
		}
	}
}

func (p *resourcePackCSSParser) readDeclarationValue() (string, bool, error) {
	start := p.offset
	var quote byte
	depth := 0
	for p.offset < len(p.input) {
		current := p.input[p.offset]
		if quote != 0 {
			if current == quote {
				quote = 0
			}
			p.offset++
			continue
		}
		if current == '\'' || current == '"' {
			quote = current
			p.offset++
			continue
		}
		switch current {
		case '(':
			depth++
		case ')':
			if depth == 0 {
				return "", false, invalidPresentationResourcePack("style", "The Resource Pack stylesheet contains an unmatched parenthesis.", "repair_resource_pack_stylesheet")
			}
			depth--
		case '{':
			return "", false, invalidPresentationResourcePack("style", "Nested Resource Pack declarations are not supported.", "repair_resource_pack_stylesheet")
		case ';':
			if depth == 0 {
				value := strings.TrimSpace(p.input[start:p.offset])
				p.offset++
				return value, false, nil
			}
		case '}':
			if depth == 0 {
				value := strings.TrimSpace(p.input[start:p.offset])
				p.offset++
				return value, true, nil
			}
			return "", false, invalidPresentationResourcePack("style", "The Resource Pack stylesheet closes a declaration inside a function.", "repair_resource_pack_stylesheet")
		}
		p.offset++
	}
	return "", false, invalidPresentationResourcePack("style", "The Resource Pack stylesheet contains an unterminated declaration value.", "repair_resource_pack_stylesheet")
}

func (p *resourcePackCSSParser) validateDeclaration(rawProperty, value string) error {
	property := strings.ToLower(strings.TrimSpace(rawProperty))
	_, layout := resourcePackLayoutProperties[property]
	_, visual := resourcePackVisualProperties[property]
	if property == "" || strings.HasPrefix(property, "--") || (!layout && !visual) || value == "" {
		return invalidPresentationResourcePack("style", "The Resource Pack stylesheet uses an unsupported property or empty value.", "use_supported_resource_pack_property")
	}
	lowerValue := strings.ToLower(strings.TrimSpace(value))
	if len(value) > 512 || containsResourcePackImportant(lowerValue) {
		return invalidPresentationResourcePack("style", "The Resource Pack stylesheet uses an over-bounded or important value.", "simplify_resource_pack_declaration")
	}
	for _, fragment := range resourcePackForbiddenValueFragments {
		if strings.Contains(lowerValue, fragment) {
			return invalidPresentationResourcePack("style", "The Resource Pack stylesheet uses a forbidden value fragment.", "use_bounded_resource_pack_value")
		}
	}
	if containsResourcePackRemoteValue(lowerValue) {
		return invalidPresentationResourcePack("style", "The Resource Pack stylesheet references a remote or embedded URL.", "use_declared_resource_pack_image")
	}
	switch property {
	case "display":
		if lowerValue != "block" && lowerValue != "flex" && lowerValue != "grid" {
			return invalidPresentationResourcePack("style", "The Resource Pack display value is unsupported.", "use_supported_resource_pack_display")
		}
	case "flex-direction":
		if lowerValue != "column" && lowerValue != "column-reverse" && lowerValue != "row" && lowerValue != "row-reverse" {
			return invalidPresentationResourcePack("style", "The Resource Pack flex direction is unsupported.", "use_supported_resource_pack_flex_direction")
		}
	case "flex-wrap":
		if lowerValue != "nowrap" && lowerValue != "wrap" {
			return invalidPresentationResourcePack("style", "The Resource Pack flex wrap is unsupported.", "use_supported_resource_pack_flex_wrap")
		}
	case "grid-auto-flow":
		if lowerValue != "column" && lowerValue != "row" {
			return invalidPresentationResourcePack("style", "The Resource Pack grid flow is unsupported.", "use_supported_resource_pack_grid_flow")
		}
	}
	if strings.HasPrefix(property, "align-") || strings.HasPrefix(property, "justify-") {
		if _, ok := resourcePackAlignmentValues[lowerValue]; !ok {
			return invalidPresentationResourcePack("style", "The Resource Pack alignment value is unsupported.", "use_supported_resource_pack_alignment")
		}
	}
	if layout && property != "display" && property != "flex-direction" && property != "flex-wrap" && property != "grid-auto-flow" &&
		!strings.HasPrefix(property, "align-") && !strings.HasPrefix(property, "justify-") {
		if err := validateResourcePackLayoutValue(property, lowerValue); err != nil {
			return err
		}
	}
	if property == "background-image" {
		return p.validateBackgroundImage(value)
	}
	if strings.Contains(lowerValue, "url") {
		return invalidPresentationResourcePack("style", "Resource Pack URLs are allowed only in background-image.", "use_declared_resource_pack_image")
	}
	return nil
}

func validateResourcePackLayoutValue(property, value string) error {
	if !resourcePackLayoutValuePattern.MatchString(value) || strings.Contains(value, "calc(") ||
		resourcePackRepeatAutoPattern.MatchString(value) {
		return invalidPresentationResourcePack("style", "The Resource Pack stylesheet uses an unsupported layout expression.", "use_bounded_resource_pack_layout")
	}
	for _, match := range resourcePackLayoutNumberPattern.FindAllString(value, -1) {
		trimmed := strings.ReplaceAll(match, " ", "")
		trimmed = strings.ReplaceAll(trimmed, "\t", "")
		trimmed = strings.ReplaceAll(trimmed, "\r", "")
		trimmed = strings.ReplaceAll(trimmed, "\n", "")
		trimmed = strings.ReplaceAll(trimmed, "\f", "")
		unit := ""
		for _, candidate := range []string{"rem", "em", "px", "%", "fr"} {
			if strings.HasSuffix(trimmed, candidate) {
				unit = candidate
				trimmed = strings.TrimSuffix(trimmed, candidate)
				break
			}
		}
		amount, err := strconv.ParseFloat(trimmed, 64)
		if err != nil || amount < 0 {
			return invalidPresentationResourcePack("style", "The Resource Pack stylesheet uses a negative or invalid layout size.", "use_bounded_resource_pack_layout")
		}
		maximum := float64(12)
		switch unit {
		case "px":
			maximum = 1600
			if strings.Contains(property, "padding") || strings.Contains(property, "gap") {
				maximum = 96
			}
		case "rem", "em":
			maximum = 64
			if strings.Contains(property, "padding") || strings.Contains(property, "gap") {
				maximum = 6
			}
		case "%":
			maximum = 100
		case "fr":
			maximum = 12
		}
		if amount > maximum {
			return invalidPresentationResourcePack("style", "The Resource Pack stylesheet exceeds a W1 layout bound.", "reduce_resource_pack_layout_value")
		}
	}
	for _, match := range resourcePackRepeatCountPattern.FindAllStringSubmatch(value, -1) {
		count, err := strconv.Atoi(match[1])
		if err != nil || count < 1 || count > 4 {
			return invalidPresentationResourcePack("style", "The Resource Pack grid repetition exceeds the W1 bound.", "reduce_resource_pack_grid_repetition")
		}
	}
	return nil
}

func (p *resourcePackCSSParser) validateBackgroundImage(value string) error {
	lower := strings.ToLower(strings.TrimSpace(value))
	if lower == "none" {
		return nil
	}
	if strings.Contains(lower, "image-set(") || strings.Contains(lower, "cross-fade(") || strings.Contains(lower, "element(") {
		return invalidPresentationResourcePack("style", "The Resource Pack background image function is unsupported.", "use_supported_resource_pack_background")
	}
	for index := 0; index < len(value); {
		if value[index] == '\'' || value[index] == '"' {
			quote := value[index]
			index++
			for index < len(value) && value[index] != quote {
				index++
			}
			if index >= len(value) {
				return invalidPresentationResourcePack("style", "The Resource Pack background image contains an unterminated string.", "repair_resource_pack_stylesheet")
			}
			index++
			continue
		}
		if !isResourcePackCSSIdentifierStart(value[index]) {
			index++
			continue
		}
		start := index
		for index < len(value) && isResourcePackCSSIdentifier(value[index]) {
			index++
		}
		if index >= len(value) || value[index] != '(' {
			continue
		}
		name := strings.ToLower(value[start:index])
		switch name {
		case "linear-gradient", "radial-gradient":
			index++
		case "url":
			end, resource, err := parseResourcePackCSSURL(value, index)
			if err != nil {
				return err
			}
			if _, declared := p.resources[resource]; !declared {
				return invalidPresentationResourcePack("style", "The Resource Pack stylesheet references an undeclared image.", "declare_resource_pack_image")
			}
			p.referenced[resource] = struct{}{}
			index = end
		default:
			return invalidPresentationResourcePack("style", "The Resource Pack background image uses an unsupported function.", "use_supported_resource_pack_background")
		}
	}
	return nil
}

func parseResourcePackCSSURL(value string, openParen int) (int, string, error) {
	index := openParen + 1
	for index < len(value) && isResourcePackCSSSpace(value[index]) {
		index++
	}
	if index >= len(value) || (value[index] != '\'' && value[index] != '"') {
		return 0, "", invalidPresentationResourcePack("style", "Every Resource Pack URL must be a quoted relative path.", "use_declared_resource_pack_image")
	}
	quote := value[index]
	index++
	start := index
	for index < len(value) && value[index] != quote {
		index++
	}
	if index >= len(value) {
		return 0, "", invalidPresentationResourcePack("style", "The Resource Pack URL contains an unterminated string.", "repair_resource_pack_stylesheet")
	}
	raw := strings.TrimSpace(value[start:index])
	index++
	for index < len(value) && isResourcePackCSSSpace(value[index]) {
		index++
	}
	if index >= len(value) || value[index] != ')' {
		return 0, "", invalidPresentationResourcePack("style", "The Resource Pack URL is not a bounded quoted function.", "use_declared_resource_pack_image")
	}
	normalized, err := normalizeResourcePackPath(raw, false)
	if err != nil {
		return 0, "", err
	}
	lower := strings.ToLower(normalized)
	if strings.Contains(lower, "://") || strings.HasPrefix(lower, "data:") || strings.HasPrefix(lower, "file:") || strings.HasPrefix(lower, "blob:") {
		return 0, "", invalidPresentationResourcePack("style", "The Resource Pack stylesheet references a remote or embedded URL.", "use_declared_resource_pack_image")
	}
	return index + 1, normalized, nil
}

func containsResourcePackImportant(value string) bool {
	compact := strings.NewReplacer(" ", "", "\t", "", "\r", "", "\n", "", "\f", "").Replace(value)
	return strings.Contains(compact, "!important")
}

func containsResourcePackRemoteValue(value string) bool {
	return strings.Contains(value, "://") || strings.Contains(value, "data:") ||
		strings.Contains(value, "file:") || strings.Contains(value, "blob:")
}

func (p *resourcePackCSSParser) skipSpace() {
	for p.offset < len(p.input) && isResourcePackCSSSpace(p.input[p.offset]) {
		p.offset++
	}
}

func isResourcePackCSSSpace(value byte) bool {
	return value == ' ' || value == '\t' || value == '\r' || value == '\n' || value == '\f'
}

func isResourcePackCSSSpaceRune(value rune) bool {
	return value == ' ' || value == '\t' || value == '\r' || value == '\n' || value == '\f'
}

func isResourcePackCSSIdentifierStart(value byte) bool {
	return (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z') || value == '-'
}

func isResourcePackCSSIdentifier(value byte) bool {
	return isResourcePackCSSIdentifierStart(value)
}

func readResourcePackEntry(file *zip.File, limit int) ([]byte, error) {
	reader, err := file.Open()
	if err != nil {
		return nil, invalidPresentationResourcePack("archive", "A Resource Pack entry cannot be read.", "rebuild_resource_pack")
	}
	defer func() { _ = reader.Close() }()
	content, err := io.ReadAll(io.LimitReader(reader, int64(limit)+1))
	if err != nil || len(content) > limit {
		return nil, invalidPresentationResourcePack("archive", "A Resource Pack entry exceeds its bounded read.", "reduce_resource_pack_size")
	}
	return content, nil
}

func validResourcePackImage(name string, content []byte) bool {
	lower := strings.ToLower(name)
	expectedFormat := ""
	switch {
	case strings.HasSuffix(lower, ".png"):
		if resourcePackPNGHasChunk(content, "acTL") {
			return false
		}
		expectedFormat = "png"
	case strings.HasSuffix(lower, ".jpg") || strings.HasSuffix(lower, ".jpeg"):
		expectedFormat = "jpeg"
	case strings.HasSuffix(lower, ".webp"):
		if animatedResourcePackWebP(content) {
			return false
		}
		expectedFormat = "webp"
	default:
		return false
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(content))
	return err == nil && format == expectedFormat && config.Width > 0 && config.Height > 0 &&
		config.Width <= 8192 && config.Height <= 8192
}

func animatedResourcePackWebP(content []byte) bool {
	for offset := 12; offset+8 <= len(content); {
		length := uint64(binary.LittleEndian.Uint32(content[offset+4 : offset+8]))
		dataStart := uint64(offset + 8)
		end := dataStart + length
		if end > uint64(len(content)) {
			return false
		}
		chunkType := string(content[offset : offset+4])
		if chunkType == "ANIM" || chunkType == "ANMF" ||
			(chunkType == "VP8X" && length >= 1 && content[dataStart]&0x02 != 0) {
			return true
		}
		next := end + length%2
		if next > uint64(len(content)) {
			return false
		}
		offset = int(next)
	}
	return false
}

func resourcePackPNGHasChunk(content []byte, expectedType string) bool {
	for offset := 8; offset+12 <= len(content); {
		length := uint64(binary.BigEndian.Uint32(content[offset : offset+4]))
		end := uint64(offset+12) + length
		if end > uint64(len(content)) {
			return false
		}
		if string(content[offset+4:offset+8]) == expectedType {
			return true
		}
		offset = int(end)
	}
	return false
}

func invalidPresentationResourcePack(category, message, actionHint string) error {
	return presentationValidationError(
		runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID,
		category,
		"resource-pack",
		resourcePackMediaType,
		"",
		message,
		actionHint,
	)
}

func resourcePackSelection(ref string) *runtimev1.AgentResourcePackSelection {
	if strings.TrimSpace(ref) == "" {
		return nil
	}
	return &runtimev1.AgentResourcePackSelection{
		AssetRef: ref, TargetId: resourcePackTargetID, TargetVersion: resourcePackTargetVersion,
	}
}

func cloneResourcePackSelection(selection *runtimev1.AgentResourcePackSelection) *runtimev1.AgentResourcePackSelection {
	if selection == nil {
		return nil
	}
	return proto.Clone(selection).(*runtimev1.AgentResourcePackSelection)
}

func validateResourcePackSelection(selection *runtimev1.AgentResourcePackSelection) error {
	if selection == nil {
		return nil
	}
	if selection.GetTargetId() != resourcePackTargetID || selection.GetTargetVersion() != resourcePackTargetVersion ||
		validateAgentPresentationOpaqueRef(selection.GetAssetRef()) != nil || !strings.HasPrefix(selection.GetAssetRef(), "pack_") {
		return fmt.Errorf("invalid Resource Pack selection: %w", invalidAgentPresentationProfile())
	}
	return nil
}
