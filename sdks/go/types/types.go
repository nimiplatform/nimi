package types

import "context"

type CoreMethodKind string

const (
	CoreMethodUnary        CoreMethodKind = "unary"
	CoreMethodServerStream CoreMethodKind = "server_stream"
	CoreMethodClientStream CoreMethodKind = "client_stream"
	CoreMethodBidiStream   CoreMethodKind = "bidi_stream"
)

type CoreMetadata map[string]string

type CoreUnaryRequest struct {
	Context   context.Context
	MethodID  string
	Metadata  CoreMetadata
	Body      []byte
	TimeoutMS int64
}

type CoreStreamRequest struct {
	Context   context.Context
	MethodID  string
	Metadata  CoreMetadata
	Body      []byte
	TimeoutMS int64
}

type CoreErrorShape struct {
	Code    string
	Message string
	Details []byte
}
