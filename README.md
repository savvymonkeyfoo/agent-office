# Agent Office

See every Claude Code session on your machine as a cartoon character at a desk in a 3D office, live.

- **Working** agents type away, with a blue monitor.
- **Needs you** agents wave with an amber `!`: they asked a question and are waiting for you.
- **Done** agents lean back with a coffee (`…`): their turn is over and the session is still open.
- **Finished** agents stand next to their chair with a blue ✓: they completed and exited.
- **Stale** agents slump over the keyboard (`zz`): the session ended before finishing.

Click an agent to see its project, branch and last message, and the `claude attach` command to pick it up.
Finished and stale agents have a **Got it** button that sends them out the door for good.

## Run it

```sh
npx github:claudekwanhyonglee/agent-office
```

Then open the URL it prints: http://127.0.0.1:4321. To use another port, set `PORT`, e.g. `PORT=5000`.

The first run downloads and builds the app, so it takes a minute.

### On your phone or another computer

To open the office from other devices on your home network, start it with `--lan`:

```sh
npx github:claudekwanhyonglee/agent-office --lan
```

Or set `LAN=1`, e.g. `LAN=1 npx github:claudekwanhyonglee/agent-office`. It then also prints an
`On your network: http://<ip>:4321` line for each of this machine's network addresses; open one of those.

There is no login: anyone on your network can see the office and press **Got it**. Only use it on a network you trust.

## Cloud sessions on your computer

If you run Claude Code in the cloud (claude.ai/code, the Claude app, Projects), start the office in cloud mode:

```sh
npx github:savvymonkeyfoo/agent-office#cloud-artifact --cloud
```

Or set `CLOUD=1`. It lists your cloud sessions (including Projects threads) every 10 seconds using the Claude login `claude` saved on this computer
(the macOS keychain, or `.credentials.json` in your Claude config folder). The login is only sent to Anthropic's API.
If the login expires, run `claude` once to refresh it, or set `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`.
Click an agent to open its session on claude.ai.

In cloud mode, clicking an agent shows its progress checklist plus links to its session, pull request and artifacts. You get a desktop notification (macOS, Windows or Linux with `notify-send`) when a session starts needing you (set `NOTIFY=0` to turn that off), and the plan usage panel shows the limit status your cloud sessions report.

This uses the same unpublished endpoint `claude --teleport` uses, so a Claude Code update could break it.

## Desktop pet

A little office character that floats on your desktop, so you can see what the office is up to without opening it.
It types away while agents are working, waves with an amber bubble when a session has a question for you, sips a coffee when all's quiet, and dozes if the office stops.
When a session finishes, it says so for a few seconds. Hover over it to see what's going on.

```sh
node scripts/pet.mjs run        # put it on your desktop
node scripts/pet.mjs install    # same, and start it at login
node scripts/pet.mjs uninstall
```

Drag it anywhere; it remembers where you left it and stays above other windows on every desktop.
Click it to open the session that's waiting on you (or the office). Right-click to switch between the office worker and the office dog, change its size, or quit.
Clicks anywhere else in its window go through to whatever's behind.

The office must be running (it draws the office's `/pet.html` page).
On a Mac it's a small native app (`mac/`, built by `scripts/pet.sh`), which needs `swiftc` from Xcode's command line tools (`xcode-select --install`).
On Windows and Linux it runs `desktop-pet/` in Electron, which the script downloads once into `~/.agent-office/pet` (about 100 MB), so the office itself stays small.
Set `AGENT_OFFICE_URL` if the office isn't on `http://127.0.0.1:4321`.

## Cloud sessions (claude.ai artifact)

This fork can also run as a private claude.ai artifact that shows your Claude Code **cloud** sessions
(claude.ai/code, Claude app and Projects) instead of the sessions on one computer.
It reads them with your own login through the built-in Claude Code Remote connector and refreshes every 30 seconds.

```sh
npm run build:artifact   # writes dist/agent-office.html
```

Publish `dist/agent-office.html` as an artifact that declares the `mcp` capability for `Claude Code Remote` → `list_sessions`.
Click an agent to open its session on claude.ai. Got it is remembered in your browser only, and the usage panel is left out.

## Requirements

- Node.js 20 or newer
- Claude Code, a version that supports `claude agents --json` (run `claude update` if it doesn't)
- A browser with WebGL

Works on macOS, Linux and Windows.

## Privacy

Agent Office only reads local Claude Code data, and never sends anything anywhere.

- It runs `claude agents --json --all` and reads session transcripts in your Claude config folder
  (`$CLAUDE_CONFIG_DIR`, or `.claude` in your home folder).
- It writes the list of agents you dismissed with Got it, in `.agent-office/acknowledged.json`
  in your home folder.
- Only if you press **Enable limit tracking** in the usage panel, it also:
  - copies a small script to `.agent-office/statusline.js` in your home folder (and updates it when Agent Office starts),
  - adds a `statusLine` entry running that script to Claude Code's `settings.json` in your Claude config folder,
    keeping your other settings. It never replaces a status line you already have.

  Claude Code then runs the script on each status line refresh; it saves your plan's 5-hour and weekly limits
  to `agent-office-limits.json` in your Claude config folder. It prints nothing and adds nothing to Claude's context.
  To turn it off, remove the `statusLine` entry. Enabling only works from this computer, even with `--lan`.
- By default the server listens on 127.0.0.1 only, so other machines can't reach it.
  With `--lan` (or `LAN=1`) it listens on your network too, and anyone on that network can see the office
  and press Got it; it still refuses requests addressed to any other host name.
- The page loads nothing from the internet.
- It shows sessions; it never controls them.

## Develop

```sh
npm install
npm test          # Vitest
npm run typecheck
npm start         # builds if needed, then serves
npm run dev       # Vite dev server for the page (run npm start alongside for the API)
```

### Keep it running in the background

`node scripts/background.mjs install` runs cloud mode in the background on macOS, Windows or Linux: it starts when you log in and restarts if it stops, so no terminal window is needed. After `git pull && npm run build`, run it again to restart. `node scripts/background.mjs uninstall` removes it.

| | How | Log |
|---|---|---|
| macOS | launchd (`scripts/launch-agent.sh`, which you can also run directly) | `~/Library/Logs/agent-office.log` |
| Windows | a hidden script in your Startup folder (no admin rights needed) | `%USERPROFILE%\.agent-office\agent-office.log` |
| Linux | a systemd user service | `journalctl --user -u agent-office` |
