package productrelease

import (
	"fmt"
	"strings"
)

// This closed command grammar has one literal executable and one serve arg.
// Windows filenames cannot contain quotes or control characters, so it needs
// none of Go string-literal escapes or generic command/shell interpretation.
// @nimi-authority: rule.nimi.runtime.service-operations.r054
func RuntimeServiceCommand(executable string) (string, error) {
	if err := validateRuntimeExecutableArgument(executable); err != nil {
		return "", err
	}
	if strings.Contains(executable, " ") {
		executable = `"` + executable + `"`
	}
	return executable + " serve", nil
}
func ParseRuntimeServiceCommand(command string) (string, error) {
	var executable string
	if strings.HasPrefix(command, `"`) {
		end := strings.Index(command[1:], `"`)
		if end < 0 {
			return "", fmt.Errorf("unadmitted service command")
		}
		end++
		if command[end+1:] != " serve" {
			return "", fmt.Errorf("unadmitted service arguments")
		}
		executable = command[1:end]
	} else {
		parts := strings.Split(command, " ")
		if len(parts) != 2 || parts[1] != "serve" {
			return "", fmt.Errorf("unadmitted service arguments")
		}
		executable = parts[0]
	}
	canonical, err := RuntimeServiceCommand(executable)
	if err != nil || canonical != command {
		return "", fmt.Errorf("noncanonical service command")
	}
	return executable, nil
}

func validateRuntimeExecutableArgument(executable string) error {
	if strings.ContainsAny(executable, "/\"<>|?*") {
		return fmt.Errorf("unadmitted executable argument")
	}
	for _, c := range executable {
		if c < 32 {
			return fmt.Errorf("unadmitted executable argument")
		}
	}
	var relative string
	if len(executable) >= 3 && executable[1:3] == ":\\" && ((executable[0] >= 'A' && executable[0] <= 'Z') || (executable[0] >= 'a' && executable[0] <= 'z')) {
		relative = executable[3:]
	} else if strings.HasPrefix(executable, `\\`) {
		relative = executable[2:]
	} else {
		return fmt.Errorf("absolute executable argument required")
	}
	parts := strings.Split(relative, `\`)
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.Contains(part, ":") || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") {
			return fmt.Errorf("noncanonical executable argument")
		}
	}
	if len(parts) < 2 || !strings.EqualFold(parts[len(parts)-1], "nimi.exe") {
		return fmt.Errorf("unadmitted runtime executable")
	}
	return nil
}
