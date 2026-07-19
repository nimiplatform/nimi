#ifndef NIMI_PROTECTED_LOCAL_MACOS_PROFILE_H
#define NIMI_PROTECTED_LOCAL_MACOS_PROFILE_H

#ifdef NIMI_MACOS_LOCAL_DEVELOPMENT
#include "macos_profile_local_development.h"
#else
#define NIMI_MACOS_RUNTIME_ACCOUNT "_nimiruntime"
#define NIMI_MACOS_RUNTIME_SOCKET_DIRECTORY "/private/var/run/nimi"
#define NIMI_MACOS_RUNTIME_SOCKET "/private/var/run/nimi/runtime-desktop.sock"
#define NIMI_MACOS_LOCAL_APP_SOCKET "/private/var/run/nimi/runtime-local-app.sock"
#define NIMI_MACOS_RUNTIME_EXECUTABLE "/Applications/Nimi.app/Contents/Library/LaunchServices/nimi-runtime"
#define NIMI_MACOS_DESKTOP_APPLICATION "/Applications/Nimi.app"
#define NIMI_MACOS_LOCAL_APP_HOST "/Applications/Nimi.app/Contents/Frameworks/Nimi Local App Host.app/Contents/MacOS/Nimi Local App Host"
#define NIMI_MACOS_LAUNCHD_PLIST ""
#define NIMI_MACOS_SMAPP_PLIST "ai.nimi.runtime.plist"
#endif

#endif
