#!/bin/zsh
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

if [[ "$(/usr/bin/id -u)" == 0 ]]; then
  print -u2 -- 'Run this command as the signed-in Mac user. It requests administrator authorization only to remove the application.'
  exit 70
fi
print -- 'Uninstall Nimi: remove the application and background service; keep all Nimi data and credentials for reinstallation.'
read 'answer?Continue? [y/N] '
[[ "$answer" == [yY] ]] || exit 0

application='/Applications/Nimi.app'
if /usr/bin/pgrep -f '^/Applications/Nimi.app/Contents/MacOS/Nimi( |$)' >/dev/null; then
  print -u2 -- 'Quit Nimi, then run this command again.'
  exit 71
fi
"${application}/Contents/MacOS/Nimi" --unregister-runtime-service

# The app operation above unregisters through SMAppService in its own bundle.
# Elevated work is limited to removal of this fixed install, not credential
# access, user data removal, or service-identity replacement.
/usr/bin/sudo /bin/zsh -e -u <<'REMOVE'
if /bin/launchctl print system/ai.nimi.runtime >/dev/null 2>&1; then
  print -u2 -- 'Nimi Runtime is still registered. The application has been retained.'
  exit 71
fi
/bin/rm -rf /Applications/Nimi.app
for socket_path in /private/var/run/nimi/runtime-desktop.sock /private/var/run/nimi/runtime-local-app.sock; do
  if [[ -S "$socket_path" ]]; then /bin/rm "$socket_path"; fi
done
if [[ -d /private/var/run/nimi ]]; then /bin/rmdir /private/var/run/nimi; fi
/usr/sbin/pkgutil --forget ai.nimi.installer
REMOVE
print -- 'Nimi was removed. Reinstall Nimi to reuse the retained data and credentials.'
