# I<3JVO

League hub for Just Volleyball Oceania. The full spec is in [CLAUDE.md](CLAUDE.md).

## Run it on your computer

You need Node.js 20+, Java 21+ and the Firebase CLI (`npm install -g firebase-tools`).

1. Start the local Firebase emulators (leave this running):
   ```
   npm run dev
   ```
2. In a second terminal, load the sample season (re-run any time to reset the data):
   ```
   npm run seed
   ```
3. Open http://127.0.0.1:5000 for the site and http://127.0.0.1:4000 for the emulator dashboard, where you can browse the data.

Run the rules tests with `npm test`.

Everything runs against a `demo-jvo-hub` project that only exists on your computer. Nothing touches a live Firebase project yet.

## Where things live

| Path | What it is |
| --- | --- |
| `public/` | The website (plain JavaScript, no build step) |
| `public/js/rules/` | Volleyball rules: set checks, standings, fixture generator. No Firebase code, so it's easy to test |
| `public/js/pages/` | One file per page |
| `public/css/app.css` | All styles. Brand colours are at the top |
| `firestore.rules` | Who can read and write what |
| `seed/` | Sample season generator (made-up teams and players) |
| `tests/` | Automatic tests for the rules |
| `tools/make-icons.mjs` | Draws the placeholder app icons |

## Data layout (Firestore)

- `settings/site`: league name, current season, season shown on the home page
- `teams/{teamId}`, `players/{playerId}`: carry across seasons
- `seasons/{seasonId}`: name, status, kickoff, divisions (with team IDs), `format`, `standings`, `stats`, `bands`
  - `rosters/{teamId}`: `playerIds`, `captainId`
  - `fixtures/{fixtureId}`: `round`, `division`, `homeTeamId`, `awayTeamId`, `scheduledAt`, `status`, `stream`
  - `results/{fixtureId}`: `sets: [{home, away}]`, `playerStats: {playerId: {teamId, pts, spk, ...}}`, `mvpPlayerId`, `vodUrl`, `screenshots`
- `admins/{uid}`: who can write. Added from the Firebase console only
- `auditLog`, `analytics`: written by the server only

Standings, stats, records and awards are always calculated from results, never stored.
