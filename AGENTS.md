# AiGuard — Agent Rules

Rules for all AI agents (Claude Code, Codex, Copilot Workspace, etc.) working in this repository.

## 1. Shell commands — rtk required

Every shell command must be wrapped with `rtk`. This is non-negotiable.

```bash
rtk git status
rtk git diff
rtk git add <file>
rtk git commit -m "..."
rtk git push origin <branch>
rtk npm install
rtk npm run build
rtk npm run lint
rtk npm test
```

Never run: `git`, `npm`, `npx`, `node`, `tsc` — always `rtk <cmd>`.

## 2. Before making changes

1. Run `rtk git status` to understand current state
2. Read the relevant files before editing — never modify blindly
3. Check shared types in `shared/src/` before creating new ones

## 3. Monorepo workspace rules

- Changes to `shared/` types require updating both `extension/` and `backend/` usages
- Each package has its own `package.json` — install dependencies in the correct package
- Root `package.json` is for workspace management only

```bash
# Install dep in backend
rtk npm install fastify --workspace=backend

# Install dep in extension
rtk npm install --workspace=extension

# Build all
rtk npm run build --workspaces
```

## 4. Architecture constraints

| Layer | Responsibility | Forbidden |
|-------|---------------|-----------|
| `extension/` | UI, decorations, patch application, local rules | Prompt engineering, direct OpenAI calls |
| `backend/` | Auth, prompts, Context7 injection, OpenAI calls | VS Code API |
| `shared/` | Types and interfaces only | Business logic, side effects |

## 5. What NOT to do

- Do not add `aiModel`, `apiEndpoint`, or `apiKey` settings to extension config
- Do not write prompts inside extension code — prompts live in `backend/`
- Do not call OpenAI directly from extension — always go through `backend/`
- Do not hardcode `licenseKey` values anywhere
- Do not commit `.env` files

## 6. Branching

- `main` — stable, production-ready
- `refactoring` — current active branch
- Feature branches: `feat/<name>`
- Bug fixes: `fix/<name>`

Always branch from `main` for new features:
```bash
rtk git checkout -b feat/<name> main
```

## 7. Commit messages

Follow Conventional Commits:
```
feat: add license key validation on extension startup
fix: correct offset calculation for CRLF line endings
chore: add shared types package to workspace
refactor: move prompt assembly to backend
```
