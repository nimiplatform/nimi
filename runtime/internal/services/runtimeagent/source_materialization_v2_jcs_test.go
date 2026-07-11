package runtimeagent

import (
	"math"
	"strconv"
	"strings"
	"testing"
)

func TestSourceMaterializationJCSMatchesRealmVectors(t *testing.T) {
	t.Parallel()
	value := map[string]any{
		"\u20ac": "Euro Sign",
		"\r":     "Carriage Return",
		"\ufb33": "Hebrew Letter Dalet With Dagesh",
		"1":      "One",
		"😀":      "Emoji: Grinning Face",
		"\u0080": "Control",
		"ö":      "Latin Small Letter O With Diaeresis",
	}
	canonical, err := canonicalizeSourceMaterializationJCS(value)
	if err != nil {
		t.Fatalf("canonicalizeSourceMaterializationJCS: %v", err)
	}
	want := "{\"\\r\":\"Carriage Return\",\"1\":\"One\",\"\u0080\":\"Control\",\"ö\":\"Latin Small Letter O With Diaeresis\",\"€\":\"Euro Sign\",\"😀\":\"Emoji: Grinning Face\",\"דּ\":\"Hebrew Letter Dalet With Dagesh\"}"
	if string(canonical) != want {
		t.Fatalf("canonical = %q, want %q", canonical, want)
	}

	numbers := map[string]any{
		"negativeZero": math.Copysign(0, -1),
		"fixedLow":     0.000001,
		"exponentLow":  0.0000001,
		"fixedHigh":    100000000000000000000.0,
		"exponentHigh": 1e21,
	}
	canonical, err = canonicalizeSourceMaterializationJCS(numbers)
	if err != nil {
		t.Fatalf("canonicalize numbers: %v", err)
	}
	if got, want := string(canonical), "{\"exponentHigh\":1e+21,\"exponentLow\":1e-7,\"fixedHigh\":100000000000000000000,\"fixedLow\":0.000001,\"negativeZero\":0}"; got != want {
		t.Fatalf("number canonical = %s, want %s", got, want)
	}
}

func TestSourceMaterializationJCSRejectsDuplicateAndNonFiniteValues(t *testing.T) {
	t.Parallel()
	if _, err := canonicalizeSourceMaterializationJCS([]byte(`{"a":1,"a":2}`)); err == nil {
		t.Fatal("duplicate JSON field was admitted")
	}
	for _, value := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		if _, err := canonicalizeSourceMaterializationJCS(map[string]any{"value": value}); err == nil {
			t.Fatalf("non-finite value %v was admitted", value)
		}
	}
	if _, err := hashSourceMaterializationDomainJCS("missing-nul", map[string]any{}); err == nil {
		t.Fatal("domain without NUL separator was admitted")
	}
}

func TestSourceMaterializationJCSMatchesRFC8785NumberVector(t *testing.T) {
	t.Parallel()
	canonical, err := canonicalizeSourceMaterializationJCS([]byte(`[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001]`))
	if err != nil {
		t.Fatalf("canonicalizeSourceMaterializationJCS: %v", err)
	}
	if got, want := string(canonical), `[333333333.3333333,1e+30,4.5,0.002,1e-27]`; got != want {
		t.Fatalf("canonical = %s, want %s", got, want)
	}
}

func TestSourceMaterializationJSONRejectsLoneSurrogatesBeforeDecode(t *testing.T) {
	t.Parallel()
	for _, raw := range []string{`"\ud800"`, `"\udfff"`, `"\ud800x"`, `"\ud800\u0041"`} {
		if _, err := decodeSourceMaterializationJSON([]byte(raw)); err == nil {
			t.Fatalf("lone surrogate %q was admitted", raw)
		}
	}
	canonical, err := canonicalizeSourceMaterializationJCS([]byte(`"\ud83d\ude00"`))
	if err != nil || string(canonical) != `"😀"` {
		t.Fatalf("valid surrogate pair: canonical=%q err=%v", canonical, err)
	}
}

func TestSourceMaterializationJSONEnforcesDecodeDepthBeforeRecursion(t *testing.T) {
	t.Parallel()
	accepted := strings.Repeat("[", 256) + "0" + strings.Repeat("]", 256)
	if _, err := decodeSourceMaterializationJSON([]byte(accepted)); err != nil {
		t.Fatalf("depth 256 rejected: %v", err)
	}
	rejected := strings.Repeat("[", 257) + "0" + strings.Repeat("]", 257)
	if _, err := decodeSourceMaterializationJSON([]byte(rejected)); err == nil {
		t.Fatal("depth 257 was admitted")
	}
}

func TestSourceMaterializationJCSRejectsUnsafeTypedIntegers(t *testing.T) {
	t.Parallel()
	if _, err := canonicalizeSourceMaterializationJCS(map[string]any{"value": int64(1 << 53)}); err == nil {
		t.Fatal("unsafe int64 was admitted")
	}
	if strconv.IntSize == 64 {
		if _, err := canonicalizeSourceMaterializationJCS(map[string]any{"value": int(1 << 53)}); err == nil {
			t.Fatal("unsafe int was admitted")
		}
	}
}

func TestSourceMaterializationCanonicalHashMatchesRealmLegacyVector(t *testing.T) {
	t.Parallel()
	hash, err := hashSourceMaterializationDomainlessJCS(map[string]any{
		"b": float64(2),
		"a": map[string]any{"y": true, "x": []any{"z"}},
	})
	if err != nil {
		t.Fatalf("hashSourceMaterializationDomainlessJCS: %v", err)
	}
	if hash != "e3431fd26fd4f62fd6d0957200a753ea3cc464e9798f50013e2b0d5f4f06f329" {
		t.Fatalf("hash = %s", hash)
	}
}
