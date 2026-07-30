!macro preInit
  ; Kill any running GEnius instance first, then delete the install dir
  ; entirely. This is more reliable than waiting for Windows to release
  ; file handles: if the dir is already gone when uninstallOldVersion runs
  ; the old-uninstaller.exe, the uninstaller finds nothing to delete and
  ; returns 0 immediately — no retry loop, no "cannot be closed" dialog.
  ; The new installer then writes fresh files over the (now empty) location.
  ;
  ; Side effect found for real (Ben, 2026-07-29): since the old version's
  ; real uninstaller.exe never runs anymore, it never gets the chance to
  ; remove ITS OWN shortcuts or registry uninstall-key entry either. Two
  ; symptoms from that: (1) the old desktop/Start Menu shortcut is
  ; orphaned forever — nothing ever deletes it, so it just sits there
  ; every time, and (2) electron-builder's own shortcut-creation step
  ; still sees that leftover registry entry, reads it as "this is an
  ; upgrade, not a fresh install," and — per its default NSIS behavior —
  ; skips recreating the desktop shortcut on upgrades (it assumes the old
  ; one is still valid). Since this macro is what broke that assumption,
  ; it now cleans up the shortcuts itself instead of leaving it to a flow
  ; it just bypassed.
  nsExec::Exec 'taskkill /F /IM GEnius.exe /T'
  Pop $0

  ; A flat Sleep here was a guess, not a guarantee — confirmed for real
  ; (Ben, 2026-07-29): a previous install hit RMDir before Windows had
  ; actually released GEnius.exe's file handle (taskkill returning doesn't
  ; mean the handle is gone yet), so RMDir couldn't delete the still-open
  ; files and Windows silently queued them for delete-on-next-reboot
  ; instead of failing loudly. Nothing looked wrong until an UNRELATED
  ; reboot weeks later finally ran that backlog and wiped GEnius.exe, its
  ; DLLs, locales, and .pak files out from under a working install — the
  ; data-only files (app.asar.unpacked) were untouched because nothing
  ; had them open. Polling for the exe to actually be deletable — instead
  ; of just hoping 2 seconds was enough — turns that silent time-bomb into
  ; either a real delete now or (worst case) the same deferred-delete
  ; fallback, but only after genuinely trying, not after a guessed delay.
  StrCpy $1 0
  poll_unlocked:
    IntOp $1 $1 + 1
    ClearErrors
    Rename "$LOCALAPPDATA\Programs\GEnius\GEnius.exe" "$LOCALAPPDATA\Programs\GEnius\GEnius.exe"
    IfErrors 0 unlocked
    IntCmp $1 25 unlocked unlocked ; ~5s max wait (25 x 200ms), then give up and proceed anyway
    Sleep 200
    Goto poll_unlocked
  unlocked:

  RMDir /r "$LOCALAPPDATA\Programs\GEnius"
  Delete "$DESKTOP\GEnius.lnk"
  Delete "$SMPROGRAMS\GEnius.lnk"
!macroend

!macro customInstall
  ; The Sleep here (missing before — preInit above has one, this didn't)
  ; matters specifically when "Launch GEnius after install" is checked:
  ; that launch fires shortly after this macro finishes, and Windows
  ; doesn't always release a just-killed process's single-instance-lock
  ; resource instantly. Without a gap, the freshly-launched instance can
  ; spuriously see the lock as still held, assume another copy is running,
  ; and silently quit before ever creating a window — installer finishes,
  ; checkbox was checked, nothing visibly opens. Confirmed plausible for
  ; real (Ben, 2026-07-14): intermittent "sometimes opens, sometimes
  ; doesn't, even with Launch checked" is the exact signature of this race.
  nsExec::Exec 'taskkill /F /IM GEnius.exe /T'
  Pop $0
  Sleep 2000

  ; Create the shortcuts ourselves rather than trust electron-builder's
  ; own fresh-install-vs-upgrade detection — preInit above bypasses the
  ; normal uninstall flow that detection depends on, so it can no longer
  ; be trusted to fire correctly (see the note in preInit). This runs on
  ; every install, so a stale/missing shortcut can't recur going forward.
  CreateShortcut "$DESKTOP\GEnius.lnk" "$INSTDIR\GEnius.exe"
  CreateShortcut "$SMPROGRAMS\GEnius.lnk" "$INSTDIR\GEnius.exe"
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
