module github.com/nimiplatform/nimi/runtime

go 1.25.0

require (
	github.com/fsnotify/fsnotify v1.9.0
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/nimiplatform/nimi/nimi-cognition v0.0.0
	github.com/oklog/ulid/v2 v2.1.1
	github.com/zalando/go-keyring v0.2.8
	golang.org/x/net v0.53.0
	golang.org/x/sys v0.43.0
	golang.org/x/term v0.42.0
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260226221140-a57be14db171
	google.golang.org/grpc v1.80.0
	google.golang.org/protobuf v1.36.11
	gopkg.in/yaml.v3 v3.0.1
	modernc.org/sqlite v1.50.0
)

require (
	github.com/danieljoos/wincred v1.2.3 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/godbus/dbus/v5 v5.2.2 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/ncruces/go-strftime v1.0.0 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	golang.org/x/text v0.36.0 // indirect
	modernc.org/libc v1.72.0 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.11.0 // indirect
)

replace github.com/nimiplatform/nimi/nimi-cognition => ../nimi-cognition
