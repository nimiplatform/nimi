package productrelease

import (
	"fmt"
	"strings"
	"testing"
)

func TestCreateUpdateProbeAndRepairShareExactWindowsServiceCommand(t *testing.T) {
	for _, test := range []struct{ executable, createServiceValue string }{
		{`C:\Program Files\Nimi\Product\0.3.0\runtime\nimi.exe`, `"C:\Program Files\Nimi\Product\0.3.0\runtime\nimi.exe" serve`},
		{`D:\Applications\Nimi\Product\0.3.0\runtime\nimi.exe`, `D:\Applications\Nimi\Product\0.3.0\runtime\nimi.exe serve`},
		{`D:\应用 程序\Nimi\Product\0.3.0\runtime\nimi.exe`, `"D:\应用 程序\Nimi\Product\0.3.0\runtime\nimi.exe" serve`},
		{`\\server\programs\Nimi\Product\0.3.0\runtime\nimi.exe`, `\\server\programs\Nimi\Product\0.3.0\runtime\nimi.exe serve`},
	} {
		// Fixed valid paths use the exact Windows EscapeArg rule read from the
		// pinned Mgr.CreateService implementation: literal slashes, quote spaces.
		updateValue, err := RuntimeServiceCommand(test.executable)
		if err != nil || updateValue != test.createServiceValue {
			t.Fatalf("update != CreateService: %q %v", updateValue, err)
		}
		if strings.Count(updateValue, `\`) != strings.Count(test.executable, `\`) {
			t.Fatal("path backslashes were escaped as Go literals")
		}
		for _, consumer := range []string{"probe", "candidateUse", "forward-repair"} {
			observed, err := ParseRuntimeServiceCommand(updateValue)
			if err != nil || observed != test.executable {
				t.Fatalf("%s executable %q %v", consumer, observed, err)
			}
		}
		broken := fmt.Sprintf("%q serve", test.executable)
		if broken == updateValue {
			t.Fatal("regression fixture does not expose Go string-literal encoding")
		}
		if _, err := ParseRuntimeServiceCommand(broken); err == nil {
			t.Fatal("unpublished Go-escaped format accepted")
		}
	}
}
func TestServiceCommandRejectsOtherExecutablesAndAdditionalArguments(t *testing.T) {
	executable := `C:\Program Files\Nimi\Product\0.3.0\runtime\nimi.exe`
	valid, _ := RuntimeServiceCommand(executable)
	for _, invalid := range []string{valid + " --config C:\\untrusted", valid + " serve", strings.Replace(valid, " serve", " restart", 1), strings.Replace(valid, "nimi.exe", "other.exe", 1), strings.Replace(valid, "nimi.exe", "cmd.exe /c", 1), `"` + executable + ` serve`, executable + " serve", valid + " ", valid + "\x00", `"C:\Program Files\Nimi\Product\..\runtime\nimi.exe" serve`} {
		if _, err := ParseRuntimeServiceCommand(invalid); err == nil {
			t.Fatalf("invalid command accepted: %q", invalid)
		}
	}
	for _, invalid := range []string{"nimi.exe", `C:\\Nimi\runtime\nimi.exe`, `C:\Nimi\..\runtime\nimi.exe`, `C:\Nimi\runtime\other.exe`, `C:\Nimi\runtime\nimi.exe:stream`, `C:\Nimi\runtime\ni"mi.exe`} {
		if _, err := RuntimeServiceCommand(invalid); err == nil {
			t.Fatalf("invalid executable accepted: %q", invalid)
		}
	}
}
