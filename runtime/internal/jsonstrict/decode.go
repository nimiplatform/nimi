package jsonstrict

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// Decode rejects duplicate keys, unknown struct fields, and trailing JSON
// before returning a typed value. It is intentionally strict for generated
// external API carriers whose field closure is security-relevant.
func Decode(raw []byte, target any) error {
	if err := RejectDuplicateKeys(raw); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return fmt.Errorf("trailing JSON")
	}
	return nil
}

func RejectDuplicateKeys(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := scanValue(decoder); err != nil {
		return err
	}
	if token, err := decoder.Token(); !errors.Is(err, io.EOF) || token != nil {
		return fmt.Errorf("trailing JSON")
	}
	return nil
}

func scanValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delimiter {
	case '{':
		seen := make(map[string]struct{})
		for decoder.More() {
			keyToken, keyErr := decoder.Token()
			if keyErr != nil {
				return keyErr
			}
			key, ok := keyToken.(string)
			if !ok {
				return fmt.Errorf("object key is not a string")
			}
			if _, duplicate := seen[key]; duplicate {
				return fmt.Errorf("duplicate object key %q", key)
			}
			seen[key] = struct{}{}
			if err := scanValue(decoder); err != nil {
				return err
			}
		}
		end, err := decoder.Token()
		if err != nil || end != json.Delim('}') {
			return fmt.Errorf("object is not closed")
		}
	case '[':
		for decoder.More() {
			if err := scanValue(decoder); err != nil {
				return err
			}
		}
		end, err := decoder.Token()
		if err != nil || end != json.Delim(']') {
			return fmt.Errorf("array is not closed")
		}
	default:
		return fmt.Errorf("invalid JSON delimiter")
	}
	return nil
}
