package nimillm

import (
	"context"
	"reflect"
	"testing"
)

func TestProviderParameterObservationContainsOnlyClosedFieldNames(t *testing.T) {
	var status int
	var fields []string
	ctx := withProviderParameterObserver(context.Background(), func(code int, names []string) { status, fields = code, names })
	observeProviderParameterFailure(ctx, 400, map[string]any{"error": map[string]any{"message": "Unsupported sample_rate; user text and API key SECRET must never be observed"}})
	if status != 400 || !reflect.DeepEqual(fields, []string{"sample_rate"}) {
		t.Fatalf("unsafe or incomplete diagnostic: %d %+v", status, fields)
	}
}
