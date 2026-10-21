# I<3JVO

Fixtures, results and player stats for Just Volleyball Oceania: the community around
[just volleyball](https://store.steampowered.com/app/5037200/) by temkosoft. Logo used with the developer's OK.

- **Public:** Home, Fixtures, Stats, Events, plus event, match and player pages.
- **Players (`/me`):** sign in with Discord, create or claim a profile, register a team (admin approves), accept or decline signing offers, ask to leave a team. Managers run their squad at `/manage`.
- **Admin (`/admin`):** events (exhibition nights and tournaments), teams and players, rosters, fixtures, results with player stats, and a Requests inbox (new teams, leave requests, profile claims).
- Discord sign-in runs on a free Cloudflare Worker (`worker/`); see [DISCORD-SETUP.md](DISCORD-SETUP.md). Locally, the Me page offers pretend Discord users.
- Runs entirely on Firebase's **free plan** (Hosting, Firestore, Auth). See [GO-LIVE.md](GO-LIVE.md).

## Run it on your computer

You need Node.js 20+, Java 21+ and the Firebase CLI (`npm install -g firebase-tools`).

1. Start the local emulators (leave running): `npm run dev`
2. In a second terminal, load sample data and a test admin: `npm run seed`
3. Open http://127.0.0.1:5000. The emulator dashboard is at http://127.0.0.1:4000.
4. Admin: http://127.0.0.1:5000/admin, username `admin`. The password is in `seed/seed.mjs` (local emulator only).

Tests: `npm test`. Deploy (after GO-LIVE parts 1–3): `npm run deploy`.

## How it fits together

| Path | What it is |
| --- | --- |
| `public/` | The website (plain JavaScript, no build step) |
| `public/css/app.css` | All styles. Colours at the top, in the game's style (yellow, ball blue, black outlines) |
| `public/js/pages/` | One file per page; `pages/admin/` is the admin area |
| `public/js/rules/` | Volleyball maths: set checks, standings, stats, records. No Firebase code; tested in `tests/` |
| `public/js/data.js` / `admin-data.js` | Reading data / admin saves (each save also writes an audit entry) |
| `public/images/game/` | Official just volleyball logo (temkosoft) |
| `firestore.rules` | Who can read and write what |
| `seed/` | Sample data for local testing |

## Data (Firestore)

- `events/{id}`: `type` (exhibition/tournament), `title`, `summary`, `details`, `date` (null = TBD), `timeTbd`, `status`, `published`, `teamIds`, `teamSize`, `matchFormat.bestOf`, `showTable`, `formatNote`, `prize`, `signupUrl`, `streamUrl`
  - `fixtures/{id}`: `label`, `order`, `homeTeamId`, `awayTeamId`, `scheduledAt` (null = TBD), `timeTbd`, `bestOf` (optional override), `status`
  - `results/{fixtureId}`: `sets [{home, away}]`, `playerStats {playerId: {teamId, pts, spk, blk, rec, set, ast, ace, dig}}`, `mvpPlayerId`, `forfeit`, `vodUrl`, `screenshots`
  - `rosters/{teamId}`: `playerIds`
- `teams/{id}`: `name`, `shortName`, `colors.primary`
- `players/{id}`: `displayName`, `number`, `active`
- `admins/{uid}`: who can write (`name`). Added in the Firebase console only.
- `auditLog/{id}`: every admin change (`at`, `by`, `action`, `path`, `before`, `after`). Append-only.

Every admin save carries `updatedBy` + `updatedAt` (server time); the rules reject saves without them.
Stats, tables and leaderboards are always calculated from results, never stored.

Match rules: every set to 10, win by 2; matches best of 3 (or 5 where set); forfeit = 2–0 with sets 10–0.
