# I<3JVO — Just Volleyball Oceania

> **Site name (since 2026-10-21): "I<3JVO"** (was "JVO Hub"). Use it everywhere people see the name. Write it as `I&lt;3JVO` inside HTML. The project folder and package name stay `jvo-hub`.

- **Clear fixtures safeguard (2026-10-24):** the admin must type exact uppercase `CONFIRM` into a warning prompt before any clearing occurs. Cancel, blank and other text leave everything untouched. The warning explains deletion of unresulted fixtures and their score votes, preserved results, schedule unlocking/rebuilding and no undo.

## CURRENT SCOPE (changed 2026-10-21, latest) — read this first

**The site's job: record stats and show fixtures for exhibition nights and tournaments.** No league or seasons.

- **Public pages:** Home, Fixtures (all events, Upcoming / Results), Stats (sortable player table, all events or one), Events (list), event page (fixtures, optional table, top players, teams), match page (box scores), player page (career, by event, match log).
- **Data:** each event (`events/{id}`) holds its own `fixtures`, `results` and `rosters`. `teams` and `players` are shared, so stats add up across events. Event and fixture dates are optional and show **"Date TBD"** / **"Time TBD"**. Drafts (`published: false`) are admin-only, including their fixtures.
- **Cost (changed 2026-10-22):** the project is on **Blaze** (pay as you go, card on file) so images can use Firebase Storage. Everything must stay inside the free allowances. A $5 AUD budget plus the `billingKillSwitch` Cloud Function (`functions/`, Pub/Sub topic `billing-killswitch`) turns billing off if the month's cost reaches the budget (GO-LIVE.md Part 7). Don't add other Cloud Functions unless asked. The domain (ilovejvo.com) is the only intended cost.
- **Images (changed 2026-10-22):** Firebase Storage (`storage.rules`, `public/js/media.js`). Older uploads are on the Cloudflare Worker (KV) under the same paths; `media.js` falls back to the Worker when a Firebase copy is missing, and admins copy them over with "Move images" on `/admin/people`.
- **Admin sign-in:** username + password (Firebase email/password; `username@users.ilovejvo.com`). Admins listed in `/admins/{uid}`. Admins use a second Firebase app (`adminApp`/`adminDb`/`adminAuth`) so they can stay signed in with Discord as a player at the same time; admin pages pass `{ admin: true }` to loaders and `commit`.
- **Player sign-in (added 2026-10-21):** Discord, via a free **Cloudflare Worker** (`worker/`) that swaps the OAuth code for a Firebase custom token (uid `discord:<id>`, claims `discordId`, `discordName`). Signed with a zero-permission Google service account key stored as a Worker secret. Setup: `DISCORD-SETUP.md`. Locally, pretend Discord users sign in with unsigned tokens (Auth emulator only).
- **Players & teams:** players create (id `d<discordId>`) or claim (admin-approved, `/claims/{uid}`) a profile and edit name/number/bio. One team at a time (`players.teamId`). A free agent can register a team (`status: pending` until an admin approves; they become `managerUid`). Managers send `/offers` to free agents with Discord; the player accepts (joining in the same save) or declines; managers release players. Players lodge `/leaveRequests`; admins approve. All enforced in `firestore.rules`; admin inbox at `/admin/requests`.
- **Profiles (added 2026-10-21):** Steam-style team (`/team/:id`) and player pages: page background, banner, logo/picture (GIFs allowed), tagline, bio (≤1000), theme colour, up to 4 showcase stats, social links (Discord/YouTube/Twitch/TikTok/X), a level and badges computed from results (`rules/badges.js`). New optional fields on `teams`/`players`: `logoPath`/`avatarPath`, `bannerPath`, `backgroundPath`, `tagline`, `theme`, `showcase`, `socials`. Images: see **Images** above (Firebase Storage since 2026-10-22). Before that they were stored by the **Cloudflare Worker in Workers KV** (binding `MEDIA`, `worker/src/media.js`), which still serves older uploads as a fallback. Paths `teams/{id}/{logo|banner|background}/…`, `players/{id}/{avatar|banner|background}/…`; limits 2/4/6 MB (GIFs shrunk in the browser first). Old Worker copies: `<worker>/media/<path>`. Local Worker: `npm run worker` (DEV_MODE accepts emulator tokens). Shown immediately; admins remove images/text on `/admin/people`. Teams can add a logo while registering.
- **Desktop game-menu look (≥1024px, added 2026-10-21):** a replica of just volleyball's in-game menu: black top/bottom bars with yellow edges, lowercase nav with a yellow pill, a team box with player slots and round icon buttons (`js/shell.js`), the court screenshot behind everything (`images/art/court-bg.jpg`, made by `scripts/make-art.ps1` from `art-src/ingame-menu.webp`), tilted menu cards on Home (`gameMenu()` in `pages/events.js`), a bottom player bar with level/XP/points, team, next match. Content pages sit on a light "glass" sheet. Phones keep the light layout. `/teams` lists every team. JVO Discord invite: https://discord.gg/PWXtgFVu2Q (`discordInviteUrl` in `config.js`).
- **Two-stage results (2026-10-22, latest):** (1) SCORE: players vote set scores + attach end-of-match screenshots (`players/{id}/shot/…`, max 3); when a home and an away vote agree, the score publishes with `playerStats: {}`, `statsStatus: 'pending'` (firestore.rules `agreedResult`). Players never type stats. (2) STATS: admin result page → "Read stats" runs OCR in the browser (`js/ocr.js`, tesseract.js 5.1.1 from jsDelivr; layout/name matching in `rules/endscreen.js`, tested against `art-src/end-screen-sample.webp`) → review table (assign names, fix numbers) → "Use these stats" → save sets `statsStatus: 'reviewed'` and remembers in-game names as `players.gameNames`. Requests inbox lists "Stats to check". Known limit: the game's right-hand table is cut off at ace/dig on 16:9 screens.
- **Result votes (added 2026-10-22, superseded by the two-stage flow above for stats):** any player on either team votes on a match from its match page: set scores + their own team's stat lines, saved as `events/{e}/submissions/{fixtureId}__{playerId}`. When one home-team vote and one away-team vote have identical set scores, the voter's browser publishes `results/{fixtureId}` (`source: 'votes'`, `confirmedBy: [homeVoteId, awayVoteId]`, stats = both votes' lines combined, MVP suggested) in the same batch; `agreedResult()` in firestore.rules re-checks all of it (map `diff` proves stats weren't altered). Disagreements show in `/admin/requests`; the admin result page lists votes with "Use". Logic in `rules/votes.js` (tested). Me page lists your team's matches to report. Admin "Auto fixtures" buttons (once / home & away) only add missing matchups (`missingGames`).
- **Community characters (2026-10-22):** Home shows community characters taking turns on an empty court (`public/js/characters.js`, pictures in `public/images/characters/` + `list.json`, cut out from `art-src/community/` by `node scripts/cut-characters.mjs`; empty court `images/art/court-empty.jpg` from `art-src/court-empty.png`). Off switch: `cyclingCharacters` in `config.js` (false = old court picture with its baked-in character). To add characters: drop full-body pictures on a plain background into `art-src/community/` and re-run the script (if a screenshot caught bits of the game menu along the top, run `node scripts/crop-top.mjs <file> <px>` first). **Automatic from Discord (bot, `CHARACTERS=1`, 2026-10-25):** every 5 min the bot reads #in-game-characters (`bot/src/characters.js`): new pictures are cut out on the server (`logic/cutout.js`, sharp; refuses wide screenshots/cards, busy or near-black backgrounds), repeats are skipped by a 12×16 fingerprint (`printDiff` < 10), then uploaded to Storage `characters/<key>.png` and listed in Firestore `characters/{key}` (rules: bot creates, bot/admin deletes) with ✅ on the post. A deleted post or a staff ❌ takes it off. Pictures handled by hand (`images/characters/list.json`, `skipped.json`) are left alone; decisions are in store meta `charactersSeen`. `characters.js` on the site loads both lists (list.json with `cache: 'no-cache'`; `/images/**/*.json` is no-cache in firebase.json, other images are cached a week). By hand: **From Discord (2026-10-25):** `node scripts/fetch-characters.mjs` downloads every picture in #in-game-characters (bot token from `bot/.env`) into `art-src/community/`; look at the new ones, move screenshots/cards/repeats/black-background ones into `art-src/community/skipped/` (git-ignored) and list their names in `skipped.txt`, then run `cut-characters.mjs` (reads .webp via sharp, a dev dependency). Characters sway gently (`char-idle`: slow breath + small lean, 3.2 s; off with reduced motion; a hop was too much). Players pick a favourite, or Shuffle, with the "character" button at the bottom right of the Home court or phone banner; it's saved on the device (`jvo.character`).
- **Picture editor (added 2026-10-24):** profile and club pictures are framed rather than cut, so GIFs keep moving.
  - **Saved as:** optional `avatarFrame` / `logoFrame` / `bannerFrame` / `backgroundFrame` = `{ x, y, zoom }`, the point to centre on (0-100 %) and a zoom from 1 to 4. They're checked by `optFrame()` in firestore.rules.
  - **Shown with:** `framedImg()` / `frameStyle()` in `ui.js` on every picture.
  - **Editing:** in `pages/customise.js`, players drag to move, use a zoom slider, press Centre, or press ✕ Remove.
  - **GIF size:** players can pick GIFs up to 30 MB. They're shrunk in the browser before upload (`js/gif-shrink.js`, using gifuct-js + gifenc from jsDelivr) to the size they're shown at (256 / 800 / 960 px), keeping the animation. Every other frame is dropped only if needed. Stored files keep the 2 / 4 / 6 MB limits (storage.rules), so serving stays cheap.
- **Transfer news (added 2026-10-24):** public, append-only `transfers/{id}` `{ playerId, fromTeamId, toTeamId, kind: joined|left|released|founded, at }`, written in the same save as each club move (`js/transfers.js` `transferOp`; invites, join requests, releases, leave approvals, new clubs, admin edits). The rules check a player/manager entry matches the player's club before and after that save. Shown in the bottom ticker's **transfers** tab (`js/reel.js`, tabs results | transfers).
- **Disbanding (added 2026-10-24):** when a club's last player leaves (leave approved, or an admin moves them), `disbandIfEmpty()` in `admin-data.js` marks the team `status: 'disbanded'` (not deleted: results keep its name), clears its manager, removes its sign-ups to upcoming unlocked events, and adds a 'disbanded' transfer news item. Disbanded clubs are hidden from lists and sign-ups; their page stays with a note; their name can be reused. A manager who's the only player can ask to leave (Club hub); otherwise they hand over first.
- **Invites when registering (added 2026-10-24):** the club registration form (Club hub) has an "Invite players" picker of free agents (up to 8). They're saved on the pending team as `invitePlayerIds` (founder can change them while pending). When an admin approves the club, `decideTeam` sends each one still a free agent an offer from the founder (`fromUid` = new manager) in the same save (rules: admin branch on offers create).
- **Added 2026-10-24:**
  - **Staff badges:** `players.staff` = `'admin' | 'mod' | 'caster'` (optional), set by admins in the player form on `/admin/people`. Players can't set it themselves: their own edits are limited to an allowed list of fields in firestore.rules.
    - `staffTag()` in ui.js shows a round icon next to the name everywhere (`playerLink`, squads, search, bottom bar), and the role name on profile pages, chat and comments.
    - Roles and icons are in `STAFF_ROLES`. It's display only: admin powers still come from `/admins`.
  - **LFT:** `players.lft` (bool, set on the Me page). It shows an LFT tag on free agents (`isLft`/`lftTag` in ui.js), and LFT players are listed first in free agents and the invite pickers.
  - **Featured event** (`js/featured.js`): admins pin one with `event.featured`; otherwise it's the soonest upcoming event. It's a full card top right on screens ≥1800px (countdown boxes), and a two-line pill bottom right otherwise (full width on phones). It shows the start in the viewer's own time zone, named (`zoneLabel()` in `rules/events.js`: "AEDT", or the city, "Sydney time", where the browser only knows GMT+11; event dates everywhere use it too), and a countdown ticking every second (`countdownParts()`), then "live now" for 3 hours. "×" folds it into a small ★ tab with the time left (per event, on the device; changed 2026-10-24, it used to hide it for good); pressing the tab opens it again.
  - **Solo sign-ups:**
    - `event.solos` turns them on, saved as `events/{e}/solos/{playerId}`. Rules are in `solosOpen()`, with the same timing as club sign-ups.
    - On the admin Teams tab, the Solo players panel builds mix teams by hand or with Auto-group (teams of `event.teamSize`).
    - Mix teams are `teams` with `mix: true, mixEventId`, and their players go on the event roster, so players' clubs don't change. They're hidden from lists, search and joins, and deleted with their event.
    - Mix team players can't vote on results (votes check `players.teamId`), so admins enter those results.
- **Search:** top bar, players and teams (`js/search.js`), "/" focuses it.
- **Desktop side menu:** the Home menu cards stay down the left on every other page (`js/menu.js`, `setSection()` in `shell.js`).
- **Added 2026-10-22:**
  - **Notifications bell** (`js/notifications.js`), next to the Teams button: invites, join requests and their answers, leave decisions, and matches waiting for your result vote. Worked out from existing records; "seen" is stored on the device only.
  - **Fixtures:** a heading per round (from labels like "Round 3" or "Semi-final", `roundName()` in `pages/parts.js`), plus a team filter (`?team=`) with a "My team" chip.
  - **Teams & players** page (`/teams?view=teams|players|free`).
  - **Fixtures page views (2026-10-24):** List (default) shows one section per event, with a panel per group and the finals listed separately. **🏆 Groups & bracket** (`?layout=bracket`) shows group tables, a **seeding map** (`seedingMap()` in autofix.js: which group place feeds each first-round knockout match, projected or confirmed) and the finals bracket, for each event with groups or a knockout.
  - **Results reel** (`js/reel.js`): latest scores scroll above the bottom bar. Users can hide it for a visit.
  - **FAQ & rules** at `/help`. Admins edit them at `/admin/help`; they're saved in `settings/faq` and `settings/rules`, using a small safe formatter (`rules/markdown.js`). Starter text lives in `js/help-defaults.js`.
  - **Comments** on team and player pages, stored in `teams/{id}/comments` and `players/{id}/comments`:
    - Players with a profile can post, up to 500 characters.
    - One post per 15 seconds, enforced through `commentLimits/{uid}` in the same save.
    - The writer, the page owner and admins can delete.
- **Club sign-ups, self-adjusting fixtures, finals (added 2026-10-23):**
  - **Sign-ups:** managers sign their club up on the event page, saved as `events/{e}/entries/{teamId}`. They can sign up or pull out until 10 minutes before the start, when `event.signups` is on and the event is published and upcoming. An event with no start time stays open until an admin locks it. Enforced by `signupsOpen()` in firestore.rules.
  - **Who's in:** the event's teams are the admin-added `teamIds` plus every club that signed up.
  - **Auto fixtures:** with `event.autoFixtures` set to `once` or `double`, the round robin is worked out live from the entrants and shown as drafts (`virtual: true`, ids `auto-r<round>-<home>-<away>`). At the lock, any admin browser saves them and sets `event.fixturesLockedAt` (`admin-sync.js`; this runs on admin pages and on every page while an admin is signed in). There is no server, so this needs an admin to be online around the start.
  - **Finals:** `event.finals = { type: 'none'|'final'|'semis', semiBestOf, finalBestOf }`. Finals fixtures (`finals-sf1`, `finals-sf2`, `finals-final`, `stage: 'playoffs'`) show placeholders such as "1st place" or "Winner SF1". They're saved once both teams are known, and they don't count in the table.
  - **Group stages (added 2026-10-24):**
    - `event.groups = { count: 1-8, draw: 'auto'|'manual', assign: { teamId: letter } }`. The automatic draw is random but stable (hash of event id + team id), keeps groups even, and works around teams placed by hand on the Teams tab. The full draw is saved into `assign` at the lock.
    - The round robin runs inside each group (ids `auto-g<L>-r…`, label "Group A · Round 1", `fixture.group`). There's a table per group on the event page.
    - **Display (redone 2026-10-24):** the event page has "Group tables" (one table card per group, `groupTablesHtml()`, qualifying places highlighted), "Group fixtures" (one panel per group, `groupFixturesHtml()`), and a big "Finals" section drawn as a bracket (`bracketHtml()`: QF → SF → final, trophy, champion), all in `pages/parts.js`. Group fixtures are ordered group by group (order `gi*10000 + round*100`), and lists use `stageOrder()`. Rule config shows a suggested setup (`suggestSetup()`) with a "Use suggestion" button.
    - Knockout (`finals.type`: none / final / semis / quarters = top 2/4/8): group winners, then runners-up, with "best runner-up" places decided on points. It uses a crossover bracket (A1 v B2), with a swap if two group mates would meet.
  - **Where it lives:** the logic is in `rules/autofix.js` (tested). The rules are set in the "Rule config" section of the event form (Details tab; new events default to round robin + club sign-ups). The Fixtures tab shows the status, "Lock fixtures now" and "Clear fixtures" (deletes fixtures without results and their votes, and unlocks so the schedule rebuilds). Players can't report results on draft fixtures.
  - **Live:** `js/live.js` watches an event's settings, sign-ups, fixtures and results (Firestore listeners) and quietly redraws the event page, the Fixtures page and the admin Fixtures/Teams tabs when they change.
  - **Bell reminders:**
    - new events
    - sign-ups to do (managers)
    - sign-ups closing within 24 hours
    - fixtures set
    - your event starts within 24 hours
- **Match night flow (added 2026-10-24):** events run themselves on the night. The logic is in `rules/flow.js` (tested), worked out the same way in every browser.
  - **Opening:** reporting opens at the start time (or `flow.openAt`, set by "Open matches now"). Per team, a match opens once both teams have confirmed scores for all their earlier matches. Match rows show "● on now" and "up next".
  - **Confirming:** a score is confirmed when a home vote and an away vote agree (as before), or when a captain (club manager) taps "✓ Confirm this score" on the other team's vote. That saves their own matching vote, so no rule change was needed. Stats stay with admins (photo → approve).
  - **Break:** when every group match has a score, the event goes on a break. Finals open `flow.breakMinutes` (default 15) after the last group score, saved as `flow.finalsOpenAt` by an admin browser (`admin-sync.js`), or wait for "Open finals now" if the break is set to "Until an admin opens them".
  - **Stuck matches:** disputed or one-sided for `stuckMinutes` (10), or no votes for `matchMinutes + stuckMinutes` (20 + 10). They go on the admin bell and the admin Fixtures tab.
  - **Settings:** `event.flow = { on, breakMinutes, stuckMinutes, matchMinutes, paused, openAt, finalsOpenAt }`, all optional (missing = defaults, flow on). Set in Rule config → Match night. Pause / Resume / Open matches now / Open finals now are on the admin Fixtures tab. `on: false` = the old way.
  - **Rules:** `votingOpen()` in firestore.rules refuses votes before the start, while paused, and on finals before `finalsOpenAt`. The per-team order is checked by the app only.
  - **Live:** the FEATURED! card becomes a live board while an event runs (stage, on now, just in, break countdown). Home has a "Live now" panel (`pages/live-parts.js`). `watchLiveEvent()` in live.js listens to the live event on every page from 2 hours before the start.
- **Event rules (added 2026-10-24):** every event page has a "📜 Event rules" section (`pages/event-rules.js`), written from that event's own settings: teams & sign-ups, match format, fixtures, knockout, on the night (match flow), results & integrity, table. Change a setting in Rule config and the text follows.
- **Handover / two assistants (2026-10-24):** the owner also works with ChatGPT. `AGENTS.md` (instructions for any assistant), `HANDOVER.md` (full overview), `PROGRESS.md` (shared status board: read at the start, update at the end of every session). Shared repository: https://github.com/changeman11/ilovejvo (`main`): `git pull` before working, `git push` after every commit.
- **Added 2026-10-24 (late):**
  - **Free club moves:** players leave straight away from the Club hub (`leaveClub` in player-data.js; no admin). A lone manager leaving disbands the club (and its open sign-ups). Joining still needs one yes (request accepted / invite accepted). **All moves pause while any event is running**: 10 min before its start until it's finished, its match flow is done, or 12 h (`eventBlockingMoves` in rules/events.js, `checkMovesOpen`). App-checked only (rules can't know an event is on). Old leave requests can still be cancelled; admins can still move anyone.
  - **Ready-up:** `event.flow.readyUp` (off for events made before; on for new ones). Matches wait on their match page (`pages/ready-up.js`) until `readyCount` (default team size) per team press Ready (`events/{e}/ready/{fixtureId}__{playerId}`); admin "Start now" = `fixture.startedAt`. Then reporting + the bot's Discord thread open.
  - **3rd place match:** `finals.thirdPlace` → `finals-3rd` (semi-final losers), under the Grand final with 🥉.
  - **Podiums & trophies** (2026-10-25): `rules/podium.js` (tested) works out 1st/2nd/3rd from results: final winner/loser, 3rd = 3rd place match winner, else the semi-final losers share 3rd; no knockout = top 3 of the finished table. `js/trophy.js`: the latest podium on the right of every page (≥1800px a gold card under FEATURED!; smaller screens a "🏆 Champions" tab that opens it until the page changes; × folds it). Team pages: "🏆 Trophy cabinet" (`trophyCabinet` in profile-parts.js, big gold plaque per title); Teams tab: 🏆/🥈/🥉 icons by the club name (`trophyIcons`).
  - **Stat identities** (2026-10-25): `public/js/rules/stat-style.js` `STAT_STYLE` (readable name, award title, emoji, colours) is shared by the Stats page and the bot's award roles (copied to `bot/src/site-rules/`). The Stats page has award cards (each stat's top 3, tap to sort) and a styled table (emoji headers, 🥇🥈🥉, highlighted sorted column with bars). Gradient + role icon on Discord only on boosted servers.
  - **Home/away balance** (2026-10-25): `roundRobin` (rules/schedule.js) gives home to whoever has hosted less (tie: whoever was away last). Only new fixtures; saved ones don't change.
  - **Thread screenshots** (bot, 2026-10-25): only still, landscape pictures ≥960 px count (`screenshotLike`), so GIFs/memes posted in between are skipped; a GIF copied earlier counts as missing, so the bot looks again. The site's stats reader prefers a still picture over a GIF.
  - **Stats reading by the bot** (2026-10-25, `READ_STATS`, on by default; site `botReadsStats` in config.js turns off the admin-browser background reader): for a thread match with its score in and an unread screenshot, `bot/src/stats-read.js` reads it (Tesseract only for the headings and the name text; digits by template, `rules/glyphs.js` + `bot/src/reader/digits.json`; a digit that isn't clearly one is unsure) and `logic/reading.js` places names (`rules/whois.js`: team side, text vs displayName/gameNames, name pictures `rules/namepics.js`, elimination). Saved as `statsDraft` (`reader: 'bot'`, rows carry `print`, `matchedBy`), then who's who / check your stats as before. Name pictures are learned only from lines people answered or confirmed (`pickupMeta/namePrints`, 6 per player) on top of `reader/name-prints.json` (from past matches). Tested in `scripts/ocr-lab/` (`bot-reader.mjs` runs the bot's reader on all 50 lab screenshots: 0 of 3040 numbers differ from the eye-checked lab reading, names 0 wrong). Re-learn: `exact-reader.mjs` → `templates.json` → `reader/digits.json`; `names2.mjs` → `name-prints.json`.
  - **Publishing stats + fraud checks** (2026-10-25): `/admin/stats` groups waiting matches into ✅ Ready to publish (one "Publish all" button, no ticking), 🚩 Check before publishing ("Publish anyway" per match after a confirm listing the warnings) and ⏳ Waiting. Warnings come from `rules/stat-checks.js` (tested): per-player numbers above the site's own top-1%-per-set ×1.2 (`DEFAULT_PER_SET` until 60 saved lines), a team's PTS over 115%+1 of the points it won, numbers changed by a captain or the player (the bot's `fixLine` keeps `readStats` + `editedAs`; staff edits aren't flagged), lines named in Who's who whose on-screen name doesn't look like the player. Players' confirmations aren't required to publish. The Edit (result) page is unchanged.
  - **3rd place on a finished event:** admin Fixtures tab → "Add 3rd place match" (sets `finals.thirdPlace`, saves `finals-3rd` once both semis are played).
- **Club hub, chat, admins, back button (added 2026-10-23):**
  - **Club hub tabs:** Club (squad, the team chat, next matches, leaving), Manager (managers only: a to-do summary, join requests, event sign-ups, results to report, squad tools to release a player or hand over the club, and invites), and Club page.
  - **Hand-over rule:** a manager can pass the club to another squad member who has a Discord sign-in (`managerUid`/`managerPlayerId` rule branch).
  - **Team chat:** stored in `teams/{id}/chat`, squad and admins only, live (`pages/team-chat.js`). Membership is checked through `playerLinks/{uid}` → `{ playerId }`. The browser writes it, and the rules only accept it if that player's `uid` matches.
  - **Discord admins:** an `/admins/{uid}` doc with `discord: true` makes that Discord sign-in an admin, with no password login needed. `isAdmin()` in both rule files accepts it, and `currentAdmin()` switches admin reads and saves to the player connection (`setDiscordAdmin`, `adminDatabase()`).
  - **Admin mode switch:** Discord admins can turn admin mode off from the Admin page, saved per device as `jvo.adminMode`. Off: `currentAdmin()` returns `{ admin: null, modeOff: true, account }`, so they browse as a player, while the Admin link stays so they can switch it back on. `syncSchedules` uses `currentAdmin({ ignoreMode: true })`, so fixtures still save at the lock.
  - **Admin bell:** an "Admin to-do" section listing clubs to approve, claims, leave requests, stats to check, disputed scores, missing results, and events that need an admin online at the lock.
  - **Back button:** a trail stored in `history.state.trail`. Tab and filter changes don't add steps, revisiting a page cuts the trail, and main-menu pages start fresh. Tabbed menus (`tabbed: true` routes) show "✕ close"; pages you drill into show "← back to …".
- **Chat panel (added 2026-10-23):** a slide-out panel on the right edge of every page with an arrow tab, Clash of Clans style (`js/chat-panel.js`).
  - **Tabs:** Global (`chat/*`, anyone reads; players with a profile post up to 300 characters, one message per 3 seconds via `chatLimits/{uid}`) and Club (the squad's `teams/{id}/chat`, the same chat as the Club hub).
  - **Shared component:** the chat box is `js/chatbox.js`.
  - **Profanity:** handled in `rules/profanity.js` (tested).
    - Slurs are blocked in the browser and by the `noSlurs()` regex in firestore.rules (same pattern; a test keeps them in step). It also applies to club chat and comments.
    - Swearing is allowed but starred out while the reader's filter is on (default on, toggle in the panel, saved on the device).
    - Admins see ⚑ on rude messages, can delete any message, and get a bell to-do when global chat had swearing in the last day.
- **Audit log:** written by the browser in the same batch as each admin change; rules force `by == uid` and make it append-only.
- **Pickup bot (added 2026-10-23):** a Discord bot in `bot/` (its own `package.json`, discord.js 14.27.0). Setup: `BOT-SETUP.md`.
  - **Flow:**
    - Players sign up / withdraw with a dropdown (`custom_id: 'queue'`) on the bot's queue card in `#pickup`; no voice needed to queue (changed 2026-10-23, was a queue voice channel). Sign-ups are kept in memory only. At 4+ signed up, a 30 s countdown runs, then the bot picks a random mode (2v2 to 6v6) from those that fit. The longest-waiting players get in; 12 signed up starts at once.
    - **Ready check (2026-10-23):** the bot makes a locked `🏐 ready up · NvN` voice channel, plus a locked match chat `#ready-up-NvN`.
      - The chat is hidden from everyone but the players, admins and the bot (added 2026-10-24). The ready-check card pings the players there and ticks them off as they join the voice channel.
      - The draft card is posted in the match chat and becomes the game card there (`game.messageChannel`); admin dispute pings go there too (moved from `#pickup` 2026-10-24).
      - At draft end the chat is renamed `#game-N` and stored as `game.channels.chat`. It's deleted when the result is in, and a result summary (`resultView`) is posted in `#pickup`, so `#pickup` keeps the record. Cancel notices always go to `#pickup`.
      - **Locked** means everyone can see it; only those players, `ADMIN_ROLE_IDS` and the bot can connect.
      - Players confirm by joining it within `READY_SECONDS` (60).
      - No-shows are dropped from the sign-up list and replaced from the queue. A new locked channel is made for the new line-up, because editing who can join would need Manage Roles.
      - If there aren't enough replacements, it's cancelled and the confirmed players stay signed up in their old order.
      - Leftover `🏐 ready up · ` channels are cleared when the bot starts.
    - Two random captains; a coin flip decides the first pick, then alternating picks (A B A B) with buttons, 60 s each or the pick is random. Leaving the ready-up channel mid-draft cancels it.
    - The bot makes two locked team voice channels (that team plus admins), moves the players, and deletes the ready-up channel.
    - Both captains press the winner; if they disagree, admins decide (`/pickup result` can also correct a result later).
  - **Mode votes (added 2026-10-24):**
    - **Voting:** signed-up players vote with the queue card's second menu (`custom_id: 'mode'`), or with the site's vote buttons, which set `vote` on their `pickupSignups` doc. The bot copies Discord votes to that doc too.
    - **At the pop:** if the most-voted mode that fits has `MODE_VOTES_NEEDED` (2) votes, it's played (ties are random); otherwise the mode is random. `pickMode()` in `logic/modes.js` (tested).
    - **Admin mode:** admins can fix the mode, for the next game or until reset, with `/pickup setmode` or the admin box on `/pickup`. It's stored in `pickupControl/mode` `{ size, once }` (rules: admin + stamp, or the bot) and also in store meta `fixedMode`. The bot watches it live.
    - **Fixed mode:** the game starts as soon as there are exactly enough for it.
  - **Elo:** start 1000, K = 32, team rating = average, the same change for the whole team.
  - **Welcomes (added 2026-10-24):** new members get a post in `WELCOME_CHANNEL_ID` (#welcome) with an @mention and link buttons to the site's `/me`, `/pickup` and `/help` (`bot/src/welcome.js`, tested).
    - **Intent:** it needs the privileged Server Members intent. `login.js` reads the app's flags before logging in and only asks for the intent when it's switched on; otherwise it logs a warning.
  - **1v1 ranked (added 2026-10-24, `RANKED=1`):** `bot/src/ranked.js` with `ranked-views.js` and `logic/ranked.js`, tested.
    - **Queue:** `#1v1-queue` has a Queue / Leave card, two at a time, resetting for the next pair.
    - **Ready up:** a locked voice channel `1v1 - A VS B (Game X)` plus a ready-up chat; both players must be in the voice channel and press Ready within `RANKED_READY_SECONDS` (300).
    - **Result:** a thread where both players report through a form (winner + required scoreboard file upload). If they disagree, Staff (`STAFF_ROLE_IDS`) decide in the staff-only `#1v1-results`, which gets every result with its screenshots.
    - **RP:** 1000 to start, 5 placements at ±50, then ±20, stored in `rankedRatings`, `rankedGames` and `pickupMeta/ranked`.
    - **Clean-up:** the temporary channels are deleted afterwards.
    - **On the site:** `/pickup` has a 1v1 section (via `rankedSignups` and `pickupMeta/live1v1`), the RP leaderboard, and RP on profiles.
  - **On the site (added 2026-10-24, needs `STORE=firebase`):**
    - **Pages:** `/pickup` (`pages/pickup.js`) has the live queue with Sign up / Withdraw for Discord sign-ins, ready checks, drafts and games on, recent games and the Elo leaderboard. It's in the menu cards, top nav and phone Home.
    - **Elo elsewhere:** shown on player profiles (side "Pickup" block) and the Me page (`pickupBlock()`, `loadPickupRank()` in data.js).
    - **Sign-ups:** `pickupSignups/{discordId}` `{ discordId, name, signedUpAt }`. Public read; a Discord sign-in creates or deletes only their own; the bot (`isPickupBot()`) adds Discord sign-ups and deletes anyone who leaves the queue.
    - **Bot link:** `bot/src/site-queue.js` watches the collection with the Firebase SDK (live listener, no polling) and writes through the bot's REST client.
    - **Live state:** `pickupMeta/live` (`Pickup.liveState()`), re-sent every 5 min as a heartbeat. The site shows "offline" after 12 min without one.
    - **Order:** sign-ups survive bot restarts (re-read from the collection). `SITE_QUEUE=0` turns the link off.
  - **Club roles (added 2026-10-24, `CLUB_ROLES=1`):**
    - **What:** a cosmetic Discord role per approved non-mix club, named after the club, coloured `colors.primary`, and grouped in the member list (`CLUB_ROLES_GROUPED`).
    - **Who:** given to players whose profile `discordId` matches a server member.
    - **Reading the site:** `teams` and `players` are read with no sign-in (`SiteReader`).
      - Every `CLUB_ROLES_MINUTES` (5) it reads only docs with `updatedAt` newer than the last read.
      - A full read runs at start, every 6 hours, and on `/pickup syncroles`.
    - **Remembered roles:** stored as `clubRoles` `{teamId: roleId}` in the store's meta. The bot never touches other roles.
    - **Disbanded clubs:** the role is deleted.
    - **Code:** the plan is in `bot/src/logic/club-roles.js`, the runner in `bot/src/club-roles.js` (both tested).
    - **Permissions:** needs Manage Roles, with the bot's role above the club roles (they're created just under it).
  - **Code:**
    - Pure logic, tested: `bot/src/logic/`.
    - Game manager: `bot/src/pickup.js`. It has no discord.js and is tested with a fake Discord in `bot/tests/pickup.test.mjs`.
    - Root `npm test` runs `bot/tests` too.
  - **Storage:** `STORE=file` (JSON on the PC) or `STORE=firebase`. Firebase writes go over the REST API, signed in as the bot's own email/password account whose uid has a `/pickupBots` doc.
  - **Firestore collections:** `pickupRatings/{discordId}`, `pickupGames/g{n}`, `pickupMeta/bot`. Public read; only the bot writes (`isPickupBot()` in firestore.rules). The site may show Elo later (keyed by Discord ID, like `d<discordId>` players).
  - **Hosting:** Oracle Cloud Always Free VM (Sydney, VM.Standard.E2.1.Micro, systemd service `jvo-bot`; `bot/deploy/`). Oracle sign-up was stuck on 2026-10-24, so AWS EC2 is the stand-in: t3.micro, Ubuntu, Sydney, paid from new-account Free-plan credits. It uses the same scripts (BOT-SETUP.md Part 6 instead). Not Google's free VM: its IPv4 address costs about US$3.65 a month, and Discord has no IPv6.
  - **Secrets:** the token and password live only in `bot/.env` (git-ignored) on the PC and the server.
  - **Live state (2026-10-24):** the AWS bot runs `STORE=firebase`, signed in as `pickup-bot@users.ilovejvo.com` (uid `6gp4j4d8lBRJM4k0rsxnmuNnRpJ3`, listed in `/pickupBots`). The club role map moved into `pickupMeta/bot`. The rules and the `/pickup` page are deployed.
- **Look:** light "beach day" theme in the style of the game *just volleyball* (temkosoft): ball-blue `#1438d8` header, sky background, deep navy `#18204a` outlines (not black), accents sky / teal / coral / purple, yellow `#ffe200` for small highlights only (big yellow + black areas looked like an adult site, per users, 2026-10-21). Teal wins, pink losses, outlined "sticker" panels, Fredoka headings, Graduate (jersey-style) numbers. The official logo is used with the developer's OK (`public/images/game/`, credited and linked to Steam). Avoid generic "AI dashboard" styling.
- The match engine (`public/js/rules/`) is unchanged: Bo3 sets to 10 win by 2, a fixture can be Bo5; forfeit = 2–0, 10–0. The engine's "season" is built from an event by `engineSeason()` in `data.js`.

The league plan below (seasons, playoffs, awards, Discord bot) is **shelved**. Its code is in git history (commits up to "Phase 4 (paused)").

## What we're building (original league plan, shelved)

A community league hub for **Just Volleyball Oceania (JVO)**: one website where players and fans see live standings, fixtures, results, player and team stats, playoffs, awards and history across every season, and where league admins run the whole competition without touching code.

The reference is **ORC Hub** (https://orc-hub.web.app), the hub for the Oceanic Rematch esports league. Match its scope, structure and polish, but rebuild everything for **volleyball**: sets instead of goals, volleyball positions, volleyball stats and volleyball standings rules. Do not copy ORC's branding, text, logos or assets — JVO gets its own identity.

## JVO's format (confirmed 2026-10-21)

- **Type**: a volleyball *video game* league, online and run on Discord. The game has just released (name: _TBC_).
- **Teams**: 4v4 for now; other sizes may come later (`format.teamSize`). **Squads: 4 + 2 subs = 6 max** (decided 2026-10-24; `SQUAD_MAX` in `rules/defaults.js`). The party box at the top has 6 spots; invites, accepting join requests/invites and Request to join stop at 6 (in the app; the rules don't count squads). Admins can still move players freely.
- **Match**: best of 3 sets, **every set first to 10** (deciding set too), deuce on, win by 2, no cap.
- **Table points**: 2–0 win = 3, 2–1 win = 2, 1–2 loss = 1, 0–2 loss = 0.
- **Positions**: none fixed. Players do everything. Keep the `position` field (empty) for later.
- **Player stats** (from the game's end-of-match screen, per player per match): `pts`, `spk`, `blk`, `rec`, `set`, `ast`, `ace`, `dig`. Exact meanings of SET vs AST are _TBC_.
- **Forfeits**: no player stats; the other team gets the win and 3 table points, recorded as a 2–0 with both sets 10–0, so sets and points count (confirmed 2026-10-21). Stored as `forfeit: {teamId}` on the result.
- **Playoffs** (confirmed 2026-10-21): top 4 after the regular season. Semi-finals 1v4 and 2v3 (best of 3), grand final best of 5; every set to 10, win by 2. Higher seed is home. No 3rd-place match. Seeds are locked when an admin creates the bracket; winners advance automatically.
- **Playoff stats count together** with regular-season stats (leaders, awards, records, careers). The league table uses regular-season matches only.
- **Awards are dynamic** (decided 2026-10-21, replaces the "suggest + one-click accept" admin step below): one prize per stat leaderboard; whoever is #1 right now holds it (ties = joint holders). When a season is finished, the final holder is the winner. Champions (final winner) and minor premiers (1st on the table) are automatic too.
- **Admin sign-in** (original plan, superseded): see "Admin sign-in" and "Discord admins" in CURRENT SCOPE (username + password, or a Discord sign-in through the Cloudflare Worker whose `/admins` doc has `discord: true`). There are no Cloud Functions except the billing kill switch.
- **Still to fill in**: game name, brand colours and logo (placeholders: yellow `#ffc533` on navy `#0a0e17`), Discord invite, YouTube/Twitch links, playoff format.

## Tech stack

Follow ORC Hub's proven setup unless there's a strong reason not to:

- **Firebase**: Hosting (`*.web.app`), Firestore for data, Auth for sign-in, Cloud Functions for anything server-side (audit log, Discord bot actions, scheduled jobs).
- **Front end**: a fast single-page app that works well on phones first. Installable as a PWA (manifest, icons, theme colour, offline shell).
- **Discord integration**: Discord OAuth for admin and player sign-in; webhooks for auto-posting; a bot for threads, role sync and buttons.
- Keep dependencies light. Prefer plain, readable code over clever abstractions.

## Data model (Firestore)

Everything is scoped by season, while teams and players carry across seasons by stable ID.

- `seasons/{seasonId}` — name, status (upcoming / live / finished / locked), kickoff date, divisions, scoring rules, playoff format
- `teams/{teamId}` — name, short name, colours, logo, Discord role ID
- `players/{playerId}` — display name, Discord ID (if claimed), position, avatar, active flag
- `seasons/{id}/rosters/{teamId}` — players on that team that season (source of truth for who played where)
- `seasons/{id}/fixtures/{fixtureId}` — round, home, away, scheduled time, stream info, status
- `seasons/{id}/results/{fixtureId}` — set-by-set scores, per-player stat lines per set or per match, MVP, VOD link, screenshot evidence
- `seasons/{id}/transfers`, `seasons/{id}/awards`, `seasons/{id}/playoffs`
- `cups/{cupId}` — standalone tournaments with their own brackets
- `settings`, `analytics/{date}`, `clientErrors`, `auditLog` (server-written only, append-only)

## Volleyball rules to build in (make these configurable per season)

- **Match**: JVO default is Bo3, all sets to 10, win by 2 (see "JVO's format"). Best-of, set target, deciding-set target, win-by and an optional cap are all configurable per season (`seasons/{id}.format`).
- **Standings points**: stored per season as `standings.matchPoints`, a map from "setsWon-setsLost" to points. JVO default `{2-0: 3, 2-1: 2, 1-2: 1, 0-2: 0}`. A "win = 1" preset exists.
- **Table columns**: P, W, L, Pts, Sets W–L, Set ratio, Points W–L, Point ratio, Form (last 5).
- **Tiebreakers** (in order, configurable): points → wins → set ratio → point ratio → head-to-head.
- **Positions**: none fixed for JVO (see above). The field exists for later.
- **Player stats**: the list is configurable per season (`seasons/{id}.stats`). JVO uses the game's own stats: PTS, SPK, BLK, REC, SET, AST, ACE, DIG. Show totals, per-set and per-match rates. Stats the game doesn't report (hitting %, errors) are not tracked.
- **Team stats**: same, aggregated, plus sets won/lost and points for/against.

## Public site — pages and features

1. **Home** — season pulse (games played, total points, sets), "Your next match" for claimed players, latest results, next fixtures, mini standings, league leaders, playoff bracket preview, media/streams strip.
2. **Table** — full standings with qualification bands (champions, finals spots, byes), position tracker over rounds, power rankings, games in hand, a "predict the rest of the season" tool, and **Copy/Download as PNG** for sharing on Discord.
3. **Statistics** — overview, players, teams, everyone (sortable full table), head-to-head comparisons, round-by-round race charts, record watch, per-set/per-match scaled stats, advanced metrics.
4. **Fixtures & Results** — full schedule by round, set-by-set scores, match pages with box scores, MVP, VOD and screenshots.
5. **Playoffs** — bracket view, auto-advancing winners.
6. **Cups** — every cup/tournament with its archive (Super Cup, shield, all-star, etc. as JVO decides).
7. **Awards & Records** — every trophy, milestone and record across all seasons, auto-computed from match data.
8. **Streams** — Twitch/YouTube channels for casters and players; stream schedule.
9. **Player and team profiles** — career stats across seasons, clubs played for, trophies, form.
10. **Claim your player** — players sign in with Discord, claim their existing profile or create a new one (joins as free agent), and get a personal dashboard.
11. **Season Wrapped** — story-style recap slides for each player after the finals.
12. Global search (`/` shortcut), and a footer with Discord and social links.

## Admin panel (Discord sign-in, authorised accounts only)

- **Needs you** — inbox of anything waiting on an admin (missing results, pending transfers, team requests, flagged results).
- **Match day** — add result (set-by-set entry, only showing the deciding sets when needed, home/away swap), fixtures, all results with "something to check" flags.
- **Schedule generator** — single or double round-robin over the season's confirmed teams, byes for odd counts, divisions sharing round numbers, and "top up" to add fixtures for late-joining teams without wiping the schedule.
- **League** — teams, players, positions, player ↔ Discord links, rosters per season (with copy-from-season), mid-season transfers.
- **Season** — current season, show a finished season on the home page while the next is prepared, divisions, season launch wizard (step by step), lock/rename seasons.
- **Playoffs** (create bracket from final standings, set dates), **Transfers and team requests**. Awards need no admin step for JVO: they're live stat leaderboards (see "JVO's format").
- **Rules** — edit the rulebook in Markdown, save it to the hub, and publish to a Discord channel by editing existing messages in place (split under Discord's 2000-character limit).
- **Integrations** — Discord server and role sync, match-report threads (one per match, released per matchweek, pinging both teams, renamed COMPLETED with the score once the result is in), result auto-posts via webhook, stream schedule board with a streamer claim button, stream channel list.
- **Insights** — visitor analytics (unique visitors per day), client error log, audit log (server-recorded: who changed what, uneditable).
- **Data & maintenance** — export all data to JSON, import, cloud restore points ("restore missing records" never overwrites live data), merge duplicate teams/players.

## Design

- Dark theme by default, bold sporty feel, mobile-first; JVO's own colours and logo (fill in above).
- Clear hierarchy: big section labels, compact data tables, team colours used as accents.
- Fast: skeleton loading states, no layout jump, tables usable on a phone (sticky first column, horizontal scroll inside the table only).
- Share-ready: Open Graph image and description so links look good in Discord.

## How to work in this project

- Build in phases and keep the site working at every step:
  1. Data model, Firebase setup, seed data for one sample season
  2. Public read-only pages: Home, Table, Fixtures, Results, profiles
  3. Admin sign-in and result entry; standings and stats computed from results
  4. Statistics, playoffs, awards, records
  5. Discord integrations, claim-your-player, streams
  6. Cups, Wrapped, analytics, backups and polish
- Compute standings, stats, records and awards **from results**, never store them by hand.
- Before changing the data model, explain the change and how existing data migrates.
- Security rules: the public can read league data; only authorised admins can write; audit log is written by the server only.
- Never commit secrets (webhook URLs, bot tokens, service account keys). Keep them in Firebase config / environment, not in the repo.
- When something is ambiguous about volleyball rules or JVO's format, ask rather than guess.
