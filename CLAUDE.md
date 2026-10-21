# I<3JVO — Just Volleyball Oceania

> **Site name (since 2026-10-21): "I<3JVO"** (was "JVO Hub"). Use it everywhere people see the name. Write it as `I&lt;3JVO` inside HTML. The project folder and package name stay `jvo-hub`.

## What we're building

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
