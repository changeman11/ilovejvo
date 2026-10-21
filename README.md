# I<3JVO

League hub for Just Volleyball Oceania. The full spec is in [CLAUDE.md](CLAUDE.md).

## Run it on your computer

You need Node.js 20+, Java 21+ and the Firebase CLI (`npm install -g firebase-tools`).
The first time, install the server code's packages: `cd functions` then `npm install`.

1. Start the local Firebase emulators (leave this running):
   ```
   npm run dev
   ```
2. In a second terminal, load the sample data (re-run any time to reset it):
   ```
   npm run seed
   ```
3. Open http://127.0.0.1:5000 for the site and http://127.0.0.1:4000 for the emulator dashboard, where you can browse the data.
4. For the admin panel, open http://127.0.0.1:5000/admin and click **Sign in as test admin**. That button only exists on your own computer.

Run the rules tests with `npm test`.

Everything runs against a `demo-jvo-hub` project that only exists on your computer. Nothing touches a live Firebase project yet.

## Admin sign-in with Discord

Admins sign in with Discord. Firebase doesn't support Discord directly, so a Cloud Function (`functions/index.js`) swaps Discord's one-time code for a Firebase sign-in. Admin accounts get the ID `discord:<Discord user ID>`.

### 1. Create the Discord app (once)

1. Go to https://discord.com/developers/applications and click **New Application** (name it I<3JVO).
2. Open **OAuth2**:
   - Copy the **Client ID**. Paste it into `public/js/config.js` (`discordClientId`) **and** `functions/.env` (`DISCORD_CLIENT_ID=`). It isn't secret.
   - Click **Reset Secret** and copy the **Client Secret**. This one *is* secret: never paste it into code, chat or git.
   - Under **Redirects**, add `http://127.0.0.1:5000/auth/discord` (local). Later, also add your live address, e.g. `https://<project>.web.app/auth/discord`.

### 2. Store the secret

- **On your computer:** open `functions/.secret.local` (already ignored by git) and put the secret after `DISCORD_CLIENT_SECRET=`. Restart `npm run dev`.
- **On the live site:** run `firebase functions:secrets:set DISCORD_CLIENT_SECRET` and paste it when asked. It's stored in Google Secret Manager.

### 3. Add admins

Admins are documents in the `admins` collection, added from the Firebase console only (the website can't add them):

1. Sign in on the site once. If you're not an admin yet, the page shows your ID, like `discord:123456789012345678`.
2. Firebase console → Firestore → `admins` → **Add document**. Document ID = that ID. Add a field `name` (string) with the admin's name.

### Going live (later)

- Create the Firebase project with Firestore in **australia-southeast1 (Sydney)**, to match the functions' region.
- Cloud Functions need the **Blaze (pay-as-you-go)** plan. A league this size should stay inside the free allowance; set a budget alert in Google Cloud to be safe.
- The functions' service account needs the **Service Account Token Creator** role so it can create sign-in tokens (Google Cloud console → IAM).

## Where things live

| Path | What it is |
| --- | --- |
| `public/` | The website (plain JavaScript, no build step) |
| `public/js/rules/` | Volleyball rules: set checks, standings, stats, fixture generator, result-entry helpers. No Firebase code, so it's easy to test |
| `public/js/pages/` | One file per page. `pages/admin/` is the admin panel |
| `public/js/auth.js` | Sign-in (Discord, plus the local test admin) |
| `public/js/admin-data.js` | Admin saves and deletes |
| `public/css/app.css` | All styles. Brand colours are at the top |
| `functions/` | Server code: Discord sign-in and the audit log |
| `firestore.rules` | Who can read and write what |
| `seed/` | Sample data generator (made-up teams and players) |
| `tests/` | Automatic tests for the rules |
| `tools/make-icons.mjs` | Draws the placeholder app icons |

## Data layout (Firestore)

- `settings/site`: league name, current season, season shown on the home page
- `teams/{teamId}`, `players/{playerId}`: carry across seasons
- `seasons/{seasonId}`: name, status, kickoff, divisions (with team IDs), `format`, `standings`, `stats`, `bands`
  - `rosters/{teamId}`: `playerIds`, `captainId`
  - `fixtures/{fixtureId}`: `round`, `division`, `homeTeamId`, `awayTeamId`, `scheduledAt`, `status`, `stream`, `updatedBy`, `updatedAt`
  - `results/{fixtureId}`: `sets: [{home, away}]`, `playerStats: {playerId: {teamId, pts, spk, ...}}`, `mvpPlayerId`, `vodUrl`, `screenshots`, `forfeit: {teamId} | null`, `enteredBy`, `enteredAt`, `updatedBy`, `updatedAt`
- `admins/{uid}`: who can write (`name`). Added from the Firebase console only
- `auditLog/{id}`: every change inside a season: `at`, `action`, `by`, `path`, `before`, `after`. Written by the server only; admins can read it
- `analytics`: written by the server only

Every admin save must include `updatedBy` (the admin's ID) and `updatedAt` (server time); the security rules reject saves without them.

Standings, stats, records and awards are always calculated from results, never stored.

Note: re-seeding the sample data also fills the audit log with entries marked `by: null`, because the seed script writes directly. That only happens on your computer.
