!include "LogicLib.nsh"

; Authority: rule.nimi.platform.product-lifecycle.p-pkgrel-001
; Authority: rule.nimi.platform.product-lifecycle.p-pkgrel-002
; Authority: rule.nimi.platform.product-lifecycle.p-supd-007b
;
; This include is used only by the Windows local-development product candidate.
; The Electron layout never contains the Runtime binary. The outer Nimi installer
; invokes the independently signed Runtime service installer from $PLUGINSDIR.

!macro StageNimiRuntimeServiceInstaller
  SetOutPath "$PLUGINSDIR"
  File /oname=nimi.exe "${BUILD_RESOURCES_DIR}\runtime-service\nimi.exe"
  File /oname=install-nimi-runtime.ps1 "${BUILD_RESOURCES_DIR}\runtime-service\install-nimi-runtime.ps1"
  File /r "${BUILD_RESOURCES_DIR}\runtime-service\resources"
!macroend

!macro RunNimiRuntimeServiceInstaller MODE
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-nimi-runtime.ps1" -Mode ${MODE} -BinaryPath "$PLUGINSDIR\nimi.exe" -DeploymentProfile local-development -Json'
  Pop $R0
  Pop $R1
  DetailPrint "NimiRuntime ${MODE} exit code: $R0"
  ${If} $R0 != "0"
    MessageBox MB_ICONSTOP|MB_OK "Nimi Runtime ${MODE} failed.$\r$\n$\r$\n$R1"
    Abort
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro StageNimiRuntimeServiceInstaller
  !insertmacro RunNimiRuntimeServiceInstaller "Install"
!macroend

!macro customUnInstall
  ; electron-builder invokes the previous uninstaller during an app update. The
  ; Runtime service is updated in place by the new signed installer and must not
  ; be removed by that internal update transition.
  ${IfNot} ${isUpdated}
    SetOutPath "$PLUGINSDIR"
    File /oname=install-nimi-runtime.ps1 "${BUILD_RESOURCES_DIR}\runtime-service\install-nimi-runtime.ps1"
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-nimi-runtime.ps1" -Mode Uninstall -DeploymentProfile local-development -Json'
    Pop $R0
    Pop $R1
    DetailPrint "NimiRuntime Uninstall exit code: $R0"
    ${If} $R0 != "0"
      MessageBox MB_ICONSTOP|MB_OK "Nimi Runtime uninstall failed. Nimi was preserved.$\r$\n$\r$\n$R1"
      Abort
    ${EndIf}
  ${EndIf}
!macroend
