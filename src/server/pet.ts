import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface PetLauncher {
  /** Whether the pet has been set up on this computer (so the office can offer to bring it back). */
  available(): boolean;
  /** Puts the pet back on the desktop; false if it isn't set up here. */
  show(): boolean;
}

interface Options {
  /** The office's own folder (where scripts/ and mac/ are). */
  root: string;
  platform?: NodeJS.Platform;
  home?: string;
  exists?: (path: string) => boolean;
  run?: (command: string, args: string[]) => void;
}

const detached = (command: string, args: string[]) =>
  spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();

/**
 * Starts the desktop pet after it's been quit. On a Mac that opens the installed app (or the one
 * scripts/pet.sh built); elsewhere it runs `scripts/pet.mjs run`, once Electron has been fetched.
 */
export function createPetLauncher({ root, platform = process.platform, home = homedir(), exists = existsSync, run = detached }: Options): PetLauncher {
  const macApps = [join(home, 'Applications', 'Agent Pet.app'), join(root, 'mac', 'build', 'Agent Pet.app')];
  const electron = join(home, '.agent-office', 'pet', 'node_modules', 'electron', 'path.txt');
  const macApp = () => macApps.find(exists);
  const available = () => (platform === 'darwin' ? !!macApp() : exists(electron));
  return {
    available,
    show() {
      if (!available()) return false;
      // Opening a pet that's already running just leaves it be; on other systems pet.mjs restarts it.
      if (platform === 'darwin') run('open', [macApp()!]);
      else run(process.execPath, [join(root, 'scripts', 'pet.mjs'), 'run']);
      return true;
    },
  };
}
