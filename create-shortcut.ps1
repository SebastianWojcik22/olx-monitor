$WshShell = New-Object -comObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath('Desktop')
$lnk = $WshShell.CreateShortcut("$desktop\OLX Monitor.lnk")
$lnk.TargetPath = "c:\Users\sebas\Documents\olx-monitor\start.bat"
$lnk.WorkingDirectory = "c:\Users\sebas\Documents\olx-monitor"
$lnk.WindowStyle = 7
$lnk.IconLocation = "c:\Windows\System32\shell32.dll, 14"
$lnk.Description = "Uruchom OLX Monitor"
$lnk.Save()
Write-Host "Skrot utworzony: $desktop\OLX Monitor.lnk"
