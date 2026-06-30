!macro preInit
  ; Kill any running GEnius instance first, then delete the install dir
  ; entirely. This is more reliable than waiting for Windows to release
  ; file handles: if the dir is already gone when uninstallOldVersion runs
  ; the old-uninstaller.exe, the uninstaller finds nothing to delete and
  ; returns 0 immediately — no retry loop, no "cannot be closed" dialog.
  ; The new installer then writes fresh files over the (now empty) location.
  nsExec::Exec 'taskkill /F /IM GEnius.exe /T'
  Pop $0
  Sleep 2000
  RMDir /r "$LOCALAPPDATA\Programs\GEnius"
!macroend

!macro customInstall
  nsExec::Exec 'taskkill /F /IM GEnius.exe /T'
  Pop $0
!macroend

; Overrides electron-builder's built-in "is app running" check
; (CHECK_APP_RUNNING in allowOnlyOneInstallerInstance.nsh). The stock
; _CHECK_APP_RUNNING macro pipes `tasklist | find` through nsExec::Exec and
; has been unreliable for us — the "GEnius cannot be closed... Retry" loop
; fired repeatedly with zero GEnius processes actually running (confirmed
; directly via tasklist + a file-lock test both times). Matches a known
; electron-builder regression (24.13.2+, PR #8059 / issue #8131), which
; upstream itself describes as "not consistently reproducible" — so pinning
; the electron-builder version alone wasn't enough.
; preInit above already kills GEnius and deletes the install dir, so by
; the time this macro runs, uninstallOldVersion will find nothing to lock
; on. This macro just needs to exist to suppress the stock _CHECK_APP_RUNNING
; behavior — no sleep needed since preInit already did the heavy lifting.
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /IM GEnius.exe /T'
  Pop $0
!macroend
