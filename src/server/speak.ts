import { execFile } from 'node:child_process';

// Windows speaks through PowerShell. The text arrives in an environment variable, so it is never parsed as script.
const WINDOWS_SAY = "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak($env:OFFICE_SAY)";

/** Says a line out loud with the computer's own voice: `say` on macOS, System.Speech on Windows, spd-say on Linux. Fails quietly. */
export function speak(text: string, platform = process.platform) {
  const line = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 300).replace(/^[\s-]+/, ''); // a leading dash would read as an option
  if (!line.trim()) return;
  const ignore = () => {};
  if (platform === 'darwin') execFile('say', [line], ignore);
  else if (platform === 'win32') execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SAY], { env: { ...process.env, OFFICE_SAY: line }, windowsHide: true }, ignore);
  else execFile('spd-say', [line], ignore);
}
