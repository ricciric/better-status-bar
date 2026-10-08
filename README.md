# Better Status Bar

A one-line status bar for [Claude Code](https://claude.com/claude-code), written as a mod (a plugin of function hooks). It sits just above the prompt and shows what you usually want to glance at while you work:

```
 Opus 5.5 medium │ my-app ⎇ main │ web/src │ ctx ━━━─────── 30% 60k/200k │ session ━━━━────── 42% 2h10m │ week ━━━━━━━━── 81% 3d4h │ $1.23 │ 🐳 Containers
```

| Part | What it shows |
|---|---|
| `Opus 5.5 medium` | The model, the effort level, and `thinking` when extended thinking is always on |
| `my-app ⎇ main` | The git repository and the current branch (`@<sha>` when detached) |
| `web/src` | The folder you're in, relative to the repository root (`./` at the root) |
| `ctx` | How full the context window is, with the token count |
| `session` | Your 5-hour usage limit, and when it resets |
| `week` | Your 7-day usage limit, and when it resets |
| `$1.23` | What this session has cost so far |
| `🐳 Containers` | A button that lists your running Docker containers |

## Usage bars

Each bar is a thin 10-cell line that fills in half cells. Its colour slides smoothly from green (0%) through yellow (50%) to red (100%), so you can tell at a glance how close you are to a limit.

The session and week bars need a Claude subscription (Pro or Max). They show `--` until the first reply of the session reports your limits.

## It fits the window

The bar always stays on one line. On a narrower terminal it gives up details one at a time, in this order:

1. the cost
2. the token count
3. the bars shrink from 10 cells to 6
4. `session` and `week` become `S` and `W`
5. the reset countdowns
6. the effort level, and the bars shrink to 4 cells
7. the folder
8. the bars themselves (only the percentages stay)
9. the repository name

The model, the branch, the three percentages and the containers button always stay. Below about 60 columns the line is cut at the right edge with `…`.

## Docker containers

Click `🐳 Containers` to open a list of your running containers under the bar:

```
╭──────────────────────────────────────────────────────────╮
│ Containers (click one with a page to open it)  ↻  ✕      │
│ api        :5432            Up 2 hours                    │
│ web        localhost:3000   Up 2 hours                    │
╰──────────────────────────────────────────────────────────╯
```

When the list opens, each container's published TCP ports are checked. A container whose port answers with an HTML page (or a redirect) is a button: click it to open that page in your browser. Containers without a page (a database, a JSON API) are shown dimmed and can't be clicked. `↻` reloads the list and `✕` closes it. If Docker isn't installed or running, the list says so.

## Install

Mods need Claude Code's function hooks, which are an early-access feature. Turn them on once in `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"
  }
}
```

Then, at the prompt of a Claude Code terminal session:

```
/plugin install better-status-bar --marketplace ricciric/better-status-bar
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). The bar appears straight away.

If you had a `statusLine` command in your settings, you can remove it: this bar replaces it.

### From a clone

```bash
git clone https://github.com/ricciric/better-status-bar ~/.claude/mods/better-status-bar
```

and either start Claude Code with `claude --plugin-dir ~/.claude/mods/better-status-bar`, or load it in every session from `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1",
    "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/better-status-bar"
  }
}
```

## Requirements

- Claude Code with function hooks enabled (see above)
- `git` for the branch
- Docker, only for the containers menu
- macOS for opening container pages (it uses `open`); everything else works anywhere

## How it works

| File | What's in it |
|---|---|
| `hooks/register.tsx` | The hooks: reads usage after every turn (`session.measure`), the branch with `git`, containers with `docker ps`, and draws the bar (`ui.render` on `AbovePrompt`) |
| `hooks/layout.ts` | Builds the line and picks the richest version that fits the width (`LEVELS`) |
| `hooks/gauge.ts` | The bars, their colours, reset countdowns and paths |
| `hooks/docker.ts` | Parses `docker ps` output and published ports |
| `types/index.d.ts` | The shapes of the values the mod keeps in session state |
| `tests/` | Tests for all of the above |

To change what drops out first on narrow windows, reorder `LEVELS` in `hooks/layout.ts`. To change the colours, edit `GREEN`, `YELLOW` and `RED` in `hooks/gauge.ts`.

## Development

```bash
claude plugin validate .   # checks the manifest and what the hooks call
claude plugin test .       # runs tests/*.test.tsx
```

Edits reload by themselves in a running session when the mod is loaded with `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS`.

## License

MIT
