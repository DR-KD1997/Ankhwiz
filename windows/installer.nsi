; Ankhwiz installer for Windows, built with NSIS (makensis), also on Linux.
; Installs for the current user only, so it needs no administrator rights:
; the program goes to %LOCALAPPDATA%\Programs\Ankhwiz, with a Start menu
; entry, an optional desktop shortcut and an uninstaller. Decks and progress
; live in Ankhwiz's own data folder and are kept when Ankhwiz is uninstalled.
;
;   makensis -DVERSION=0.7.0 -DSRC=<folder with Ankhwiz.exe and WebView2Loader.dll> -DOUT=<installer.exe> installer.nsi

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define APP "Ankhwiz"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ankhwiz"

Name "${APP} ${VERSION}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "Software\${APP}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Ankhwiz.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open Ankhwiz"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; Windows wants four numbers here: 0.4.1 becomes 0.4.1.0; 0.4.1.1 stays.
!ifndef FILEVERSION
  !define FILEVERSION "${VERSION}.0"
!endif
VIProductVersion "${FILEVERSION}"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "${APP} installer"
VIAddVersionKey "FileVersion" "${FILEVERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "AGPL-3.0-or-later"

Section "Ankhwiz" SecMain
  SectionIn RO
  ; Close a running copy so its files can be replaced.
  nsExec::Exec 'taskkill /IM Ankhwiz.exe /F'
  SetOutPath "$INSTDIR"
  File "${SRC}\Ankhwiz.exe"
  File /nonfatal "${SRC}\WebView2Loader.dll"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\Ankhwiz.exe"
  WriteRegStr HKCU "Software\${APP}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "DR-KD1997"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\Ankhwiz.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1

  ; Ankhwiz shows its interface with Microsoft Edge WebView2 (part of Windows 11 and current Windows 10).
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ReadRegStr $1 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
  ${AndIf} $1 == ""
    MessageBox MB_ICONINFORMATION|MB_OK "Ankhwiz needs Microsoft Edge WebView2, which this computer may not have. If Ankhwiz does not open, install the WebView2 Runtime from Microsoft (search for 'WebView2 Runtime download')."
  ${EndIf}
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\Ankhwiz.exe"
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM Ankhwiz.exe /F'
  Delete "$INSTDIR\Ankhwiz.exe"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${APP}\${APP}.lnk"
  RMDir "$SMPROGRAMS\${APP}"
  Delete "$DESKTOP\${APP}.lnk"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\${APP}"
SectionEnd
