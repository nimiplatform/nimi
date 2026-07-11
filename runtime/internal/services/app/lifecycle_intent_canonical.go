package app

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"golang.org/x/text/unicode/norm"
)

const (
	lifecycleCanonicalImpactSchemaVersion = 1
	lifecycleDisplayContractVersion       = 1
)

func canonicalLifecycleImpactJSON(impact *runtimev1.AppLifecycleCanonicalImpact) (string, error) {
	if impact == nil || impact.GetSchemaVersion() != lifecycleCanonicalImpactSchemaVersion ||
		impact.GetDisplayContractVersion() != lifecycleDisplayContractVersion || impact.GetAccountGeneration() == 0 {
		return "", fmt.Errorf("canonical lifecycle impact is incomplete")
	}
	action, ok := lifecycleActionName(impact.GetAction())
	if !ok {
		return "", fmt.Errorf("canonical lifecycle action is invalid")
	}
	flags := append([]string(nil), impact.GetImpactFlags()...)
	for index := range flags {
		flags[index] = norm.NFC.String(flags[index])
	}
	sort.Strings(flags)
	quotedFlags := make([]string, len(flags))
	for index, flag := range flags {
		quoted, err := quoteCanonicalJSONString(flag)
		if err != nil {
			return "", err
		}
		quotedFlags[index] = quoted
	}
	appID, err := quoteCanonicalJSONString(impact.GetAppId())
	if err != nil {
		return "", err
	}
	actionJSON, _ := quoteCanonicalJSONString(action)
	artifactDigest, err := quoteCanonicalJSONString(impact.GetArtifactDigest())
	if err != nil {
		return "", err
	}
	releaseRef, err := quoteCanonicalJSONString(impact.GetReleaseRef())
	if err != nil {
		return "", err
	}
	options := impact.GetDestructiveOptions()
	targetJobID := "\"\""
	deleteDurableData := false
	healthRepairAction := uint64(0)
	if options != nil {
		targetJobID, err = quoteCanonicalJSONString(strings.TrimSpace(options.GetTargetJobId()))
		if err != nil {
			return "", err
		}
		deleteDurableData = options.GetDeleteDurableData()
		healthRepairAction = uint64(options.GetHealthRepairAction())
	}
	return "{" +
		"\"account_generation\":" + strconv.FormatUint(impact.GetAccountGeneration(), 10) + "," +
		"\"action\":" + actionJSON + "," +
		"\"adoption_generation\":" + strconv.FormatUint(impact.GetAdoptionGeneration(), 10) + "," +
		"\"app_id\":" + appID + "," +
		"\"artifact_digest\":" + artifactDigest + "," +
		"\"destructive_options\":{" +
		"\"delete_durable_data\":" + strconv.FormatBool(deleteDurableData) + "," +
		"\"health_repair_action\":" + strconv.FormatUint(healthRepairAction, 10) + "," +
		"\"target_job_id\":" + targetJobID + "}," +
		"\"display_contract_version\":" + strconv.FormatUint(uint64(impact.GetDisplayContractVersion()), 10) + "," +
		"\"impact_flags\":[" + strings.Join(quotedFlags, ",") + "]," +
		"\"release_ref\":" + releaseRef + "," +
		"\"schema_version\":" + strconv.FormatUint(uint64(impact.GetSchemaVersion()), 10) +
		"}", nil
}

func quoteCanonicalJSONString(value string) (string, error) {
	value = norm.NFC.String(value)
	if !utf8.ValidString(value) {
		return "", fmt.Errorf("canonical JSON string is not valid UTF-8")
	}
	var builder strings.Builder
	builder.Grow(len(value) + 2)
	builder.WriteByte('"')
	const hexDigits = "0123456789abcdef"
	for _, character := range value {
		switch character {
		case '"':
			builder.WriteString(`\"`)
		case '\\':
			builder.WriteString(`\\`)
		case '\b':
			builder.WriteString(`\b`)
		case '\t':
			builder.WriteString(`\t`)
		case '\n':
			builder.WriteString(`\n`)
		case '\f':
			builder.WriteString(`\f`)
		case '\r':
			builder.WriteString(`\r`)
		default:
			if character < 0x20 {
				builder.WriteString(`\u00`)
				builder.WriteByte(hexDigits[byte(character)>>4])
				builder.WriteByte(hexDigits[byte(character)&0x0f])
			} else {
				builder.WriteRune(character)
			}
		}
	}
	builder.WriteByte('"')
	return builder.String(), nil
}
