package contracttest

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

const expectedAccessPolicyDigestV4 = "34f338ae76cbd85de58054cd6fc4d0ee18500030a0bc12f091e88d46f2fc572f"

func TestSourceMaterializationProductionAdapterSourceContract(t *testing.T) {
	issuer := parseGoSource(t, "..", "source_materialization_issuer.go")
	server := parseGoSource(t, "..", "server.go")

	requiredMethods := map[string]bool{
		"newAccountRealmSourceMaterializationIssuer":                false,
		"AcquireRealmSourceMaterialization":                         false,
		"FetchCurrentRealmSourceMaterializationJWKS":                false,
		"RevalidateRealmSourceMaterializationAccount":               false,
		"WithCurrentRealmSourceMaterializationAccount":              false,
		"runtimeAgentSourceMaterializationHTTPResponse":             false,
		"classifyAccountRealmSourceMaterializationAcquisitionError": false,
	}
	for _, declaration := range issuer.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok {
			continue
		}
		if _, required := requiredMethods[function.Name.Name]; required {
			requiredMethods[function.Name.Name] = true
		}
	}
	for name, found := range requiredMethods {
		if !found {
			t.Errorf("production adapter function %s is missing", name)
		}
	}

	accountCalls := selectorsOnReceiverField(issuer, "issuer", "account")
	for _, method := range []string{
		"AcquireRealmSourceMaterialization",
		"FetchCurrentRealmSourceMaterializationJWKS",
		"RevalidateRealmSourceMaterializationAccount",
		"WithCurrentRealmSourceMaterializationAccount",
	} {
		if !accountCalls[method] {
			t.Errorf("production adapter does not delegate %s to Account authority", method)
		}
	}

	if got := stringConstant(t, issuer, "sourceMaterializationAccessPolicyDigestV4"); got != expectedAccessPolicyDigestV4 {
		t.Errorf("access policy digest = %q, want %q", got, expectedAccessPolicyDigestV4)
	}

	serverCalls := calledNames(server)
	if !serverCalls["newAccountRealmSourceMaterializationIssuer"] {
		t.Error("gRPC server does not construct the Account-backed Realm source issuer")
	}
	if !serverCalls["SetRealmSourceMaterializationIssuer"] {
		t.Error("gRPC server does not install the Realm source issuer on Runtime")
	}

	for _, file := range []*ast.File{issuer, server} {
		for _, literal := range stringLiterals(t, file) {
			for _, forbidden := range []string{
				"agent.identity.project",
				"realm_source.snapshot.bind",
				"realm.source-materialization-packet/v2",
			} {
				if strings.Contains(literal, forbidden) {
					t.Errorf("production wiring contains forbidden legacy/local Realm authority %q", forbidden)
				}
			}
		}
	}
}

func parseGoSource(t *testing.T, elements ...string) *ast.File {
	t.Helper()
	path := filepath.Join(elements...)
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	file, err := parser.ParseFile(token.NewFileSet(), path, source, parser.AllErrors)
	if err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return file
}

func selectorsOnReceiverField(file *ast.File, receiver string, field string) map[string]bool {
	selectors := map[string]bool{}
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		method, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		receiverField, ok := method.X.(*ast.SelectorExpr)
		if !ok || receiverField.Sel.Name != field {
			return true
		}
		identifier, ok := receiverField.X.(*ast.Ident)
		if ok && identifier.Name == receiver {
			selectors[method.Sel.Name] = true
		}
		return true
	})
	return selectors
}

func calledNames(file *ast.File) map[string]bool {
	names := map[string]bool{}
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		switch function := call.Fun.(type) {
		case *ast.Ident:
			names[function.Name] = true
		case *ast.SelectorExpr:
			names[function.Sel.Name] = true
		}
		return true
	})
	return names
}

func stringConstant(t *testing.T, file *ast.File, name string) string {
	t.Helper()
	for _, declaration := range file.Decls {
		generic, ok := declaration.(*ast.GenDecl)
		if !ok || generic.Tok != token.CONST {
			continue
		}
		for _, spec := range generic.Specs {
			value, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			for index, identifier := range value.Names {
				if identifier.Name != name || index >= len(value.Values) {
					continue
				}
				literal, ok := value.Values[index].(*ast.BasicLit)
				if !ok || literal.Kind != token.STRING {
					t.Fatalf("constant %s is not a string literal", name)
				}
				resolved, err := strconv.Unquote(literal.Value)
				if err != nil {
					t.Fatalf("unquote constant %s: %v", name, err)
				}
				return resolved
			}
		}
	}
	t.Fatalf("constant %s is missing", name)
	return ""
}

func stringLiterals(t *testing.T, file *ast.File) []string {
	t.Helper()
	literals := []string{}
	ast.Inspect(file, func(node ast.Node) bool {
		literal, ok := node.(*ast.BasicLit)
		if !ok || literal.Kind != token.STRING {
			return true
		}
		resolved, err := strconv.Unquote(literal.Value)
		if err != nil {
			t.Fatalf("unquote source literal: %v", err)
		}
		literals = append(literals, resolved)
		return true
	})
	return literals
}
