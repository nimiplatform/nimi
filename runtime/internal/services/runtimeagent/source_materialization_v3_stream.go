package runtimeagent

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"unicode/utf8"
)

const (
	sourceMaterializationMaxJSONDepthV3       = 256
	sourceMaterializationMinArrayEntriesV3    = 1024
	sourceMaterializationMaxObjectMembersV3   = 65536
	sourceMaterializationBaseTokenAllowanceV3 = 2_000_000
)

type sourceMaterializationJSONFrameV3 struct {
	kind         json.Delim
	path         string
	expectingKey bool
	count        uint64
	arrayLimit   uint64
	currentKey   string
	keys         map[string]struct{}
}

// decodeSourceMaterializationPacketStreamV3 performs bounded lexical and
// structural passes over the private staging file before the typed decoder is
// allowed to allocate slices or strings. No pass retains the complete wire
// document, and the typed pass is the sole full Packet representation.
func decodeSourceMaterializationPacketStreamV3(
	reader io.ReadSeeker,
	maxBytes int64,
	limits sourceMaterializationPublishedLimitsV3,
) (sourceMaterializationPacketV3Value, error) {
	if reader == nil || maxBytes <= 0 {
		return sourceMaterializationPacketV3Value{}, sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "invalid streaming Packet input")
	}
	start, err := reader.Seek(0, io.SeekCurrent)
	if err != nil {
		return sourceMaterializationPacketV3Value{}, sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "locate staged Packet: %v", err)
	}
	if err := preflightSourceMaterializationPacketStreamV3(reader, start, maxBytes, limits); err != nil {
		return sourceMaterializationPacketV3Value{}, err
	}

	limited := &io.LimitedReader{R: reader, N: maxBytes + 1}
	decoder := json.NewDecoder(limited)
	decoder.DisallowUnknownFields()
	var packet sourceMaterializationPacketV3Value
	if err := decoder.Decode(&packet); err != nil {
		return sourceMaterializationPacketV3Value{}, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "stream-decode Packet v3: %v", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return sourceMaterializationPacketV3Value{}, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 contains a trailing JSON value")
		}
		return sourceMaterializationPacketV3Value{}, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 trailing JSON is invalid: %v", err)
	}
	if limited.N <= 0 {
		return sourceMaterializationPacketV3Value{}, sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "Packet v3 exceeds its wire budget")
	}
	return packet, nil
}

func preflightSourceMaterializationPacketStreamV3(
	reader io.ReadSeeker,
	start int64,
	maxBytes int64,
	limits sourceMaterializationPublishedLimitsV3,
) error {
	restore := func() error {
		_, err := reader.Seek(start, io.SeekStart)
		return err
	}
	maxStringBytes := uint64(base64.RawURLEncoding.EncodedLen(int(limits.MaxChunkBytes)))
	if sourceMaterializationMaxProofBytesV3 > maxStringBytes {
		maxStringBytes = sourceMaterializationMaxProofBytesV3
	}
	if sourceMaterializationMaxTextBytesV3 > maxStringBytes {
		maxStringBytes = sourceMaterializationMaxTextBytesV3
	}
	if err := scanSourceMaterializationPacketLexicalLimitsV3(reader, maxBytes, maxStringBytes); err != nil {
		_ = restore()
		return err
	}
	if err := restore(); err != nil {
		return sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "rewind staged Packet after lexical preflight: %v", err)
	}
	if err := scanSourceMaterializationPacketStructureV3(reader, maxBytes, limits); err != nil {
		_ = restore()
		return err
	}
	if err := restore(); err != nil {
		return sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "rewind staged Packet after structural preflight: %v", err)
	}
	return nil
}

func scanSourceMaterializationPacketLexicalLimitsV3(reader io.Reader, maxBytes int64, maxStringBytes uint64) error {
	limited := &io.LimitedReader{R: reader, N: maxBytes + 1}
	buffered := bufio.NewReaderSize(limited, 64*1024)
	var total, stringBytes uint64
	depth := 0
	inString := false
	escaped := false
	unicodeDigits := 0
	unicodeValue := uint16(0)
	pendingHighSurrogate := false
	expectLowSurrogateU := false
	for {
		character, size, readErr := buffered.ReadRune()
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return sourceMaterializationV3Error(sourceMaterializationFailureIssuerUnavailableV3, "stream-read staged Packet: %v", readErr)
		}
		if character == utf8.RuneError && size == 1 {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 contains invalid UTF-8")
		}
		total += uint64(size)
		if int64(total) > maxBytes {
			return sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "Packet v3 exceeds its wire budget")
		}
		if inString {
			if character < 0x20 {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 contains an unescaped control character")
			}
			if unicodeDigits > 0 {
				digit, ok := sourceMaterializationHexDigitV3(character)
				if !ok {
					return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 contains an invalid Unicode escape")
				}
				unicodeValue = unicodeValue*16 + digit
				unicodeDigits--
				if unicodeDigits == 0 {
					switch {
					case unicodeValue >= 0xd800 && unicodeValue <= 0xdbff:
						if pendingHighSurrogate {
							return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 contains consecutive high surrogates")
						}
						pendingHighSurrogate = true
					case unicodeValue >= 0xdc00 && unicodeValue <= 0xdfff:
						if !pendingHighSurrogate {
							return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 contains an unpaired low surrogate")
						}
						pendingHighSurrogate = false
					default:
						if pendingHighSurrogate {
							return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 contains an unpaired high surrogate")
						}
					}
					unicodeValue = 0
				}
			} else if escaped {
				escaped = false
				if expectLowSurrogateU {
					if character != 'u' {
						return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 contains an unpaired high surrogate")
					}
					expectLowSurrogateU = false
					unicodeDigits = 4
				} else if character == 'u' {
					unicodeDigits = 4
				} else if character != '"' && character != '\\' && character != '/' && character != 'b' && character != 'f' && character != 'n' && character != 'r' && character != 't' {
					return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 contains an invalid JSON escape")
				}
			} else {
				switch character {
				case '\\':
					escaped = true
					if pendingHighSurrogate {
						expectLowSurrogateU = true
					}
				case '"':
					if pendingHighSurrogate {
						return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 contains an unpaired high surrogate")
					}
					inString = false
					stringBytes = 0
				default:
					if pendingHighSurrogate {
						return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 contains an unpaired high surrogate")
					}
				}
			}
			if inString {
				stringBytes += uint64(size)
				if stringBytes > maxStringBytes {
					return sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "Packet v3 JSON string exceeds its pre-allocation limit")
				}
			}
			continue
		}
		switch character {
		case '"':
			inString = true
			stringBytes = 0
		case '{', '[':
			depth++
			if depth > sourceMaterializationMaxJSONDepthV3 {
				return sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "Packet v3 JSON nesting exceeds its pre-allocation limit")
			}
		case '}', ']':
			depth--
			if depth < 0 {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 JSON delimiters are unbalanced")
			}
		}
	}
	if total == 0 || inString || escaped || unicodeDigits != 0 || pendingHighSurrogate || depth != 0 {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 JSON is incomplete")
	}
	return nil
}

func sourceMaterializationHexDigitV3(value rune) (uint16, bool) {
	switch {
	case value >= '0' && value <= '9':
		return uint16(value - '0'), true
	case value >= 'a' && value <= 'f':
		return uint16(value-'a') + 10, true
	case value >= 'A' && value <= 'F':
		return uint16(value-'A') + 10, true
	default:
		return 0, false
	}
}

func scanSourceMaterializationPacketStructureV3(reader io.Reader, maxBytes int64, limits sourceMaterializationPublishedLimitsV3) error {
	maxTokens := uint64(sourceMaterializationBaseTokenAllowanceV3) + limits.MaxSetChunks*16 + limits.MaxSetComponentCount*32 + limits.MaxSetSegments*32
	decoder := json.NewDecoder(&io.LimitedReader{R: reader, N: maxBytes + 1})
	decoder.UseNumber()
	frames := make([]sourceMaterializationJSONFrameV3, 0, 16)
	rootValues := uint64(0)
	tokenCount := uint64(0)

	acceptValue := func() (string, error) {
		if len(frames) == 0 {
			rootValues++
			if rootValues != 1 {
				return "", sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 has multiple root values")
			}
			return "$", nil
		}
		frame := &frames[len(frames)-1]
		if frame.kind == '[' {
			frame.count++
			if frame.count > frame.arrayLimit {
				return "", sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "Packet v3 JSON array %s exceeds its pre-allocation limit", frame.path)
			}
			return frame.path + "[]", nil
		}
		if frame.expectingKey {
			return "", sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 object value has no key")
		}
		path := frame.path + "." + frame.currentKey
		frame.expectingKey = true
		frame.currentKey = ""
		return path, nil
	}

	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "stream-parse Packet v3 structure: %v", err)
		}
		tokenCount++
		if tokenCount > maxTokens {
			return sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "Packet v3 JSON token count exceeds its pre-allocation limit")
		}
		if len(frames) > 0 {
			frame := &frames[len(frames)-1]
			if frame.kind == '{' && frame.expectingKey {
				if delimiter, ok := token.(json.Delim); !ok || delimiter != '}' {
					key, ok := token.(string)
					if !ok {
						return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 object key is not a string")
					}
					if len(key) > sourceMaterializationMaxTextBytesV3 {
						return sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "Packet v3 object key exceeds its pre-allocation limit")
					}
					normalized := normalizeSourceMaterializationRealmStringV3(key)
					if _, duplicate := frame.keys[normalized]; duplicate {
						return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 contains duplicate normalized object key %q", normalized)
					}
					frame.keys[normalized] = struct{}{}
					frame.count++
					if frame.count > sourceMaterializationMaxObjectMembersV3 {
						return sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "Packet v3 object exceeds its pre-allocation member limit")
					}
					frame.expectingKey = false
					frame.currentKey = normalized
					continue
				}
			}
		}

		switch value := token.(type) {
		case json.Delim:
			switch value {
			case '{', '[':
				path, err := acceptValue()
				if err != nil {
					return err
				}
				frame := sourceMaterializationJSONFrameV3{kind: value, path: path}
				if value == '{' {
					frame.expectingKey = true
					frame.keys = make(map[string]struct{})
				} else {
					frame.arrayLimit = sourceMaterializationPacketArrayLimitV3(path, limits)
				}
				frames = append(frames, frame)
				if len(frames) > sourceMaterializationMaxJSONDepthV3 {
					return sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "Packet v3 JSON nesting exceeds its pre-allocation limit")
				}
			case '}':
				if len(frames) == 0 || frames[len(frames)-1].kind != '{' || !frames[len(frames)-1].expectingKey {
					return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 object is structurally incomplete")
				}
				frames = frames[:len(frames)-1]
			case ']':
				if len(frames) == 0 || frames[len(frames)-1].kind != '[' {
					return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 array is structurally incomplete")
				}
				frames = frames[:len(frames)-1]
			default:
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 contains an invalid delimiter")
			}
		default:
			path, err := acceptValue()
			if err != nil {
				return err
			}
			if text, ok := value.(string); ok && uint64(len(text)) > sourceMaterializationPacketStringLimitV3(path, limits) {
				return sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "Packet v3 JSON string %s exceeds its field limit", path)
			}
		}
	}
	if len(frames) != 0 || rootValues != 1 {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 JSON structure is incomplete")
	}
	return nil
}

func sourceMaterializationPacketArrayLimitV3(path string, limits sourceMaterializationPublishedLimitsV3) uint64 {
	switch path {
	case "$.orderedSegments", "$.closureSetManifest.segments":
		return limits.MaxSetSegments
	case "$.semanticPayload.materializationContext.sourceComponentDigests",
		"$.semanticPayload.materializationContext.worldAndClosureComponentDigests",
		"$.semanticPayload.materializationCoverage.components",
		"$.semanticPayload.materializationCoverage.requiredRefs",
		"$.semanticPayload.materializationCoverage.optionalRefs",
		"$.semanticPayload.materializationCoverage.crossReferenceChecks":
		return limits.MaxSetComponentCount
	case "$.semanticPayload.materializationCoverage.requiredSections":
		return sourceMaterializationMinArrayEntriesV3
	}
	if path == "$.orderedSegments[].segmentManifest.components" || path == "$.orderedSegments[].orderedComponents" {
		return limits.MaxSegmentComponentCount
	}
	if path == "$.orderedSegments[].segmentManifest.chunks" || path == "$.orderedSegments[].orderedComponents[].canonicalBytes" {
		return limits.MaxSegmentChunks
	}
	if path == "$.semanticPayload.materializationContext.dependencyClosure.incidentRelationships" ||
		path == "$.semanticPayload.materializationContext.dependencyClosure.endpointEntities" ||
		path == "$.semanticPayload.materializationContext.dependencyClosure.explicitEntities" ||
		path == "$.semanticPayload.materializationContext.dependencyClosure.explicitRelationships" ||
		path == "$.semanticPayload.materializationContext.dependencyClosure.explicitDependencies" {
		return limits.MaxSetComponentCount
	}
	if limits.MaxSetChunks > 16384 {
		return limits.MaxSetChunks
	}
	return 16384
}

func sourceMaterializationPacketStringLimitV3(path string, limits sourceMaterializationPublishedLimitsV3) uint64 {
	if path == "$.orderedSegments[].orderedComponents[].canonicalBytes[]" {
		return uint64(base64.RawURLEncoding.EncodedLen(int(limits.MaxChunkBytes)))
	}
	if path == "$.packetProof.compactJws" || path == "$.packetProof.signedPayload" {
		return sourceMaterializationMaxProofBytesV3
	}
	return sourceMaterializationMaxTextBytesV3
}
