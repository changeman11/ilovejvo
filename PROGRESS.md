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

### 2026-10-26 · Claude (owner's PC) · bracket fix: "FINALS" labels · site (v85) DEPLOYED
- Live bug: with the admin's bracket switched on (double), all 17 matches showed in "Upper Round 1". Cause: the last two matches are labelled "FINALS" / "FINALS 2", so the plain-number reading didn't apply. Now labels with final / reset / decider are allowed among numbers (`finalish`, `numberedStyle`), and a rematch of the Grand Final pair is the Grand Final Reset. Tested; checked live: Upper R1-2, Upper Semi-finals, Upper Final, Lower R1-4, Lower Final, Grand Final (FINALS + FINALS 2).

### 2026-10-26 · Claude (owner's PC) · bracket follows tonight's real double elimination · site (v84) DEPLOYED
- Tonight's "3v3 elimination tournament!!" is double elimination with plain-number labels (17 matches). `elimBracket({ outcome })` now tells from the results: a team that already lost playing again = double; two unbeaten teams = upper, two with a loss = lower, unbeaten v one loss = Grand Final (then Reset). Rounds follow each team's path (a match is one round after its teams' last round in that bracket), not creation order, and are listed in number order. Tested.
- Double drawing names Upper Semi-finals / Upper Final / Lower Final, and always shows the Grand Final (big gold) with whoever is known (tonight: Unprotected Sets v TBD) until it's made.
- Checked with tonight's live data drawn locally (nothing saved). The live event still shows no bracket until the admin switches "Bracket on the event page" on (single or double: either way it draws double from the results).

### 2026-10-26 · Claude (owner's PC) · bracket: byes shown, finals emphasised · site (v83) DEPLOYED
- Byes nobody saved are worked out: a team in an upper round that didn't play the round before gets a bye card there (`elimBracket`, tested). Each round counts the teams it should have (round 1 = all event teams; later = winners + byes of the round before), so a round with an odd team isn't mistaken for the Final; teams already through but not drawn show by name (bye card / next round), the rest "TBD".
- Plain "Round N" rounds are named by teams left: Quarter-finals (8), Semi-finals (4, silver header), Final (2: gold banner, trophy, big gold card, wider column). Champion banner bigger.
- The bracket stacks one round under another whenever its own box is under 680px wide (container query), so names are never squashed; side by side on wide screens. Still never scrolls sideways.

### 2026-10-26 · Claude (owner's PC) · elimination bracket redone: no sideways scroll, clearer · site (v82) DEPLOYED
- Owner said the bracket was terrible. `elimBracketHtml` (parts.js) now uses its own `.eb` grid: rounds side by side when they fit (equal columns, never wider than the page), stacked one under another on narrow screens. Each round has a header ("1/3 played · winners → Round 2", "winner is champion 🏆"); each match card says ✓ Final score / Score being checked / To play, ticks the winner and fades the loser; byes say "Goes straight through → to <next round>"; rounds not drawn yet show teams already through (e.g. a round 1 winner) and TBD for the rest. Champion banner on top. Double: Upper (lose once → lower), Lower (lose → out), Grand Final, each explained. "Swipe" hints removed. Checked desktop and phone (no horizontal scroll).

### 2026-10-26 · Claude (owner's PC) · "Publish with no stats" · site (v81) DEPLOYED
- /admin/stats: every match not in "Ready to publish" has **Publish with no stats** (confirm first): keeps the score, saves no player lines (nobody's totals change, as if 0), `statsStatus: 'reviewed', noStats: true`, MVP cleared. It drops off the waiting list, the admin bell and the bot's reading. The match page says "No stats for this match"; fixture rows show a ➖ No stats badge (`statsState` 'none'). Stats can still be added later with Edit (that save drops `noStats`). Tested locally.

### 2026-10-26 · Claude (owner's PC) · elimination brackets drawn on the event + Fixtures pages · site (v80) DEPLOYED
- `elimBracketHtml(b)` (pages/parts.js) draws hand-made brackets in the same dark "finals" style: **single** = a column per round (bye cards, dashed), TBD columns for rounds still to come out to the Final, trophy + champion; **double** = ⬆️ Upper bracket, ⬇️ Lower bracket, 🏆 Grand Final (+ reset) with champion. On the event page ("Bracket" section) and the Fixtures page's 🏆 Groups & bracket view.
- Which events: `elimView()` (rules/elim-fill.js): `event.bracketView` single/double/off, or automatic (Upper/Lower labels = double; elimination round labels or saved byes = single). Admin switch "Bracket on the event page" in the 🪄 box (saved straight away). Tonight's event is plain-numbered with no saved byes, so it needs the switch set to "Show as single elimination"; its rounds read correctly (Round 1 = 1-4, Round 2 = 5, 6, 8 with Chikchester City and Orchids).

### 2026-10-26 · Claude (owner's PC) · stats reader: lines per side = team size · site (v79) DEPLOYED, bot UPLOADED
- The bot (`stats-read.js read(buf, { maxRows })`, called with the event's `teamSize`) and the site's reader (`readEndScreen({ maxRows })` from stats-reader.js) look for at most team-size lines per side (3v3 = 3, so 6 lines, never 8); the bot also drops any extra lines before saving a reading. Tonight's 4 results were already reviewed with 6 lines each.

### 2026-10-26 · Claude (owner's PC) · fill box redone (admin said it was broken) · site (v78) DEPLOYED
- The 🪄 box is now 3 numbered steps: bracket type, "Who gets a bye in Round N?" chips, the button; the explanation is folded under "How it works". The confirm says plainly what it will save ("This adds 1 new match…" / "This saves the byes (no new matches)… OK to save?"). The admin's screenshot ("…get round labels") was the old cached version (v76); v78 forces the refresh.
- Logic: teams with a bye can't be in that round, so two bye teams put against each other by hand count as the next round (tested).
- Paused at the owner's request: drawing single/double elimination brackets on the event and Fixtures pages (`elimView` / `elimBracket` in rules/elim-fill.js are written and tested; the drawing isn't).

### 2026-10-26 · Claude (owner's PC) · elimination fill: byes + keeps the admin's numbering · site (v77) DEPLOYED
- Admin feedback: wanted Orchids and Chikchester City on byes, and their own numbered labels kept. Now: never renames matches; with plain-number labels new matches carry on the numbers (5, 6, …) and rounds are told apart by order (a new round starts when a team plays again). The box lists the teams not in a match yet in the current round with "bye" tick boxes; ticked teams go through (saved as `event.elimByes` { round: [teamIds] }), an odd one out also gets a bye. Double elimination needs round names (it says so with plain numbers).
- Dry run on tonight's event: ticking Orchids + Chikchester City adds no matches and saves both byes; after round 1 it makes round 2 from the 4 winners + 2 byes (3 matches, numbered 5-7).

### 2026-10-26 · Claude (owner's PC) · single / double elimination: round labels + "Fill in the next matches" · site (v76) DEPLOYED
- Admin fixture form: a **Round** picker (Single elimination: Round 1-3, Round of 16, Quarter-final, Semi-final, 3rd place match, Final; Double: Upper Round 1-4 / Semi-final / Final, Lower Round 1-6 / Semi-final / Final, Grand Final, Grand Final Reset) that fills the label as "<round> · Match n" (`rules/bracket-labels.js`, tested). Fixture lists head each of these rounds (`roundName` in parts.js).
- Fixtures tab (events with automatic fixtures off): **🪄 Elimination bracket** box, Single/Double + "Fill in the next matches" (`rules/elim-fill.js`, tested): keeps the matches already made (plain-number labels count as round 1 and get round labels), pairs teams not yet in the current round (bye for an odd one), next round from winners once a round has all its scores; double also builds the lower bracket (upper losers drop down) and the Grand Final / Reset. Confirm lists what it adds. For tonight's "3v3 elimination tournament!!" (10 clubs, 4 hand-made matches) it adds Round 1 · Match 5 (Chikchester City v Orchids).
- Bracket views (`bracketHtml`) still only draw automatic knockouts; hand-made elimination rounds show as headed lists.

### 2026-10-26 · Claude (owner's PC) · stats per event + rotating awards; once-per-event check-in · site (v75) + rules DEPLOYED, bot UPLOADED
- **Stats per event:** /stats opens on the newest event with stats; "All events combined" is a choice (`?event=all`). Award holders (cards + the bot's 1st/2nd/3rd roles) come from the **award event** = the newest completed event (admin marked finished, or podium decided), held until the next event completes, then rotate (`rules/award-event.js`, tested; shared with the bot, which now reads each event's fixtures too and logs "[stat roles] awards now come from …", meta `statRoleEvent`). Live: DEMO EXHIBITION NIGHT holds them.
- **Check-in (replaces per-match ready-up, `flow.readyUp` events only):** players check in ONCE per event (`events/{e}/checkins/{playerId}`, from the event page or any of their match pages). A match opens when `readyCount` (default team size) of each team have checked in (club, or the event roster for mix teams). Staff (admins) see every squad on the event page with "Check in for them" / undo (`by: 'staff'`, `staffName`), and "start this match now" stays. Rules: player creates own (current club), admin creates/updates stamped, own/admin delete. Bell: one "Check in for <event>" reminder until done. Bot watches `checkins` + `rosters` instead of `ready`. Old `ready` docs are ignored.
- Tonight's "3v3 elimination tournament!!" has ready-up off, so it's not affected.
- Announcement posted by the bot in #i-love-jvowebapp (messages 1564188975957147662, 1564188979257942130): everything since the 2026-10-24 update (stats per event, 1st/2nd/3rd awards, check-in, result fixes, My matches, random teams, #pickup-results / #pickup-chat, fewer left out, character approval).

### 2026-10-26 · Claude (owner's PC) · #pickup queue card stays at the bottom · bot UPLOADED
- The bot checks #pickup every 30 s and right after posting a "ready check cancelled" notice: if the queue card isn't the newest message (a notice or a player's message under it), it posts it again at the bottom (`keepCardAtBottom`, `armCardWatch`, `io.latestMessageId`). On start it edits the card if it's already the newest, so restarts don't mark #pickup unread for nothing. Checked live: card moved back under two cancel notices.
- Players can still type in #pickup (no @everyone send block); each message there makes the card jump back under it within 30 s.

### 2026-10-26 · Claude (owner's PC) · pickup: queued players get games · bot UPLOADED
- Mode choice leaves the fewest players without a game (`stranded`/`leastStranded` in logic/modes.js, tested): random modes and vote ties only pick modes that let everyone else still make a game (7 queued -> 3v3, not 2v2 leaving 3; 9 -> 2v2 or 4v4; 10 -> 2v2/3v3/5v5). A clear vote winner is still played. The queue card / site "random from" shows only those modes.
- A ready check that can't be filled (no-shows, nobody to replace them) now plays the biggest smaller mode with the players who came (longest-waiting first; channels renamed; extras back to the front of the queue) instead of cancelling (`shrinkMatch`). No-shows are still dropped from the queue. Only cancels when fewer came than the smallest mode.
- Why: on 2026-10-25 a 4v4 check was cancelled and all 8 were dropped from the queue (joins possibly missed; fixed earlier that day by looking in the channel).

### 2026-10-25 · Claude (owner's PC) · Bot panel: Pickup section · site (v74) + rules DEPLOYED, bot UPLOADED
- /admin/bot → 🏐 Pickup (live from `pickupMeta/live`): start a game now (mode or votes/random), getting ready (ready checks + drafts, Cancel = everyone back in the queue), games on (Team 1 won / Team 2 won / Cancel game), queue (Take off), recent games (Change result; old Elo undone). Each is a `botCommands` action (pickupStart / pickupCancelMatch / pickupResult / pickupRemove) run through the same code as `/pickup` admin commands (new subs `cancelmatch`, `remove`); results are logged with the admin's name. Buttons are off while the bot is offline. `liveState().matches` now has `id`.

### 2026-10-25 · Claude (owner's PC) · pickup: ready checks that run at the same time · bot UPLOADED
- Live log 12:47–12:48: a 4v4 check and a 2v2 check overlapped; the 2v2 drafted, the 4v4 was cancelled with all 8 marked "didn't join". Couldn't prove from logs whether joins were missed; the fake-Discord test of two overlapping checks passes.
- Fix: the bot no longer relies only on Discord's join events. Every 5 s during a check, on each join, and before dropping anyone at time-up, it looks at who is really in the ready-up channel (`io.membersIn`, `syncLobby`, `armSweep`). Each join is logged ("4v4 ready check: X joined (5/8)") so a next failure shows what happened. Two checks of the same mode get numbered channels ("ready up · 2v2 #2", "#ready-up-2v2-2").

### 2026-10-25 · Claude (owner's PC) · #pickup-chat · bot UPLOADED
- The bot made **#pickup-chat** just under #pickup (same category, same permissions as the category) where players can talk; #pickup stays bot-only. The queue card says "💬 Chat with other players in #pickup-chat". `PICKUP_CHAT_CHANNEL_ID` picks another channel, `PICKUP_CHAT=0` turns it off. Discord only (the owner chose no site chat).

### 2026-10-25 · Claude (owner's PC) · Bot control panel (/admin/bot) + match threads per event · site (v73) + rules DEPLOYED, bot UPLOADED
- **/admin/bot** (admin bar 🤖 Bot): status (online / last heard / counts / what's running), 🧵 match threads by event (Threads on switch = `event.matchThreads`, missing = on; 🧹 Clear threads deletes that event's Discord threads, site scores stay), ⚡ quick actions (check threads now, sync roles, repost queue cards, close all threads, restart), 📜 recent actions with the bot's result, 🔌 switches (match threads, read stats, 1v1, award roles, club roles, characters, welcomes; saving restarts the bot), ⏱️ timings (reminders, thread close, ready/pick seconds; live).
- Bot `src/control.js` (tested): reads `botControl/settings` at start (on top of .env; .env decides what's possible) and live; runs `botCommands`; sends `botControl/status` every 5 min. Rules: settings/commands admin-only writes, status/results bot-only, all public read. Event form Rule config has the same "Discord match threads" switch.
- Checked locally: page, admin saves allowed by rules, the bot module against the emulator ran a waiting command, applied a timing live and showed Online.

### 2026-10-25 · Claude (owner's PC) · #pickup-results · bot UPLOADED
- Pickup result summaries (teams, winner, Elo changes, admin corrections) now go to a read-only **#pickup-results** (made by the bot next to #pickup on 2026-10-25, id 1563892932707090456; found again by name after restarts). #pickup no longer gets a result post or a re-posted queue card after each game. `PICKUP_RESULTS_CHANNEL_ID` picks another channel; `PICKUP_RESULTS=0` puts them back in #pickup.

### 2026-10-25 · Claude (owner's PC) · pickup: vote for random teams · site (v72) + rules DEPLOYED, bot UPLOADED
- Queue card has a third menu "How should teams be made?" (🧢 captains draft / 🎲 random teams); the site's /pickup has the same toggle (`pickupSignups.random`, bool; rules allow the player to change `vote` and `random` only). If more than half of a popped game's players voted random, there's no draft: teams are shuffled (`logic/random-teams.js`, tested) and the game card says 🎲 Random teams.
- Draft card has a "🎲 Random teams (x/need)" button for players in the draft; reaching more than half ends the draft and shuffles everyone except the two captains (they stay captains to report the result).

### 2026-10-25 · Claude (owner's PC) · result fixes, My matches, 1st/2nd/3rd awards, friendlier admin home · site (v71) + rules DEPLOYED, bot UPLOADED
- **Result fixes** (`rules/corrections.js`, tested; `pages/fix-result.js`): once a score is in, a player/captain on either team presses "🛠 Fix this result" on the match page: the right set scores, missing screenshots and/or a note. Saved as `events/{e}/corrections/{fixtureId}__{playerId}` (new, nothing to migrate). Same new score from both teams = the score changes straight away (rules `agreedCorrection`: only `sets`/`correctedBy` change, forfeits admin-only); the other team gets a bell item and a one-tap "✓ Yes, that's right". Everything else goes to admins: Requests "🛠 Result fixes from players" (Open / Done), admin bell, admin result page panel ("Use this score"; fix screenshots join "Read stats"); saving the result closes the match's fixes.
- **/matches "My matches"** for players and managers: Report now, Needs a fix? (other team sent a fix, add screenshot), Still to play, Results in. Linked from the Club hub and Me page.
- **Stat sheets** (admin result page): each team's name dropdowns list only that team's players (squad + event roster + its lines); "Someone else… (show every player)" opens the full list. The screenshot reader's dropdown is grouped by team.
- **Awards 1st/2nd/3rd:** the bot's stat roles are now three per stat ("🥇 1st · Spike Royalty 💥", 🥈 2nd, 🥉 3rd; 24 roles); the old Top 3 role becomes the 1st place one (renamed, keys `pts` → `pts:1`). Ties share a place. Stats page cards say 1st / 2nd / 3rd. The bot orders them all 1sts, then 2nds, then 3rds (`orderRoles`), so a name's colour comes from the best place.
- **Admin home** reworked: "Hi <name> 👋", a Needs you list (each to-do says what, how many, where), Quick jobs buttons, then events (Public / Draft (hidden)). Admin bar has icons and a hint on hover.
- Checked locally: two pretend players fixed a score end to end, a one-sided change is refused by the rules, admin save closes fixes, dropdowns limited, Stats cards, phone width.

### 2026-10-25 · Claude (owner's PC) · #pickup / #1v1-queue no longer unread after restarts · bot UPLOADED
- Both queue cards were deleted and reposted on every bot start (`repost: true` in `Pickup.start()` / `Ranked.start()`), so the channels showed unread after each upload. Now the existing card is edited (a new one only if it was deleted). Checked live after the upload: same message ids, edited, no new message. #pickup still gets new messages for real activity (game results, the card moving under a finished draft).

### 2026-10-25 · Claude (owner's PC) · character approvals + admin page · site (v70) + rules + bot DEPLOYED
- **/admin/characters** (admin bar → Characters): Waiting for approval (Approve / Deny), On the court (Remove), Removed or denied (Put back). New bot characters are `pending` until approved (rules: bot creates pending only; admins change `status`). Hand-made ones hidden via `settings/characters.hidden`. Admin bell: "New character to approve".
- Bot: ⏳ on new posts, ✅ when approved, 🚫 when denied (`charactersShown` meta). Older bot characters (no status) stay live.
- Character button: couldn't reproduce it failing on v69 (fresh load, redraws, back/forward, phone/laptop/wide all fine). Fixed: on phones the 🏆 Champions tab sat on top of the open character menu; it now hides while the menu is open.
- Tests: site 237 incl. bot 89 pass. Checked locally: approve/deny/remove/put back, court list follows.

### 2026-10-25 · Claude (partner's PC) · pages keep their place · site DEPLOYED (cache v69)
- Checked live on the admin event page: fixture Edit opens in place, back from a result returns to the same spot, live redraws keep the scroll.
- Back links no longer say "(1) …" (the bell's unread count was in the title); checked live.
- `app.js`: `refresh()` after a save now redraws in place (no loading placeholder), keeping the scroll and opened `<details>`; live redraws keep them too. Going back (back link, Esc, browser back, breadcrumbs) returns to where you were on that page (`scrollMemo`, `history.scrollRestoration = 'manual'`). Opening a new page still starts at the top.

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
