# AiGuard — Claude Code Rules

## RTK — required for all shell commands

All shell commands MUST be prefixed with `rtk`. No exceptions.

```bash
# CORRECT
rtk git status
rtk git log --oneline -10
rtk git add src/file.ts
rtk git commit -m "feat: ..."
rtk npm install
rtk npm run build
rtk npm run lint
rtk npx tsc --noEmit

# WRONG — never run raw commands
git status
npm install
npx tsc
```

RTK meta-commands (run rtk directly, no prefix needed):
```bash
rtk gain              # token savings analytics
rtk gain --history    # command history with savings
rtk discover          # find missed rtk opportunities
```

## Monorepo structure

```
AiGuard/
├── extension/          ← VS Code extension (TypeScript)
│   ├── src/
│   └── package.json
├── backend/            ← API server (Node.js + Fastify + TypeScript)
│   ├── src/
│   └── package.json
├── shared/             ← shared types (CodeIssue, FixCandidate, etc.)
│   ├── src/
│   └── package.json
├── CLAUDE.md
├── AGENTS.md
└── package.json        ← npm workspaces root
```

Always import types from `shared/`:
```typescript
import { CodeIssue, FixCandidate } from "@aiguard/shared";
```

## Business model (relevant for architectural decisions)

- AiGuard is a **paid SaaS**. Users pay for access — they do not provide their own OpenAI key
- Users authenticate with a **license key**, not an OpenAI API key
- All AI calls flow: `extension → AiGuard backend → GPT-5.4`
- Model **GPT-5.4** is locked — not configurable by the user
- Backend injects **Context7** documentation into prompts before calling GPT
- Prompts live **on the backend only** — never inside the extension

## Architecture rules

- Extension sends only `{ code, language, filePath }` — no prompt engineering in extension code
- Backend assembles the prompt, adds Context7 docs, calls GPT-5.4
- No `apiKey`, `apiEndpoint`, or `aiModel` settings in the extension
- Only `aiguard.licenseKey` for user authentication
- All endpoint constants belong in `extension/src/config.ts` — never inline

## Code rules

- TypeScript strict mode everywhere
- No `any` — use explicit types or `unknown`
- Async/await over raw Promise chains
- All errors must be handled explicitly — no empty `catch {}`
- Comments in English only
- No emoji in comments or log messages
- Generate IDs with `crypto.randomUUID()`, not `Date.now()`
