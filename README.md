# Sleuth

Agent skill for web research with judgment — knows when to search, when to read, and when to verify against original sources.

## What it does

Most agents treat web tools as interchangeable. They don't distinguish between a search snippet, a reader dump, and a live browser session. Sleuth gives agents a decision framework:

| Situation | Action |
|-----------|--------|
| Need to find where to look | WebSearch to discover candidates |
| Need to read content at a known URL | WebFetch / reader first; escalate to browser if insufficient |
| Need to confirm authenticity | Reader results are clues, not evidence — verify against original sources |
| Need interaction / login / dynamic content | Browser only |

Agents escalate from lightest tool to heaviest, not the other way around.

## Architecture

```
sleuth (skill)
  SKILL.md              Flow control: response levels, tool selection, subagent contracts, delivery
  references/
    search-guide.md     Search strategy (loaded on demand)
    tool-guide.md       Browser commands (loaded on demand)
    subagent-guide.md   Subagent contract (loaded on demand)
  scripts/              Session logging, delivery management, history search, etc.
       │
       │ Bash
       v
  agent-browser (CDP CLI)
       │ CDP WebSocket (127.0.0.1:9222)
       v
  User's Chrome (login state, bookmarks, history)
```

### Runtime data

| Path | Purpose |
|------|---------|
| `~/.sleuth/output/YYYY-MM-DD/<session-id>/` | Session deliverables |
| `~/.sleuth/sessions/*.json` | Session logs |
| `~/.sleuth/knowledge/entities.json` | Entity/fact index extracted from deliverables |
| `~/.sleuth/chrome-debug/` | Chrome CDP debug profile (copy of user profile) |

## Directory structure

```
├── SKILL.md                    Main skill: flow control, subagent contracts, delivery
├── references/
│   ├── tool-guide.md           Browser command reference + special scenarios
│   ├── search-guide.md         Search strategy and tactics
│   └── subagent-guide.md       Subagent execution contract
├── scripts/
│   ├── lib/
│   │   ├── output.mjs
│   │   ├── registry.mjs
│   │   └── validate.mjs
│   ├── check-deps.mjs          Environment check + Chrome CDP setup
│   ├── session-logger.mjs      Session logging
│   ├── deliver.mjs             Deliverable management
│   ├── research-index.mjs      History and entity index
│   ├── cleanup-output.mjs      Expired output cleanup
│   ├── find-url.mjs            Chrome bookmark & history search
│   ├── extract-subtitles.sh    YouTube subtitle download
│   └── srt_to_transcript.py    Subtitle cleanup
├── LICENSE
└── README.md
```

## Installation

### Prerequisites

| Dependency | Purpose | Install |
|------------|---------|---------|
| **Node.js >= 18** | Run all scripts | Required |
| **agent-browser** | CDP browser CLI | `npm i -g agent-browser && agent-browser install` |
| **Chrome** | User browser with login state | Required (`check-deps` auto-detects) |
| **sqlite3** | Chrome history search (optional) | macOS/Linux pre-installed |
| **yt-dlp** | YouTube subtitles (optional) | `pip install yt-dlp` |

### Install

```bash
npx @anthropic-ai/sleuth install          # project-level
npx @anthropic-ai/sleuth install --global # global
```

## Chrome CDP connection

Chrome 147+ requires a non-default `--user-data-dir` for remote debugging. `check-deps.mjs` handles this automatically:

1. Detect if CDP port is available
2. If not: close user Chrome → copy profile to `~/.sleuth/chrome-debug/` → restart with `--remote-debugging-port=9222`
3. On macOS, cookie encryption keys are stored in Keychain (path-independent), so login state is preserved after copy

Manual start:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=$HOME/.sleuth/chrome-debug \
  --no-first-run &
```

## Safety

- No extraction of cookies, passwords, or sensitive credentials
- No screenshots of sensitive pages
- No paywall bypass
- No state-changing operations unless explicitly requested
- All browser actions run in local Chrome, visible to the user

## Platform support

| Platform | Status |
|----------|--------|
| macOS | Fully supported |
| Linux | Fully supported |
| Windows | Fully supported |

## License

MIT
