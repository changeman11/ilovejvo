# Progress board (shared by Claude and ChatGPT)

Newest first. Each work session adds an entry: what changed, deployed or not, what's left. Keep entries short. The full feature notes live in `CLAUDE.md`.

## Current state (2026-10-24)

- **Live site:** https://i-love-jvo.web.app, includes the typed CONFIRM safeguard for Clear fixtures. Service worker cache `jvo-shell-v54`.
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

### 2026-10-25 · Claude (partner's PC) · stats publishing rework + fraud flags (NOT deployed / uploaded yet)
- `/admin/stats`: Ready to publish (one click for all), Check before publishing (🚩 warnings, publish anyway or Edit), Waiting. Edit page unchanged.
- Warnings (`rules/stat-checks.js`): unusually high numbers for the sets played, team PTS more than the team won, numbers changed by a captain/the player (shows what changed), hand-named lines that don't look like the player. On the 40 saved matches only 1–3 would have been flagged.
- Bot: fixing a line in Discord now keeps the screenshot's numbers (`readStats`) and who did it (`editedAs`). Needs a bot upload with the site deploy (cache v67).

### 2026-10-25 · Claude (partner's PC) · saved stats corrected, announcement posted
- `scripts/ocr-lab/fixes.mjs` compares every saved result with the bot's reading (a line counts only when its name and its numbers agree). Fixed on the admin result pages (audit-logged): 16 numbers (6/9 saved as 0, all checked by eye) and 9 missing lines (dangib, Gwoncc, jac0 ×2 each; Zay🤍, ﾒIsshinﾒ, ladis washerum). Re-run afterwards: 0 left to fix.
- Not fixed (need a person): lines "Dolly" (WTD, 4 matches), "Oli" and "Ma" (Morioh), "Ingenious" (SFC) match no profile; Volkaineo's line in ORC v PRAWN has rec/set cut off; HFD v SOTB has a screenshot from another match attached.
- Bot posted the findings in #announcements (message 1563539268163342409).

### 2026-10-25 · Claude (partner's PC) · the bot reads stats screenshots · site DEPLOYED (cache v66) + bot UPLOADED
- Bot: `stats-read.js` + `logic/reading.js` read each thread match's screenshot as soon as its score is in and save the draft; who's who and "check your stats" follow as before. Names are placed by team side, text and name pictures; unclear ones are left for who's who (never guessed). Pictures learned from confirmed/answered lines (`pickupMeta/namePrints`, already writable by the bot).
- Bot needs `tesseract.js` (in bot/package.json; downloads its English data into `bot/data/` on first read). New `READ_STATS=0` turns it off.
- Site: `botReadsStats` stops admin browsers reading in the background (cache v66). Needs a hosting deploy at the same time as the bot upload.
- End-to-end on the lab's 48 readable screenshots: 384 lines, 3040 numbers identical to the eye-checked lab reading (3 unsure), names 0 wrong (321 placed with no stored pictures, 350 with).
- Only matches with a Discord thread are read by the bot; others can still be read by hand on the admin result page.

### 2026-10-25 · Claude (partner's PC) · stats reader lab (not deployed, nothing on the site changed yet)
- `scripts/ocr-lab/` tests readers on every match with screenshots + saved stats (40 matches, 50 screenshots; downloads go to `/ocr-lab/`, git-ignored). Saved stats aren't fully trusted (confirmed in a hurry), so differences were checked by eye (`checked.json`).
- **Numbers:** new `rules/glyphs.js` matches each digit against the game's own digits (learned only where the old reader AND the saved stats agree, outliers dropped). On 3040 cells: 0 silent mistakes, 4 marked unsure (2 under the "hide" overlay). The old Tesseract reader got at least 7 wrong (6/9 read as 0), and those mistakes are in some saved results.
- **Names:** `rules/namepics.js` finds just the name (top line, stops before badges, above the title pill) and keeps a "picture" of it; `rules/whois.js` combines side (each table is one team), text, picture and elimination. 346/354 lines (97.7%) placed automatically, 0 wrong, 8 left to ask (in-game names unlike site names).
- Next: move this into the bot (reads thread screenshots, fills the stats draft, asks who's who only for the rest).

### 2026-10-25 · Claude (partner's PC) · Zapdis's character
- Why it never showed: Zapdis's picture (posted twice) is on a near-black background (12,12,14), so it was set aside by hand (`skipped.json` / `skipped.txt`) and the bot's cut-out refused dark backgrounds.
- `logic/cutout.js` now handles a **flat** near-black background: only pixels within 5 of it are cut (the outlines are 13,13,20, 8 away), pockets between the legs too, dark clothes kept; uneven dark backgrounds are still refused. Loose specks under 0.3% of the picture are dropped (a stray mark had stretched the box). Tested (`cutout.test.mjs`) and checked on the real picture.
- Took both posts off the skipped lists; the bot adds it on its next 5-minute check (the second post is a repeat).
- Other pictures set aside for a dark background stay skipped until they're taken off those lists too.

### 2026-10-25 · Claude (owner's PC) · changelog posted, character ❌ fix · bot UPLOADED
- The bot posted the 3-part changelog in #i-love-jvowebapp (owner's go-ahead). CHANGELOG.md entry 2026-10-25 = what was posted.
- #in-game-characters: 50 pictures. 16 from the channel on the site (+ the original 19 = 37 selectable now, 3 added by the bot), 32 set aside by hand (20 repeats, 12 not a single character), all accounted for.
- Fix: only a **staff** ❌ stops the bot adding a new picture (it skipped chimken__'s because of a joke ❌ from a non-staff member); pictures skipped by the old rule are looked at again. Bot added chimken__'s and spoopyuwu's after the upload.

### 2026-10-25 · Claude (owner's PC) · changelog
- `CHANGELOG.md` started: the 2026-10-25 entry covers everything since the last Discord changelog (#i-love-jvowebapp, 2026-10-22 13:58 UTC). Discord-ready 3-part text in `exports/` (git-ignored). Next changelog: everything after this entry.

### 2026-10-25 · Claude (owner's PC) · new characters not showing for returning visitors · site DEPLOYED (cache v65)
- Cause: `firebase.json` caches `/images/**` for 7 days, and `images/characters/list.json` is under it, so browsers kept the old 19-character list. Fix: `/images/**/*.json` is `no-cache`, and characters.js fetches the list with `cache: 'no-cache'`. Checked live in a browser that had the old list: picker now 34 (15 new), picking a new one works.

### 2026-10-25 · Claude (owner's PC) · trophy card visual fixes · site DEPLOYED (cache v64)
- Logo flicker (square ↔ circle): the trophy card was rebuilt on every live redraw, reloading the logos. Now rebuilt only when its content changes (`el.dataset.html`); clicks handled once on the card. Trophy logos are rounded squares.
- Card moved clear of the chat tab (right: 56px; phones 50px; wide screens 64px under FEATURED!).
- Characters' feet no longer slide while swaying: centred with the `translate` property (applies after rotate/scale) instead of `transform: translateX(-50%)`.

### 2026-10-25 · Claude (owner's PC) · gentle character sway, trophies · site DEPLOYED (cache v63)
- Characters: the hop is gone (owner: too much); now a slow idle sway (`char-idle`: small lean + breath, 3.2 s).
- Trophy announcement on the right (latest podium; live shows DEMO EXHIBITION NIGHT: Chikchester City champions). 3rd is shared by the semi-final losers until a 3rd place result exists. Team pages: Trophy cabinet; Teams tab: trophy icons. Logic `rules/podium.js` (4 tests). Tests 215 pass.

### 2026-10-25 · Claude (owner's PC) · characters added by the bot automatically · site + rules + storage rules + bot DEPLOYED (cache v62)
- Bot `CHARACTERS=1` (server `.env`): watches #in-game-characters every 5 min, cuts out new pictures, skips screenshots/cards/black backgrounds/repeats, uploads to the site, ✅ on the post; deleted post or staff ❌ = taken off. Started fine (`[characters] watching #in-game-characters every 5 min`).
- All current pictures were already handled (127 messages, 47 pictures: 15 on the court, 32 set aside). The checks agree with the hand sorting on all 47; repeats fingerprint ≤6 vs new ≥16 (limit 10).
- Cut-out checked on the server (sharp loads, real picture cuts). **Not yet seen live:** an actual new post going through upload → ✅ → on the court.
- Tests: site 206 + bot 82 (cutout, characters) pass.

### 2026-10-25 · Claude (owner's PC) · characters from Discord + hop · site DEPLOYED (cache v61)
- `scripts/fetch-characters.mjs` pulled 47 pictures from #in-game-characters: 15 new characters added (34 on the court now). Skipped 32: 19 repeats of characters already there, in-game screenshots, 2 player cards, a photo, and one on a black background (cut-out ate its outlines). Skipped names in `art-src/community/skipped.txt`.
- Characters hop like in the game (squash/stretch, shadow shrinks in the air).
- (Automated later the same day: see the bot entry above.)

### 2026-10-25 · Claude (owner's PC) · 3rd place button, thread screenshots, home/away balance, Stats page · site + bot DEPLOYED (cache v60)
- **DEMO EXHIBITION NIGHT 3rd place:** not added to live data from here (no admin sign-in). The owner presses **Add 3rd place match** on its admin Fixtures tab: it sets `finals.thirdPlace` and saves `finals-3rd` (semi-final losers) straight away; then enter score + stats as usual.
- **Bot thread screenshots:** GIFs/memes posted after the screenshot were being copied instead (newest first) and the bot stopped looking. Now only screenshot-like pictures count, and GIF-only copies are looked at again.
- **Home/away:** balanced per team in new round robins (tested 3-12 teams: never more than 1 off even, never more than 3 in a row on one side).
- **Stats page:** award cards + styled table; names/emoji/colours shared with the bot (`rules/stat-style.js`).
- Tests 206 (site) + 77 (bot) pass. Checked locally (desktop + phone).
- Noticed, not fixed: at exactly 1024 px wide with a player and an admin both signed in, the top bar's icons stick out 10 px (page scrolls sideways a little).

### 2026-10-24 · Claude (owner's PC) · free club moves · site + rules DEPLOYED (cache v59)
- Players leave their club straight away (Club hub → Leave); a lone manager's leaving disbands the club. Joining unchanged (one yes). Every club move (leave, accepting a join/invite) pauses while any event is running (10 min before start → finished/done/12 h). Rules: player may clear their own `teamId` (managers only when disbanding in the same save), manager may disband as last player, transfers kinds `left`/`disbanded` for players. Me page links to the Club hub for leaving.
- Tested locally: pause message during a running event; leaving after it; lone manager disbands. Tests 204 pass.

### 2026-10-24 · Claude (owner's PC) · award looks, ready-up, 3rd place match · site + rules + bot DEPLOYED (cache v58)
- **Award roles:** each stat role has its own name, emoji flair and colour (`STAT_ROLE_STYLE` in `bot/src/logic/stat-roles.js`, e.g. "💥 Spike Royalty · Top 3 ✨"). Gradient colours / role icons are used only if the server has `ENHANCED_ROLE_COLORS` / `ROLE_ICONS` (it doesn't yet). Existing roles restyled once (`statRoleLook` meta). Log: `[stat roles] new look`.
- **Ready-up** (`event.flow.readyUp`, **off** for existing events, **on** for new ones; Rule config → Match night): a free match waits on its match page (`pages/ready-up.js`) until `readyCount` (default team size) players per team press Ready (`events/{e}/ready/{fixtureId}__{playerId}`, new rules branch). Then it opens (reporting + bot thread). Admin "Start now" sets `fixture.startedAt`; a match with a score vote counts as started. Bell: "Ready up for your match". Bot reads `ready` (site-watch); rules copied to the bot.
- **3rd place match** (`finals.thirdPlace`, Rule config checkbox under Knockout): `finals-3rd` between the semi-final losers ("Loser SF1 / SF2"), shown under the Grand final with 🥉. Saved by an admin browser once both semis have results. Tick it on tonight's event to record the 3rd place game.
- Tests 203 pass. Checked on the local emulators (ready-up, start now, 3rd place, rules accept the ready doc).

### 2026-10-24 · Claude (partner's PC) · stats: players confirm, staff tick to submit
- **Discord** (match threads): once a screenshot is read, the bot posts "📊 Check your stats": each team's squad with their read numbers (✅ confirmed, ✏️ fixed, ⏳ to check, ⚠️ not on the screenshot). Buttons: ✅ My line is right, ✏️ Fix a line (form: whose line + the 8 numbers; players their own, 👑 captains anyone in their club, staff anyone), 👑 Confirm my team. Saved on `statsDraft.rows[i]` as `confirmedBy` / `editedBy` (existing bot rule). Threads stay open until staff submit; then the message says "Stats submitted".
- **Site**: new `/admin/stats` ("Stats" in the admin bar; the bell's stats to-dos go there): every match waiting for stats, per team a plain table of the squad with numbers and ✅/✏️/⏳, problems in words (no screenshot, names nobody claimed, unsure numbers), the screenshot. Tick → "Submit selected" saves playerStats + suggested MVP, marks reviewed, remembers on-screen names. "✏️ Edit" = the full result page. Logic in `rules/stats-draft.js` (tested).
- Cache `jvo-shell-v57`. Tests 197 pass.

### 2026-10-24 · Claude (partner's PC) · screenshots from match threads
- The bot looks in the match thread of every match that has a score but no screenshot (no vote has one, stats not done): pictures players posted there (newest first, up to 3) are copied to Storage under the poster's profile and saved on the result as `threadShots` (bot rule: may set `statsDraft`/`threadShots` on a pending result, or one with no stats). Re-checks every 5 min until one turns up, then says so in the thread.
- The site uses them: automatic stats reading (`shotFor`), the 📸 badge, the match page and the admin result page ("from the Discord thread").
- **Needs the bot's Message Content Intent** (Developer Portal → Bot); the bot warns at start if it's off. Cache `jvo-shell-v56`. Tests 194 pass.

### 2026-10-24 · Claude (partner's PC) · stats badges on results
- Every played match row (Fixtures → Results, event pages, Home) shows where its stats are up to: ✅ Stats confirmed (staff checked / stats saved), 📸 Stats submitted (screenshot in, waiting for staff), ⏳ No stats yet. Forfeits show none. `statsState()` / `statsBadge()` in `pages/parts.js`. Cache `jvo-shell-v55`.

### 2026-10-24 · Claude (partner's PC) · who's who: answers can be changed · bot UPLOADED
- Every drop-down lists everyone on both squads (anyone already down for a line says "has: <name>"); picking them moves them and the other line goes back to "who is?". Names answered in Discord keep their drop-down showing the answer (default), so a mistake can be fixed until staff check the stats. Lines the reading matched by itself are left to staff (`answerRow`, `askRows`).
- When every name has an answer the message turns green ("✅ Who's who") but keeps the drop-downs.

### 2026-10-24 · Claude (partner's PC) · bot UPLOADED: who's who drop-downs
- Uploaded from the partner's PC at 08:18 UTC (key `~/.ssh/jvo-bot-partner`, `npm run upload -- -Server ubuntu@54.252.252.126 -Key <key>`), no `.env` changes. Bot tests 70 pass.
- Log: welcomes, site queue, 1v1, `[matches] match threads in <#…> (26 open)`, club roles all started; no warnings or errors.
- Checked in Discord (read-only, from the server): all 18 open "❓ Who's who?" questions now have the drop-downs (0 old buttons left), 1 is "all sorted".

### 2026-10-24 · Claude (owner's PC) · partner PC key added to the bot server
- Added the public key `jvo-bot partner PC` (ed25519) to `~/.ssh/authorized_keys` on the bot server (owner authorised; old list backed up as `authorized_keys.backup-<time>`). Server: `ubuntu@54.252.252.126`. The original `jvo-bot` key still works. The partner PC can now `npm run upload` (save its own server + key in `bot/deploy/upload.local.json`).

### 2026-10-24 · Claude (partner's PC) · who's who drop-downs · bot NOT uploaded
- "❓ Who's who?" now has a drop-down per unknown name ("Who is AD? (17 PTS)", up to 5 per message, more appear as they're answered), listing both squads' players not placed yet (👑 captains) plus "🤖 Not a real player / a bot". Anyone on either team can answer for anyone, staff too (`answerRow`, `custom_id mt:who:<doc>:<row>`). Rows get `playerId` or `notPlayer: true`, plus `answeredBy`; one answer per line.
- Questions already sent are edited to the drop-downs when the bot restarts; their old "That's me" buttons still work until then.
- Bot only (rules unchanged: still only `statsDraft`). Tests 193 pass.
- The owner's account is out of usage: from now on the bot is uploaded from this PC (needs the server key and IP here).

### 2026-10-24 · Claude (owner's PC) · bot UPLOADED: who's who screenshots
- Bot tests pass (70, 3 emulator tests skipped). Uploaded 08:02 UTC, no `.env` changes.
- Log: started normally (welcomes, site queue, 1v1, `[matches] match threads in <#…> (21 open)`, club roles). No "could not update who's who" / "could not fetch the match screenshot" warnings, no errors, no crash restarts.
- Checked in Discord (read-only, via the API): all 12 open "❓ Who's who?" questions were edited after the restart and now show the screenshot as a big embed image (all 12 load). The one already sorted has it as an attachment.

### 2026-10-24 · Claude (partner's PC) · who's who shows the screenshot · bot NOT uploaded
- The "❓ Who's who?" message in match threads now has the match screenshot attached and shown big (the automatic reading gets names wrong, so players find their line by its stats). The bot downloads it from Firebase Storage (public) and keeps it in memory.
- Questions already sent get it too: after the bot restarts, it edits each open question once, attaching the screenshot (`io.edit(..., files)` replaces the attachments).
- Bot only: no site deploy needed. Tests 193 pass.
- **To do:** upload the bot (`npm run upload` from PowerShell in bot/). No `.env` changes.

### 2026-10-24 · Claude (owner's PC) · bot UPLOADED with stat roles (site + rules were already deployed by the partner's Claude, cache v54, so who's who works)
- Bot tests pass (70, 3 emulator tests skipped). Uploaded 07:56 UTC; server `.env` backed up, `STAT_ROLES=1` added (`MATCH_THREADS=1` kept).
- Log: `[stat roles] 8 roles made, 28 given, 0 taken away`. Welcomes, site queue, 1v1, match threads (13 open, new threads starting), club roles all started normally; no errors, no crash restarts.
- **Still to do:** deploy hosting + firestore rules from the entry below. Until the rules are live, the bot's "That's me" (who's who) answers will be refused.
- Tip: run the `ssh` edits from Git Bash; PowerShell 5.1 strips the quotes in remote commands.

### 2026-10-24 · Claude (partner's PC) · edit stats, who's who, stat roles · site + rules DEPLOYED (cache v54), bot NOT uploaded
- **Edit stats:** "✏️ Edit result & stats" on every match page for admins; each stat line on the admin result page has a player picker to move it to the right person (swaps if they already have one).
- **Who's who** (bot, match threads): when the site's automatic reading has in-game names it couldn't match (short all-zero names skipped), the bot posts "❓ Who's who?" in the match thread, pings the players the reading didn't place, and "That's me" buttons fill `statsDraft.rows[i].playerId` (+ `claimedBy`). Threads stay open (or reopen) until names are sorted. Admin result page picks up claims live. **firestore.rules:** bot may update only `statsDraft` on a pending result.
- **Stat roles** (`STAT_ROLES=1`, `bot/src/stat-roles.js`, `logic/stat-roles.js`): "🏆 Top 3 · <stat>" per stat, held by the current top 3 (ties included) across published events; re-checked every `STAT_ROLES_MINUTES` (30) and on `/pickup syncroles`. Meta `statRoles`, `statRoleHolders`.
- **Stats reader fixes:** always downloads a fresh copy (an old cached copy from before the CORS fix was refused); failed reads retry after 15 min.
- Cache `jvo-shell-v54`. Tests 193 pass.
- **To do:** upload the bot and add `STAT_ROLES=1` (Manage Roles already needed for club roles).

### 2026-10-24 · Claude (partner's PC) · stats read on upload · DEPLOYED (cache v53), checked live: read 4 matches by itself
- **Automatic stats reading** (`public/js/stats-reader.js`): any open admin browser reads a match's screenshot as soon as its score is in (`statsStatus: 'pending'`), from the site or Discord, and saves it on the result as `statsDraft` `{ shot, readAt, by, rows | error }` (`reading: true` while one browser has it, others wait 3 min). New optional field on `results`; no rules change (admin update). Saving the result replaces the doc, so the draft goes.
- Admin result page opens with the stats table already filled ("⚡ Read automatically…"); bell says "⚡ Stats read, ready to check".
- Fix: the result page kept losing a reading/entry when a live update redrew it; it now keeps state for the same match.
- Cache `jvo-shell-v53`. Tests 188 pass; loads without errors locally; reading not yet tried on the live site.

### 2026-10-24 · Claude (partner's PC) · Storage CORS fixed
- "Read stats" failed on players' screenshots because Firebase Storage had no CORS setting: pictures showed, but the browser couldn't download them for the reader. The owner set it in Cloud Shell from `storage-cors.json`; checked from the live site: screenshots now download and open (1920×1079 WebP).
- Deployed (hosting, cache v52, checked live): `ocr.js` turns any picture it can't open directly into a PNG first; `admin/result.js` explains a blocked download (save it, then "Read a screenshot from this computer…"). Cache `jvo-shell-v52`.

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
