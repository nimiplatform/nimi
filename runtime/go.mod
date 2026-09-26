module github.com/nimiplatform/nimi/runtime

go 1.26.6

require (
	github.com/Microsoft/go-winio v0.6.2
	github.com/dlclark/regexp2 v1.12.0
	github.com/fsnotify/fsnotify v1.10.1
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/modelcontextprotocol/go-sdk v1.8.0
	github.com/nimiplatform/nimi/nimi-cognition v0.0.0
	github.com/oklog/ulid/v2 v2.1.2
	github.com/santhosh-tekuri/jsonschema/v6 v6.0.3
	golang.org/x/image v0.46.0
	golang.org/x/mod v0.41.0
	golang.org/x/net v0.59.0
	golang.org/x/sys v0.48.0
	golang.org/x/text v0.42.0
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260825221802-da73d73af1c5
	google.golang.org/grpc v1.83.2
	google.golang.org/protobuf v1.36.12
	gopkg.in/yaml.v3 v3.0.1
	modernc.org/sqlite v1.58.0
)

require (
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/mattn/go-isatty v0.0.24 // indirect
	github.com/ncruces/go-strftime v1.0.0 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	modernc.org/libc v1.75.6 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.12.1 // indirect
)

replace github.com/nimiplatform/nimi/nimi-cognition => ../nimi-cognition
