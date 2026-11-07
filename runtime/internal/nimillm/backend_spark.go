package nimillm

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func sparkAPIPath(provider, base, resource string) (string, error) {
	if provider == "spark" {
		return "/v1" + resource, nil
	}
	if strings.HasSuffix(base, "/v2") {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	if strings.HasSuffix(base, "/x2") {
		return resource, nil
	}
	return "/x2" + resource, nil
}
