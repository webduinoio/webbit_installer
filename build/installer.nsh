; Web:Bit Windows 安裝程式自訂 NSIS 腳本（electron-builder include）
;
; 沿用原版 WBitBlockly.nsi 的行為：安裝完成後靜默安裝 CH340 USB 驅動程式
; （Web:Bit v1 開發板使用 CH340 USB-to-Serial 晶片）

!macro customInstall
  ; 安裝 CH340 USB 驅動程式（v1 開發板需要；v2 板使用原生 USB CDC 不需驅動）
  ; /S = 靜默安裝；若失敗不影響主程式安裝（使用者可之後從 App 選單手動安裝）
  DetailPrint "Installing CH340 USB driver..."
  nsExec::ExecToLog '"$INSTDIR\resources\drivers\usb_driver\SETUP.EXE" /S'
  Pop $0
  DetailPrint "CH340 driver installer exit code: $0"
!macroend

!macro customUnInstall
  ; 解除安裝時不移除 USB 驅動（其他程式可能仍在使用）
!macroend
