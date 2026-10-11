!macro customInit
  ; Beende laufende Mingle-Prozesse automatisch vor der Installation
  nsExec::Exec 'taskkill /F /IM "Mingle.exe"'
!macroend

!macro customUnInit
  ; Beende laufende Mingle-Prozesse automatisch vor der Deinstallation
  nsExec::Exec 'taskkill /F /IM "Mingle.exe"'
!macroend
