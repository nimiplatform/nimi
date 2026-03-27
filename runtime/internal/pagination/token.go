package pagination

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const maxEncodedTokenBytes = 1024

// tokenPayload is the internal structure encoded in an opaque page token.
type tokenPayload struct {
	Cursor       string `json:"c"`
	FilterDigest string `json:"f,omitempty"`
}

// Encode creates an opaque page_token from a cursor position and filter digest.
// The token is base64url-encoded JSON (K-PAGE-002).
func Encode(cursor string, filterDigest string) string {
	data := make([]byte, 0, len(cursor)+len(filterDigest)+16)
	data = append(data, `{"c":`...)
	data = strconv.AppendQuote(data, cursor)
	if filterDigest != "" {
		data = append(data, `,"f":`...)
		data = strconv.AppendQuote(data, filterDigest)
	}
	data = append(data, '}')
	return base64.RawURLEncoding.EncodeToString(data)
}

// Decode extracts the cursor and filter digest from an opaque page token.
// Returns an error with PAGE_TOKEN_INVALID if the token is malformed.
func Decode(token string) (cursor string, filterDigest string, err error) {
	if token == "" {
		return "", "", nil
	}
	if len(token) > maxEncodedTokenBytes {
		return "", "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
	}
	data, decodeErr := base64.RawURLEncoding.DecodeString(token)
	if decodeErr != nil {
		return "", "", fmt.Errorf(
			"pagination.Decode: base64 decode: %w",
			grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID),
		)
	}
	var payload tokenPayload
	if unmarshalErr := json.Unmarshal(data, &payload); unmarshalErr != nil {
		return "", "", fmt.Errorf(
			"pagination.Decode: unmarshal payload: %w",
			grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID),
		)
	}
	return payload.Cursor, payload.FilterDigest, nil
}

// ValidatePageToken decodes the token and verifies the filter digest matches.
// If the digest doesn't match, the token is invalid (filters changed between pages).
func ValidatePageToken(token string, currentFilterDigest string) (cursor string, err error) {
	if token == "" {
		return "", nil
	}
	cursor, storedDigest, err := Decode(token)
	if err != nil {
		return "", err
	}
	if storedDigest != currentFilterDigest {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
	}
	return cursor, nil
}

// FilterDigest computes a deterministic digest string from filter parameters.
// This is used to detect filter changes between pagination requests.
func FilterDigest(parts ...string) string {
	data := make([]byte, 0, len(parts)*8)
	data = append(data, '[')
	for index, part := range parts {
		if index > 0 {
			data = append(data, ',')
		}
		data = strconv.AppendQuote(data, part)
	}
	data = append(data, ']')
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
