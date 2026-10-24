# Progress board (shared by Claude and ChatGPT)

Newest first. Each work session adds an entry: what changed, deployed or not, what's left. Keep entries short. The full feature notes live in `CLAUDE.md`.

## Current state (2026-10-24)

- **Live site:** https://i-love-jvo.web.app, includes the typed CONFIRM safeguard for Clear fixtures. Service worker cache `jvo-shell-v51`.
- **Repository:** https://github.com/changeman11/ilovejvo (`main`). Pull before working, push after each commit. It's public right now; the owner may switch it to private.
- **Tests:** 179 passing (`npm test`).
- **Bot:** running on AWS (`jvo-bot`): pickup, 1v1 ranked, club roles and welcomes are on.

### Needs testing for real
- Match night flow (opening per team, captain confirm, break, live board): first real run is DEMO EXHIBITION NIGHT, 2026-10-24 6 pm AEDT. An admin must have the site open around 5:50 pm (fixture lock) and when the group stage ends (finals).
- (Bot: 1v1 ranked and welcome messages both worked for real on 2026-10-24.)

### Open / unfinished
- Event page fixtures "clean format" tidy-up: asked by the owner, interrupted, not done; confirm what they want.
- Bot hosting is on AWS free credits (temporary); Oracle free tier sign-up was stuck.
- Custom domain ilovejvo.com: status unconfirmed.

## Log

### 2026-10-24 · Claude (owner's PC) · bot UPLOADED with match threads
- Bot tests pass (65, 3 emulator tests skipped). Server `.env` backed up (`~/jvo-bot/.env.backup-<time>`), `MATCH_THREADS=1` added, bot uploaded and restarted at 07:08 UTC.
- Log: `[matches] match threads in <#1563449168847179787> (0 open)`. The bot **created #match-threads** itself (no `MATCH_CHANNEL_ID` set) and started threads for 7 open DEMO EXHIBITION NIGHT matches. Welcomes, 1v1, site queue and club roles started as normal; no errors, no crash restarts.
- Not yet seen: a thread closing (15 min after the final score). If closing/locking fails, give the bot **Manage Threads**. Roll back: set `MATCH_THREADS=0` in `~/jvo-bot/.env` and `sudo systemctl restart jvo-bot`.
- Note: upload with `npm run upload` from **PowerShell**. From Git Bash, `tar` is Git's and packing fails.

### 2026-10-24 · Claude (partner's PC) · site + rules DEPLOYED, bot NOT uploaded
- **Whole site live:** every read in `data.js` is now a Firestore listener; `app.js` redraws the page, bell, bars, reel and featured card when data changes (waits with a "New changes" button if someone is typing). Team chat is kept across redraws (`data-keep`, `live.js`). Pickup page lost its own watchers (now global).
- **Admin bell:** Clear (one / all, per device), "show cleared", pop-up alerts for new admin to-dos, count in the tab title. Chat check is a live listener (no more 150 reads per bell update).
- **Discord match threads** (`bot/src/matches.js`, `match-views.js`, `site-watch.js`, `logic/matches.js`, `MATCH_THREADS=1`): thread per match when it opens, pings both squads, Report score form (set scores + screenshots), captain Confirm, reminders every 10 min (max 6, then admins), final score, closes after 15 min. Votes saved as the site does (`via: 'discord'`). Site rules copied to `bot/src/site-rules/` (`node scripts/sync-bot-rules.mjs`, test keeps them in step).
- **Captain Discord role** (`CAPTAIN_ROLE`, default "Captain", needs `CLUB_ROLES=1`).
- **Rules changed (need deploying):** firestore.rules (bot may vote for a player, `matchThreads`), storage.rules (bot screenshots up to 10 MB). Match page links the thread; votes show 👑 / "via Discord".
- Tests: 188 pass (3 emulator tests skipped). Checked the site loads live data in a browser (read-only); not tested with a real Discord server or emulator.
- **Deployed** 2026-10-24 during DEMO EXHIBITION NIGHT: firestore.rules, storage.rules, hosting (cache `jvo-shell-v51`). Live site checked: loads, no errors.
- ~~To do: upload the bot~~ Done, see the entry above. CLAUDE.md feature notes not updated yet.

### 2026-10-24 · ChatGPT
- Clear fixtures now requires exact `CONFIRM` and warns about permanent deletion of unfinished fixtures and votes, schedule rebuilding and disruption during a live event.
- Validation: 177 tests passed, 3 skipped; confirmation handler checked for cancellation, blank/wrong text and exact CONFIRM. JavaScript syntax check passed.
- Deployed to Firebase Hosting (`i-love-jvo`) from this workspace on 2026-10-24. Live JavaScript and cache v50 verified after release. Authenticated admin browser/emulator verification remains outstanding; confirmation branches were checked with a mocked handler.

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
