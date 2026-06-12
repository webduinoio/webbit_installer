; Web:Bit Windows 安裝程式自訂 NSIS 腳本（electron-builder include）
;
; 沿用原版 WBitBlockly.nsi 的行為：安裝完成後靜默安裝 CH340 USB 驅動程式
; （Web:Bit v1 開發板使用 CH340 USB-to-Serial 晶片）

!macro customInstall
  ; 安裝 CH340 USB 驅動程式（v1 開發板需要；v2 板使用原生 USB CDC 不需驅動）
  ; /S = 靜默安裝；若失敗不影響主程式安裝（使用者可之後從 App 選單手動安裝）
  ;
  ; WCH 原廠 SETUP.EXE 以 GetCurrentDirectory() 取得工作目錄來尋找 *.inf 與
  ; DRVSETUP64\DRVSETUP64.EXE，而非以自身 exe 路徑。因此執行前必須先用
  ; SetOutPath 把工作目錄切到驅動資料夾，否則會跳出
  ; 「Not found install application,please install by hand!」錯誤視窗。
  DetailPrint "Installing CH340 USB driver..."
  SetOutPath "$INSTDIR\resources\drivers\usb_driver"
  nsExec::ExecToLog '"$INSTDIR\resources\drivers\usb_driver\SETUP.EXE" /S'
  Pop $0
  DetailPrint "CH340 driver installer exit code: $0"
  SetOutPath "$INSTDIR"
!macroend

!macro customUnInstall
  ; 解除安裝時不移除 USB 驅動（其他程式可能仍在使用）
!macroend
