package main

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

const (
	profileFull       = "full"
	profileFast       = "fast"
	profileDeveloper  = "developer"
	profileOwnerBatch = "owner-batch"
)

var fastProfilePackages = []string{
	runtimeModulePrefix + "internal/grpcerr",
	runtimeModulePrefix + "internal/idempotency",
	runtimeModulePrefix + "internal/pagination",
	runtimeModulePrefix + "internal/protocol/envelope",
	runtimeModulePrefix + "internal/providerregistry",
	runtimeModulePrefix + "internal/runtimeidentity",
	runtimeModulePrefix + "internal/scopecatalog",
	runtimeModulePrefix + "internal/spendvisibility",
	runtimeModulePrefix + "internal/streamutil",
	runtimeModulePrefix + "internal/texttarget",
	runtimeModulePrefix + "internal/usagemetrics",
}

func fastCollectionRequest() testCollectionRequest {
	return newTestCollectionRequestWithMode(fastProfilePackages, "", 4, 4, false)
}

func selectDiagnosticRefs(
	checklist []checklistItemSpec,
	packageSelectors []string,
	testSelectors []string,
) ([]testRef, error) {
	allRefs := make([]testRef, 0)
	seen := make(map[string]struct{})
	for _, item := range checklist {
		for _, ref := range item.Tests {
			if _, ok := seen[ref.String()]; ok {
				continue
			}
			seen[ref.String()] = struct{}{}
			allRefs = append(allRefs, ref)
		}
	}

	selected := make([]testRef, 0, len(allRefs))
	matchedPackages := make(map[string]bool, len(packageSelectors))
	matchedTests := make(map[string]bool, len(testSelectors))
	for _, ref := range allRefs {
		if len(packageSelectors) > 0 {
			matched := false
			for _, selector := range packageSelectors {
				if packageMatches(ref.Package, selector) {
					matched = true
					matchedPackages[selector] = true
				}
			}
			if !matched {
				continue
			}
		}
		if len(testSelectors) > 0 {
			matched := false
			for _, selector := range testSelectors {
				if ref.Name == selector {
					matched = true
					matchedTests[selector] = true
				}
			}
			if !matched {
				continue
			}
		}
		selected = append(selected, ref)
	}

	for _, selector := range packageSelectors {
		if !matchedPackages[selector] {
			return nil, fmt.Errorf("package selector %q matched no compliance-referenced tests", selector)
		}
	}
	for _, selector := range testSelectors {
		if !matchedTests[selector] {
			return nil, fmt.Errorf("test selector %q is not a compliance-referenced test", selector)
		}
	}
	if len(selected) == 0 {
		return nil, fmt.Errorf("diagnostic selection resolved to zero referenced tests")
	}
	sort.Slice(selected, func(i int, j int) bool {
		if selected[i].Package == selected[j].Package {
			return selected[i].Name < selected[j].Name
		}
		return selected[i].Package < selected[j].Package
	})
	return selected, nil
}

func packageMatches(packagePath string, selector string) bool {
	selector = strings.TrimSpace(strings.ReplaceAll(selector, "\\", "/"))
	selector = strings.TrimPrefix(selector, "./")
	selector = strings.TrimSuffix(selector, "/")
	if selector == "" {
		return false
	}
	return packagePath == selector || strings.HasSuffix(packagePath, "/"+selector)
}

func diagnosticCollectionRequest(refs []testRef) testCollectionRequest {
	packagesSet := make(map[string]struct{})
	topLevelTests := make(map[string]struct{})
	for _, ref := range refs {
		packagesSet[ref.Package] = struct{}{}
		topLevel := strings.SplitN(ref.Name, "/", 2)[0]
		topLevelTests[topLevel] = struct{}{}
	}
	packages := make([]string, 0, len(packagesSet))
	for packagePath := range packagesSet {
		packages = append(packages, packagePath)
	}
	sort.Strings(packages)
	tests := make([]string, 0, len(topLevelTests))
	for testName := range topLevelTests {
		tests = append(tests, regexp.QuoteMeta(testName))
	}
	sort.Strings(tests)
	return newTestCollectionRequest(packages, "^("+strings.Join(tests, "|")+")$")
}

func diagnosticPackageCollectionRequest(packageSelectors []string) (testCollectionRequest, error) {
	packagesSet := make(map[string]struct{}, len(packageSelectors))
	for _, selector := range packageSelectors {
		normalized := strings.TrimSpace(strings.ReplaceAll(selector, "\\", "/"))
		normalized = strings.TrimSuffix(normalized, "/")
		if normalized == "" || normalized == "." || normalized == "./" {
			return testCollectionRequest{}, fmt.Errorf("invalid package selector %q", selector)
		}
		if !strings.HasPrefix(normalized, "./") && !strings.HasPrefix(normalized, runtimeModulePrefix) {
			normalized = "./" + strings.TrimPrefix(normalized, "/")
		}
		packagesSet[normalized] = struct{}{}
	}
	packages := make([]string, 0, len(packagesSet))
	for packagePath := range packagesSet {
		packages = append(packages, packagePath)
	}
	sort.Strings(packages)
	return newTestCollectionRequest(packages, ""), nil
}

func referencedTestsForPackages(checklist []checklistItemSpec, packageSelectors []string) []testRef {
	refs := make([]testRef, 0)
	seen := make(map[string]struct{})
	for _, item := range checklist {
		for _, ref := range item.Tests {
			matched := false
			for _, selector := range packageSelectors {
				if packageMatches(ref.Package, selector) {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
			if _, ok := seen[ref.String()]; ok {
				continue
			}
			seen[ref.String()] = struct{}{}
			refs = append(refs, ref)
		}
	}
	sort.Slice(refs, func(i int, j int) bool {
		if refs[i].Package == refs[j].Package {
			return refs[i].Name < refs[j].Name
		}
		return refs[i].Package < refs[j].Package
	})
	return refs
}

func missingPassingRefs(refs []testRef, passedTests map[string]bool) []string {
	missing := make([]string, 0)
	for _, ref := range refs {
		if !passedTests[ref.String()] {
			missing = append(missing, ref.String())
		}
	}
	sort.Strings(missing)
	return missing
}

func runOwnerBatchCommands(ctx context.Context, progress *progressReporter) []commandCheckResult {
	specs := []commandCheckSpec{
		{Name: "owner-batch-go-build", Binary: "go", Args: []string{"build", "./..."}},
		{Name: "owner-batch-go-vet", Binary: "go", Args: []string{"vet", "./..."}},
	}
	results := make([]commandCheckResult, 0, len(specs))
	for _, spec := range specs {
		results = append(results, runCommandCheck(ctx, spec, progress))
	}
	return results
}
