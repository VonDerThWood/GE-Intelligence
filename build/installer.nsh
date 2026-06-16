!macro preInit
  nsExec::Exec 'taskkill /F /IM GEnius.exe /T'
  Pop $0
!macroend

!macro customInstall
  nsExec::Exec 'taskkill /F /IM GEnius.exe /T'
  Pop $0
!macroend
