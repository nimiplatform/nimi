//go:build realm_v3_full_data

package runtimeagent

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
)

func readRealmV3FullDataAttemptLedgerV1(
	target string,
	request realmV3FullDataPartitionRequestV1,
) (realmV3FullDataAttemptLedgerV1, bool, error) {
	var ledger realmV3FullDataAttemptLedgerV1
	found, err := readRealmV3FullDataPrivateJSONFileV1(target, &ledger)
	if err != nil || !found {
		return ledger, found, err
	}
	expectedHash, err := realmV3FullDataAttemptLedgerContentHashV1(ledger)
	if err != nil || expectedHash != ledger.ContentHash || !isLowerSHA256V3(ledger.ContentHash) ||
		ledger.SchemaVersion != realmV3FullDataAttemptLedgerSchemaV1 || ledger.InputDigest != request.InputDigest ||
		ledger.PartitionKey != request.PartitionKey || ledger.SourceRefHash != request.Source.SourceRefHash ||
		ledger.LiveEnvironmentDigest != realmV3FullDataLiveEnvironmentDigestValueV1(request.LiveEnvironment) || len(ledger.Generations) == 0 {
		return realmV3FullDataAttemptLedgerV1{}, false, fmt.Errorf("full-data attempt ledger binding is invalid")
	}
	for index, generation := range ledger.Generations {
		expectedGeneration := uint64(index + 1)
		if generation.Generation != expectedGeneration ||
			generation.RequestIDHash != sha256HexBytes([]byte(realmV3FullDataGenerationRequestIDV1(request, expectedGeneration))) ||
			!isLowerSHA256V3(generation.RequestIDHash) || generation.ReasonCode == "" {
			return realmV3FullDataAttemptLedgerV1{}, false, fmt.Errorf("full-data attempt ledger generation %d is invalid", expectedGeneration)
		}
		if generation.Status != realmV3FullDataAttemptStatusFailedV1 && index != len(ledger.Generations)-1 {
			return realmV3FullDataAttemptLedgerV1{}, false, fmt.Errorf("non-final full-data attempt generation is not terminal failed")
		}
		if generation.Status != realmV3FullDataAttemptStatusFailedV1 && generation.Status != realmV3FullDataAttemptStatusActiveV1 && generation.Status != realmV3FullDataAttemptStatusCommittedV1 {
			return realmV3FullDataAttemptLedgerV1{}, false, fmt.Errorf("full-data attempt generation status is not admitted")
		}
	}
	return ledger, true, nil
}

func writeRealmV3FullDataAttemptLedgerV1(target string, ledger realmV3FullDataAttemptLedgerV1) error {
	hash, err := realmV3FullDataAttemptLedgerContentHashV1(ledger)
	if err != nil {
		return err
	}
	ledger.ContentHash = hash
	var current realmV3FullDataAttemptLedgerV1
	found, readErr := readRealmV3FullDataPrivateJSONFileV1(target, &current)
	if readErr != nil {
		return readErr
	}
	if found {
		currentHash, hashErr := realmV3FullDataAttemptLedgerContentHashV1(current)
		if hashErr != nil || currentHash != current.ContentHash || !isLowerSHA256V3(current.ContentHash) {
			return fmt.Errorf("existing full-data attempt ledger is corrupt")
		}
		if err := validateRealmV3FullDataAttemptLedgerTransitionV1(current, ledger); err != nil {
			return err
		}
	}
	return writeRealmV3FullDataPrivateJSONAtomicV1(target, ledger)
}

func validateRealmV3FullDataAttemptLedgerTransitionV1(current, next realmV3FullDataAttemptLedgerV1) error {
	current.ContentHash, next.ContentHash = "", ""
	if current.SchemaVersion != next.SchemaVersion || current.InputDigest != next.InputDigest ||
		current.PartitionKey != next.PartitionKey || current.SourceRefHash != next.SourceRefHash ||
		current.LiveEnvironmentDigest != next.LiveEnvironmentDigest || len(current.Generations) == 0 ||
		len(next.Generations) < len(current.Generations) || len(next.Generations) > len(current.Generations)+1 {
		return fmt.Errorf("full-data attempt ledger authority changed")
	}
	for index := 0; index < len(current.Generations)-1; index++ {
		if !reflect.DeepEqual(current.Generations[index], next.Generations[index]) {
			return fmt.Errorf("closed full-data attempt generation %d changed", index+1)
		}
	}
	currentLast := current.Generations[len(current.Generations)-1]
	nextSame := next.Generations[len(current.Generations)-1]
	if currentLast.Generation != nextSame.Generation || currentLast.RequestIDHash != nextSame.RequestIDHash {
		return fmt.Errorf("active full-data attempt generation identity changed")
	}
	if currentLast.Status == realmV3FullDataAttemptStatusFailedV1 || currentLast.Status == realmV3FullDataAttemptStatusCommittedV1 {
		if !reflect.DeepEqual(currentLast, nextSame) {
			return fmt.Errorf("terminal full-data attempt generation changed")
		}
	} else if currentLast.Status != realmV3FullDataAttemptStatusActiveV1 ||
		(nextSame.Status != realmV3FullDataAttemptStatusActiveV1 && nextSame.Status != realmV3FullDataAttemptStatusFailedV1 && nextSame.Status != realmV3FullDataAttemptStatusCommittedV1) {
		return fmt.Errorf("full-data attempt generation transition is not admitted")
	} else if nextSame.Status == realmV3FullDataAttemptStatusActiveV1 && !reflect.DeepEqual(currentLast, nextSame) {
		return fmt.Errorf("active full-data attempt generation changed without terminalization")
	}
	if len(next.Generations) == len(current.Generations)+1 {
		appended := next.Generations[len(next.Generations)-1]
		if nextSame.Status != realmV3FullDataAttemptStatusFailedV1 || appended.Generation != currentLast.Generation+1 ||
			appended.Status != realmV3FullDataAttemptStatusActiveV1 {
			return fmt.Errorf("full-data attempt generation append is not closed")
		}
	}
	return nil
}

func realmV3FullDataAttemptLedgerContentHashV1(ledger realmV3FullDataAttemptLedgerV1) (string, error) {
	ledger.ContentHash = ""
	return realmV3FullDataClosedContentHashV1(realmV3FullDataAttemptLedgerSchemaV1, ledger)
}

func realmV3FullDataClosedContentHashV1(domain string, value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("encode closed full-data content: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var document map[string]any
	if err := decoder.Decode(&document); err != nil {
		return "", fmt.Errorf("normalize closed full-data content: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return "", fmt.Errorf("normalize closed full-data content trailing JSON")
	}
	delete(document, "contentHash")
	return realmV3FullDataCanonicalDomainHashV1(domain, document)
}

func markRealmV3FullDataGenerationFailedV1(
	runtimeRoot string,
	request realmV3FullDataPartitionRequestV1,
	generation uint64,
	reason string,
) error {
	path := realmV3FullDataAttemptLedgerPathV1(runtimeRoot, request.PartitionKey)
	ledger, found, err := readRealmV3FullDataAttemptLedgerV1(path, request)
	if err != nil || !found || len(ledger.Generations) == 0 || ledger.Generations[len(ledger.Generations)-1].Generation != generation {
		return fmt.Errorf("read active attempt ledger: found=%v err=%w", found, err)
	}
	ledger.Generations[len(ledger.Generations)-1].Status = realmV3FullDataAttemptStatusFailedV1
	if strings.TrimSpace(reason) == "" {
		reason = "runtime_failed"
	}
	ledger.Generations[len(ledger.Generations)-1].ReasonCode = reason
	return writeRealmV3FullDataAttemptLedgerV1(path, ledger)
}

func markRealmV3FullDataGenerationCommittedV1(
	runtimeRoot string,
	request realmV3FullDataPartitionRequestV1,
	generation uint64,
) (realmV3FullDataAttemptLedgerV1, error) {
	path := realmV3FullDataAttemptLedgerPathV1(runtimeRoot, request.PartitionKey)
	ledger, found, err := readRealmV3FullDataAttemptLedgerV1(path, request)
	if err != nil || !found || len(ledger.Generations) == 0 || ledger.Generations[len(ledger.Generations)-1].Generation != generation {
		return realmV3FullDataAttemptLedgerV1{}, fmt.Errorf("read committed attempt ledger: found=%v err=%w", found, err)
	}
	ledger.Generations[len(ledger.Generations)-1].Status = realmV3FullDataAttemptStatusCommittedV1
	ledger.Generations[len(ledger.Generations)-1].ReasonCode = "committed"
	if err := writeRealmV3FullDataAttemptLedgerV1(path, ledger); err != nil {
		return realmV3FullDataAttemptLedgerV1{}, err
	}
	return ledger, nil
}
