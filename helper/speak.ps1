param(
  [string]$Voice = "Microsoft Huihui Desktop",
  [int]$Rate = 0,
  [int]$Volume = 100
)

# 从 stdin 一行一句地读，读完一句说一句；stdin 关闭就退出。
# 优先用 WinRT 的语音（能用瑶瑶/康康），找不到再退回 SAPI。
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$synth = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media, ContentType = WindowsRuntime] | Out-Null
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
  function Await($operation, $resultType) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.Wait()
    return $task.Result
  }
  $winrtVoices = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices
  $target = $winrtVoices | Where-Object { $_.DisplayName -eq $Voice } | Select-Object -First 1
  if ($null -eq $target) { $target = $winrtVoices | Where-Object { $_.DisplayName -like "*$Voice*" } | Select-Object -First 1 }
  if ($null -eq $target -and $Voice -like "* Desktop") {
    $trim = $Voice -replace " Desktop$", ""
    $target = $winrtVoices | Where-Object { $_.DisplayName -like "*$trim*" } | Select-Object -First 1
  }
  if ($null -ne $target) {
    $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
    $synth.Voice = $target
    $synth.Options.SpeakingRate = [Math]::Max(0.5, [Math]::Min(6.0, 1.0 + $Rate * 0.08))
    try { $synth.Options.AudioVolume = [Math]::Max(0, [Math]::Min(1, $Volume / 100.0)) } catch { }
  }
} catch { $synth = $null }

if ($null -eq $synth) {
  Add-Type -AssemblyName System.Speech
  $sapi = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try { $sapi.SelectVoice($Voice) } catch { }
  $sapi.Rate = [Math]::Max(-10, [Math]::Min(10, $Rate))
  $sapi.Volume = [Math]::Max(0, [Math]::Min(100, $Volume))
}

$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
while ($true) {
  $line = $reader.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line -eq "") { continue }
  if ($null -ne $synth) {
    try {
      $stream = Await ($synth.SynthesizeTextToStreamAsync($line)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
      $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
      $wav = [System.IO.Path]::GetTempFileName()
      $file = [System.IO.File]::Create($wav)
      $net.CopyTo($file)
      $file.Close()
      $stream.Dispose()
      $player = New-Object System.Media.SoundPlayer($wav)
      $player.PlaySync()
      Remove-Item $wav -Force -ErrorAction SilentlyContinue
    } catch { }
  } else {
    try { $sapi.Speak($line) } catch { }
  }
}
