package localruntime

import (
	"strconv"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
)

func resolvePageBounds(pageToken string, filterDigest string, pageSizeRaw int32, defaultPageSize int, maxPageSize int, total int) (start int, end int, nextPageToken string, err error) {
	pageSize := int(pageSizeRaw)
	if pageSize <= 0 {
		pageSize = defaultPageSize
	}
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}

	cursor, err := pagination.ValidatePageToken(pageToken, filterDigest)
	if err != nil {
		return 0, 0, "", err
	}
	start = 0
	if cursor != "" {
		idx, convErr := strconv.Atoi(cursor)
		if convErr != nil || idx < 0 || idx > total {
			return 0, 0, "", paginationTokenInvalid()
		}
		start = idx
	}
	end = start + pageSize
	if end > total {
		end = total
	}
	if end < total {
		nextPageToken = pagination.Encode(strconv.Itoa(end), filterDigest)
	}
	return start, end, nextPageToken, nil
}

func paginationTokenInvalid() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
}
