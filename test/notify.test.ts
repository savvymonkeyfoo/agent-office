import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFile = vi.fn();
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => execFile(...args) }));
const { desktopNotify } = await import('../src/server/notify.ts');

describe('desktopNotify', () => {
  beforeEach(() => execFile.mockReset());

  it('uses osascript on macOS', () => {
    desktopNotify('Fix login needs you', 'approve the plan', 'darwin');
    expect(execFile.mock.calls[0][0]).toBe('osascript');
    expect(execFile.mock.calls[0][1][1]).toContain('"approve the plan" with title "Fix login needs you"');
  });

  it('shows a Windows toast with the text passed outside the script', () => {
    desktopNotify("Bob's task needs you", 'say "yes"; Remove-Item *', 'win32');
    const [command, args, options] = execFile.mock.calls[0];
    expect(command).toBe('powershell.exe');
    expect(args.join(' ')).not.toContain('Remove-Item');
    expect(options.env).toMatchObject({ OFFICE_TITLE: "Bob's task needs you", OFFICE_BODY: 'say "yes"; Remove-Item *' });
    expect(options.windowsHide).toBe(true);
  });

  it('uses notify-send on Linux', () => {
    desktopNotify('A\nB', 'body', 'linux');
    expect(execFile.mock.calls[0].slice(0, 2)).toEqual(['notify-send', ['--app-name=Agent Office', 'A B', 'body']]);
  });
});
