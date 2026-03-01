package pagination

import (
	"encoding/base64"
	"encoding/json"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// tokenPayload is the internal structure encoded in an opaque page token.
type tokenPayload struct {
	Cursor       string `json:"c"`
	FilterDigest string `json:"f,omitempty"`
}

// Encode creates an opaque page_token from a cursor position and filter digest.
// The token is base64url-encoded JSON (K-PAGE-002).
func Encode(cursor string, filterDigest string) string {
	payload := tokenPayload{
		Cursor:       cursor,
		FilterDigest: filterDigest,
	}
	data, _ := json.Marshal(payload)
	return base64.RawURLEncoding.EncodeToString(data)
}

// Decode extracts the cursor and filter digest from an opaque page token.
// Returns an error with PAGE_TOKEN_INVALID if the token is malformed.
func Decode(token string) (cursor string, filterDigest string, err error) {
	if token == "" {
		return "", "", nil
	}
	data, decodeErr := base64.RawURLEncoding.DecodeString(token)
	if decodeErr != nil {
		return "", "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
	}
	var payload tokenPayload
	if unmarshalErr := json.Unmarshal(data, &payload); unmarshalErr != nil {
		return "", "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
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
	data, _ := json.Marshal(parts)
	return fmt.Sprintf("%x", data)
}
