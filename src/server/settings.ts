import path from 'node:path';
import os from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/** Office settings that every view shares, kept on disk. */
export interface OfficeSettings {
  /** The desktop pet reads its lines out loud. */
  petVoice: boolean;
}

const DEFAULTS: OfficeSettings = { petVoice: true };

export const settingsFile = (homedir = os.homedir()) => path.join(homedir, '.agent-office', 'settings.json');

/** Only known keys with the right types survive. */
export function cleanSettings(value: unknown): Partial<OfficeSettings> {
  const v = (value ?? {}) as Record<string, unknown>;
  return typeof v.petVoice === 'boolean' ? { petVoice: v.petVoice } : {};
}

export function createSettingsStore(file = settingsFile()) {
  let settings: OfficeSettings = { ...DEFAULTS, ...(() => { try { return cleanSettings(JSON.parse(readFileSync(file, 'utf8'))); } catch { return {}; } })() };
  return {
    get: () => ({ ...settings }),
    update(patch: Partial<OfficeSettings>) {
      settings = { ...settings, ...cleanSettings(patch) };
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(settings, null, 2));
      return { ...settings };
    },
  };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
