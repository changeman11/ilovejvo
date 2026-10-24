# Instructions for AI assistants (ChatGPT / Codex, Claude, any other)

This project is worked on by **two assistants in turn** (Claude and ChatGPT). To stay in sync:

1. **Before starting:** read `PROGRESS.md` (current status), then `CLAUDE.md` (the project rulebook: design decisions, constraints, every feature and where it lives), then `HANDOVER.md` if you're new. Run `git pull`, then `git status` and `git log -15 --oneline`. The shared repository is https://github.com/changeman11/ilovejvo (`main`).
   - If there are uncommitted changes you didn't make, ask the owner before touching them.
2. **While working:** follow `CLAUDE.md`. In short:
   - plain-language explanations for the owner
   - never put secrets in code or chat
   - stay within free allowances
   - explain data-model changes first
   - compute stats from results
   - phone-first
   - ask about game rules rather than guess
   - pure logic goes in `public/js/rules/` with tests in `tests/`
3. **Before saying done:**
   - `npm test` passes, and you've checked it in the browser (local emulators) when it's visible.
   - When deploying, bump `CACHE` in `public/sw.js`.
4. **After working:**
   - Commit with a clear message, adding a trailer naming the assistant (e.g. `Co-Authored-By: ChatGPT <noreply@openai.com>`).
   - Update `PROGRESS.md`: what changed, what was deployed, what's unfinished or needs testing.
   - Update `CLAUDE.md` when a feature or decision changes. Same commit.
   - Player-facing changes go in the next `CHANGELOG.md` entry when the owner asks for a changelog (it lists what was last posted).
   - `git push` (to `origin main`), so the other assistant sees it.

`CLAUDE.md` is named for Claude, but it is the single rulebook for **every** assistant. Don't create a second, competing one: edit that file.
