# Progress board (shared by Claude and ChatGPT)

Newest first. Each work session adds an entry: what changed, deployed or not, what's left. Keep entries short. The full feature notes live in `CLAUDE.md`.

## Current state (2026-10-24)

- **Live site:** https://i-love-jvo.web.app, deployed with everything up to the "Event rules" commit. Service worker cache `jvo-shell-v49`.
- **Repository:** https://github.com/changeman11/ilovejvo (`main`). Pull before working, push after each commit. It's public right now; the owner may switch it to private.
- **Tests:** 179 passing (`npm test`).
- **Bot:** running on AWS (`jvo-bot`): pickup, 1v1 ranked, club roles and welcomes are on.

### Needs testing for real
- Match night flow (opening per team, captain confirm, break, live board): first real run is DEMO EXHIBITION NIGHT, 2026-10-24 6 pm AEDT. An admin must have the site open around 5:50 pm (fixture lock) and when the group stage ends (finals).
- 1v1 ranked: no real game yet. Welcome message: no real join yet.

### Open / unfinished
- Event page fixtures "clean format" tidy-up: asked by the owner, interrupted, not done; confirm what they want.
- Bot hosting is on AWS free credits (temporary); Oracle free tier sign-up was stuck.
- Custom domain ilovejvo.com: status unconfirmed.

## Log

### 2026-10-24 · Claude (GitHub)
- Connected the project to https://github.com/changeman11/ilovejvo and pushed the full history (checked for secrets first). The bot session fixed 1v1 game numbers (`008a470`, deployed). The first real 1v1 (killerado beat shin) worked end to end.

### 2026-10-24 · Claude
- **Event rules:** a "📜 Event rules" section on every event page (`pages/event-rules.js`), written from the event's own settings. It covers teams and sign-ups, match format, fixtures, knockout, the night, results and integrity, and the table. Deployed.
- **Handover pack:** `HANDOVER.md`, `AGENTS.md`, `PROGRESS.md`, root `.env.example`; fixed two stale lines in `CLAUDE.md` (image storage, admin sign-in).
- **Match night flow** (`rules/flow.js`):
  - matches open at the start and per team
  - captain one-tap confirm
  - break before the finals (default 15 min, can be "admin opens")
  - stuck-match alerts after 10 min
  - pause / open early / open finals controls on the admin Fixtures tab
  - Featured card becomes a live board; "Live now" panel on Home
  - rules `votingOpen()`

  Deployed with the rules.
- **Featured card:** × folds it to a ★ tab (it used to hide it for good), ticking countdown, start time in the viewer's own time zone (named). Deployed.
- **Staff badges, Teams tab squads**, and earlier work: see `git log` and `CLAUDE.md`.
