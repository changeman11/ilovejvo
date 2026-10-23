# I<3JVO — Just Volleyball Oceania

> **Site name (since 2026-10-21): "I<3JVO"** (was "JVO Hub"). Use it everywhere people see the name. Write it as `I&lt;3JVO` inside HTML. The project folder and package name stay `jvo-hub`.

## CURRENT SCOPE (changed 2026-10-21, latest) — read this first

**The site's job: record stats and show fixtures for exhibition nights and tournaments.** No league or seasons.

- **Public pages:** Home, Fixtures (all events, Upcoming / Results), Stats (sortable player table, all events or one), Events (list), event page (fixtures, optional table, top players, teams), match page (box scores), player page (career, by event, match log).
- **Data:** each event (`events/{id}`) holds its own `fixtures`, `results` and `rosters`. `teams` and `players` are shared, so stats add up across events. Event and fixture dates are optional and show **"Date TBD"** / **"Time TBD"**. Drafts (`published: false`) are admin-only, including their fixtures.
- **Cost (changed 2026-10-22):** the project is on **Blaze** (pay as you go, card on file) so images can use Firebase Storage. Everything must stay inside the free allowances. A $5 AUD budget plus the `billingKillSwitch` Cloud Function (`functions/`, Pub/Sub topic `billing-killswitch`) turns billing off if the month's cost reaches the budget (GO-LIVE.md Part 7). Don't add other Cloud Functions unless asked. The domain (ilovejvo.com) is the only intended cost.
- **Images (changed 2026-10-22):** Firebase Storage (`storage.rules`, `public/js/media.js`). Older uploads are on the Cloudflare Worker (KV) under the same paths; `media.js` falls back to the Worker when a Firebase copy is missing, and admins copy them over with "Move images" on `/admin/people`.
- **Admin sign-in:** username + password (Firebase email/password; `username@users.ilovejvo.com`). Admins listed in `/admins/{uid}`. Admins use a second Firebase app (`adminApp`/`adminDb`/`adminAuth`) so they can stay signed in with Discord as a player at the same time; admin pages pass `{ admin: true }` to loaders and `commit`.
- **Player sign-in (added 2026-10-21):** Discord, via a free **Cloudflare Worker** (`worker/`) that swaps the OAuth code for a Firebase custom token (uid `discord:<id>`, claims `discordId`, `discordName`). Signed with a zero-permission Google service account key stored as a Worker secret. Setup: `DISCORD-SETUP.md`. Locally, pretend Discord users sign in with unsigned tokens (Auth emulator only).
- **Players & teams:** players create (id `d<discordId>`) or claim (admin-approved, `/claims/{uid}`) a profile and edit name/number/bio. One team at a time (`players.teamId`). A free agent can register a team (`status: pending` until an admin approves; they become `managerUid`). Managers send `/offers` to free agents with Discord; the player accepts (joining in the same save) or declines; managers release players. Players lodge `/leaveRequests`; admins approve. All enforced in `firestore.rules`; admin inbox at `/admin/requests`.
- **Profiles (added 2026-10-21):** Steam-style team (`/team/:id`) and player pages: page background, banner, logo/picture (GIFs allowed), tagline, bio (≤1000), theme colour, up to 4 showcase stats, social links (Discord/YouTube/Twitch/TikTok/X), a level and badges computed from results (`rules/badges.js`). New optional fields on `teams`/`players`: `logoPath`/`avatarPath`, `bannerPath`, `backgroundPath`, `tagline`, `theme`, `showcase`, `socials`. Images are stored by the **Cloudflare Worker in Workers KV** (binding `MEDIA`, `worker/src/media.js`; free, no card. Firebase Storage was dropped because it needs the Blaze plan and the user's card wouldn't verify). Paths `teams/{id}/{logo|banner|background}/…`, `players/{id}/{avatar|banner|background}/…`, served at `<worker>/media/<path>`; limits 2/4/6 MB; the Worker verifies the Firebase ID token and ownership via Firestore REST with the user's own token. Local: `npm run worker` (DEV_MODE accepts emulator tokens). Shown immediately; admins remove images/text on `/admin/people`. Teams can add a logo while registering.
- **Desktop game-menu look (≥1024px, added 2026-10-21):** a replica of just volleyball's in-game menu: black top/bottom bars with yellow edges, lowercase nav with a yellow pill, a team box with player slots and round icon buttons (`js/shell.js`), the court screenshot behind everything (`images/art/court-bg.jpg`, made by `scripts/make-art.ps1` from `art-src/ingame-menu.webp`), tilted menu cards on Home (`gameMenu()` in `pages/events.js`), a bottom player bar with level/XP/points, team, next match. Content pages sit on a light "glass" sheet. Phones keep the light layout. `/teams` lists every team. JVO Discord invite: https://discord.gg/PWXtgFVu2Q (`discordInviteUrl` in `config.js`).
- **Two-stage results (2026-10-22, latest):** (1) SCORE: players vote set scores + attach end-of-match screenshots (`players/{id}/shot/…`, max 3); when a home and an away vote agree, the score publishes with `playerStats: {}`, `statsStatus: 'pending'` (firestore.rules `agreedResult`). Players never type stats. (2) STATS: admin result page → "Read stats" runs OCR in the browser (`js/ocr.js`, tesseract.js 5.1.1 from jsDelivr; layout/name matching in `rules/endscreen.js`, tested against `art-src/end-screen-sample.webp`) → review table (assign names, fix numbers) → "Use these stats" → save sets `statsStatus: 'reviewed'` and remembers in-game names as `players.gameNames`. Requests inbox lists "Stats to check". Known limit: the game's right-hand table is cut off at ace/dig on 16:9 screens.
- **Result votes (added 2026-10-22, superseded by the two-stage flow above for stats):** any player on either team votes on a match from its match page: set scores + their own team's stat lines, saved as `events/{e}/submissions/{fixtureId}__{playerId}`. When one home-team vote and one away-team vote have identical set scores, the voter's browser publishes `results/{fixtureId}` (`source: 'votes'`, `confirmedBy: [homeVoteId, awayVoteId]`, stats = both votes' lines combined, MVP suggested) in the same batch; `agreedResult()` in firestore.rules re-checks all of it (map `diff` proves stats weren't altered). Disagreements show in `/admin/requests`; the admin result page lists votes with "Use". Logic in `rules/votes.js` (tested). Me page lists your team's matches to report. Admin "Auto fixtures" buttons (once / home & away) only add missing matchups (`missingGames`).
- **Community characters (2026-10-22):** Home shows community characters taking turns on an empty court (`public/js/characters.js`, pictures in `public/images/characters/` + `list.json`, cut out from `art-src/community/` by `node scripts/cut-characters.mjs`; empty court `images/art/court-empty.jpg` from `art-src/court-empty.png`). Off switch: `cyclingCharacters` in `config.js` (false = old court picture with its baked-in character). To add characters: drop full-body pictures on a plain background into `art-src/community/` and re-run the script (if a screenshot caught bits of the game menu along the top, run `node scripts/crop-top.mjs <file> <px>` first). Players pick a favourite, or Shuffle, with the "character" button at the bottom right of the Home court or phone banner; it's saved on the device (`jvo.character`).
- **Picture editor (added 2026-10-24):** profile and club pictures are framed rather than cut, so GIFs keep moving.
  - **Saved as:** optional `avatarFrame` / `logoFrame` / `bannerFrame` / `backgroundFrame` = `{ x, y, zoom }`, the point to centre on (0-100 %) and a zoom from 1 to 4. They're checked by `optFrame()` in firestore.rules.
  - **Shown with:** `framedImg()` / `frameStyle()` in `ui.js` on every picture.
  - **Editing:** in `pages/customise.js`, players drag to move, use a zoom slider, press Centre, or press ✕ Remove.
  - **GIF size:** players can pick GIFs up to 30 MB. They're shrunk in the browser before upload (`js/gif-shrink.js`, using gifuct-js + gifenc from jsDelivr) to the size they're shown at (256 / 800 / 960 px), keeping the animation. Every other frame is dropped only if needed. Stored files keep the 2 / 4 / 6 MB limits (storage.rules), so serving stays cheap.
- **Transfer news (added 2026-10-24):** public, append-only `transfers/{id}` `{ playerId, fromTeamId, toTeamId, kind: joined|left|released|founded, at }`, written in the same save as each club move (`js/transfers.js` `transferOp`; invites, join requests, releases, leave approvals, new clubs, admin edits). The rules check a player/manager entry matches the player's club before and after that save. Shown in the bottom ticker's **transfers** tab (`js/reel.js`, tabs results | transfers).
- **Search:** top bar, players and teams (`js/search.js`), "/" focuses it.
- **Desktop side menu:** the Home menu cards stay down the left on every other page (`js/menu.js`, `setSection()` in `shell.js`).
- **Added 2026-10-22:**
  - **Notifications bell** (`js/notifications.js`), next to the Teams button: invites, join requests and their answers, leave decisions, and matches waiting for your result vote. Worked out from existing records; "seen" is stored on the device only.
  - **Fixtures:** a heading per round (from labels like "Round 3" or "Semi-final", `roundName()` in `pages/parts.js`), plus a team filter (`?team=`) with a "My team" chip.
  - **Teams & players** page (`/teams?view=teams|players|free`).
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
    - Knockout (`finals.type`: none / final / semis / quarters = top 2/4/8): group winners, then runners-up, with "best runner-up" places decided on points. It uses a crossover bracket (A1 v B2), with a swap if two group mates would meet.
  - **Where it lives:** the logic is in `rules/autofix.js` (tested). The rules are set in the "Rule config" section of the event form (Details tab; new events default to round robin + club sign-ups). The Fixtures tab shows the status, "Lock fixtures now" and "Clear fixtures" (deletes fixtures without results and their votes, and unlocks so the schedule rebuilds). Players can't report results on draft fixtures.
  - **Live:** `js/live.js` watches an event's settings, sign-ups, fixtures and results (Firestore listeners) and quietly redraws the event page, the Fixtures page and the admin Fixtures/Teams tabs when they change.
  - **Bell reminders:**
    - new events
    - sign-ups to do (managers)
    - sign-ups closing within 24 hours
    - fixtures set
    - your event starts within 24 hours
- **Club hub, chat, admins, back button (added 2026-10-23):**
  - **Club hub tabs:** Club (squad, the team chat, next matches, leaving), Manager (managers only: a to-do summary, join requests, event sign-ups, results to report, squad tools to release a player or hand over the club, and invites), and Club page.
  - **Hand-over rule:** a manager can pass the club to another squad member who has a Discord sign-in (`managerUid`/`managerPlayerId` rule branch).
  - **Team chat:** stored in `teams/{id}/chat`, squad and admins only, live (`pages/team-chat.js`). Membership is checked through `playerLinks/{uid}` → `{ playerId }`. The browser writes it, and the rules only accept it if that player's `uid` matches.
  - **Discord admins:** an `/admins/{uid}` doc with `discord: true` makes that Discord sign-in an admin, with no password login needed. `isAdmin()` in both rule files accepts it, and `currentAdmin()` switches admin reads and saves to the player connection (`setDiscordAdmin`, `adminDatabase()`).
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
- **Look:** light "beach day" theme in the style of the game *just volleyball* (temkosoft): ball-blue `#1438d8` header, sky background, deep navy `#18204a` outlines (not black), accents sky / teal / coral / purple, yellow `#ffe200` for small highlights only (big yellow + black areas looked like an adult site, per users, 2026-10-21). Teal wins, pink losses, outlined "sticker" panels, Fredoka headings, Graduate (jersey-style) numbers. The official logo is used with the developer's OK (`public/images/game/`, credited and linked to Steam). Avoid generic "AI dashboard" styling.
- The match engine (`public/js/rules/`) is unchanged: Bo3 sets to 10 win by 2, a fixture can be Bo5; forfeit = 2–0, 10–0. The engine's "season" is built from an event by `engineSeason()` in `data.js`.

The league plan below (seasons, playoffs, awards, Discord bot) is **shelved**. Its code is in git history (commits up to "Phase 4 (paused)").

## What we're building (original league plan, shelved)

A community league hub for **Just Volleyball Oceania (JVO)**: one website where players and fans see live standings, fixtures, results, player and team stats, playoffs, awards and history across every season, and where league admins run the whole competition without touching code.

The reference is **ORC Hub** (https://orc-hub.web.app), the hub for the Oceanic Rematch esports league. Match its scope, structure and polish, but rebuild everything for **volleyball**: sets instead of goals, volleyball positions, volleyball stats and volleyball standings rules. Do not copy ORC's branding, text, logos or assets — JVO gets its own identity.

## JVO's format (confirmed 2026-10-21)

- **Type**: a volleyball *video game* league, online and run on Discord. The game has just released (name: _TBC_).
- **Teams**: 4v4 for now; other sizes may come later (`format.teamSize`).
- **Match**: best of 3 sets, **every set first to 10** (deciding set too), deuce on, win by 2, no cap.
- **Table points**: 2–0 win = 3, 2–1 win = 2, 1–2 loss = 1, 0–2 loss = 0.
- **Positions**: none fixed. Players do everything. Keep the `position` field (empty) for later.
- **Player stats** (from the game's end-of-match screen, per player per match): `pts`, `spk`, `blk`, `rec`, `set`, `ast`, `ace`, `dig`. Exact meanings of SET vs AST are _TBC_.
- **Forfeits**: no player stats; the other team gets the win and 3 table points, recorded as a 2–0 with both sets 10–0, so sets and points count (confirmed 2026-10-21). Stored as `forfeit: {teamId}` on the result.
- **Playoffs** (confirmed 2026-10-21): top 4 after the regular season. Semi-finals 1v4 and 2v3 (best of 3), grand final best of 5; every set to 10, win by 2. Higher seed is home. No 3rd-place match. Seeds are locked when an admin creates the bracket; winners advance automatically.
- **Playoff stats count together** with regular-season stats (leaders, awards, records, careers). The league table uses regular-season matches only.
- **Awards are dynamic** (decided 2026-10-21, replaces the "suggest + one-click accept" admin step below): one prize per stat leaderboard; whoever is #1 right now holds it (ties = joint holders). When a season is finished, the final holder is the winner. Champions (final winner) and minor premiers (1st on the table) are automatic too.
- **Admin sign-in**: Discord via a Cloud Function custom token (uid `discord:<id>`); admins listed in `/admins`. Functions region `australia-southeast1`.
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
