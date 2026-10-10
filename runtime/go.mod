module github.com/nimiplatform/nimi/runtime

go 1.26.9

require (
	github.com/Microsoft/go-winio v0.6.3
	github.com/dlclark/regexp2 v1.12.0
	github.com/fsnotify/fsnotify v1.10.1
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/gorilla/websocket v1.5.3
	github.com/hajimehoshi/go-mp3 v0.3.4
	github.com/larksuite/oapi-sdk-go/v3 v3.12.0
	github.com/modelcontextprotocol/go-sdk v1.8.0
	github.com/nimiplatform/nimi/nimi-cognition v0.0.0
	github.com/oklog/ulid/v2 v2.1.2
	github.com/santhosh-tekuri/jsonschema/v6 v6.0.3
	golang.org/x/image v0.46.0
	golang.org/x/mod v0.41.0
	golang.org/x/net v0.60.0
	golang.org/x/sys v0.48.0
	golang.org/x/text v0.42.0
	google.golang.org/genproto/googleapis/rpc v0.0.0-20261005182115-fad411399dd8
	google.golang.org/grpc v1.84.0
	google.golang.org/protobuf v1.36.12
	gopkg.in/yaml.v3 v3.0.1
	modernc.org/sqlite v1.60.1
)

require (
	github.com/dustin/go-humanize v1.1.0 // indirect
	github.com/gogo/protobuf v1.3.2 // indirect
	github.com/google/jsonschema-go v0.4.3 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/mattn/go-isatty v0.0.24 // indirect
	github.com/ncruces/go-strftime v1.1.0 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	github.com/segmentio/asm v1.2.1 // indirect
	github.com/segmentio/encoding v0.5.4 // indirect
	github.com/yosida95/uritemplate/v3 v3.0.2 // indirect
	golang.org/x/oauth2 v0.37.0 // indirect
	golang.org/x/sync v0.24.0 // indirect
	golang.org/x/time v0.16.0 // indirect
	modernc.org/libc v1.77.1 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.12.1 // indirect
)

replace github.com/nimiplatform/nimi/nimi-cognition => ../nimi-cognition
