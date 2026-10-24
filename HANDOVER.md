# I<3JVO: project handover

For anyone (person or AI assistant) picking up this project. Read this, then **`CLAUDE.md`** (the detailed rulebook and feature log), then **`PROGRESS.md`** (what's happening right now).

**Live site:** https://i-love-jvo.web.app · **Folder/package name:** `jvo-hub` · **Written:** 2026-10-24

---

## 0. Working with two assistants (Claude and ChatGPT)

The rule that keeps both in sync: **one copy of the project, one history, one status file.**

1. **The git repository is the source of truth.** Every change is committed with a clear message. Never work from an old ZIP or a pasted snippet.
2. **`PROGRESS.md` is the shared status board.** At the end of every work session the assistant updates it:
   - what changed
   - what's half-done
   - what was deployed
   - what needs testing

   At the start of every session it reads it, plus `git log -15 --oneline` and `git status`.
3. **`CLAUDE.md` is the project rulebook.** It holds the design decisions, constraints and feature notes. Both assistants follow it. `AGENTS.md` (read by ChatGPT/Codex) points to it. When a decision changes, update `CLAUDE.md` in the same commit.
4. **Only one assistant works at a time.** Commit before switching. If both edit the same files without committing, one overwrites the other.
5. **Deploys:** say in `PROGRESS.md` what was deployed and when. The live site = the last deploy, which may differ from the latest commit if someone forgot to deploy.

**Right now the repository is only on this computer**, at `C:\Users\fanou\OneDrive\Documents\jvo-hub`, with local git history and **no GitHub remote**. To let ChatGPT work on the same code, put it on GitHub (private) and have both assistants push and pull there. See §11.

---

## 1. What the website does

A community site for **Just Volleyball Oceania (JVO)**, a Discord community playing the video game *just volleyball* (temkosoft). Its job is to run and record **exhibition nights and tournaments**:
- fixtures and results
- player and team stats
- clubs, profiles and chat
- a Discord pick-up bot

There are no leagues or seasons: the original league plan is shelved (see `CLAUDE.md`).

### Current features (details in `CLAUDE.md`)
- **Public pages:**
  - Home: game-style menu on desktop, Live now panel during events.
  - Fixtures: List, or Groups & bracket with a seeding map.
  - Stats: sortable player table.
  - Events list, event page: sign-ups, **Event rules**, group tables, group fixtures, finals bracket, top players, teams.
  - Match page: box score, result votes, captain confirm.
  - Player and team profiles: Steam-style, with badges, levels, comments.
  - Teams & players, FAQ & rules, Pickup (Elo and 1v1 RP leaderboards, live queue).
- **Accounts:**
  - Players sign in with **Discord**.
  - Admins sign in with **username + password**, or with Discord if marked `discord: true` in `/admins`.
  - There's an admin mode switch.
- **Clubs:**
  - registration (needs admin approval) and invites
  - join requests, offers, releases, leave requests
  - managers and hand-over, squads of 4 + 2 subs
  - disbanding when the last player leaves, transfer news
  - club chat
- **Events:**
  - club and solo sign-ups (solos become admin-made mix teams)
  - automatic round robin, group stages, knockout (final / semis / quarters)
  - fixture lock 10 minutes before the start
  - **match night flow:** matches open at the start and per team, a break before the finals, stuck-match alerts, pause / open early
  - FEATURED! card with a local-time countdown that becomes a live board
- **Results:**
  - players vote set scores, and matching votes from both teams publish the score
  - a captain can confirm with one tap
  - end-of-match screenshots, which admins read with in-browser OCR to record stats
  - audit log of admin changes
- **Social:** global and club chat panel (profanity filter, slur block), comments, notifications bell, results/transfers ticker, staff badges, LFT tags.
- **Pickup bot** (Discord, `bot/`):
  - random 2v2–6v6 games with ready checks, captain drafts and locked voice channels
  - Elo, a 1v1 ranked queue with RP
  - club roles, welcome messages
  - a site queue and leaderboards

## 2. Tech stack

| Part | What | Where |
|---|---|---|
| Website | Plain ES-module single-page app (no framework, no build step), PWA with service worker | `public/` |
| Database / auth / files | Firebase: Firestore, Authentication (email/password + custom tokens), Storage, Hosting | Firebase project `i-love-jvo` |
| Firebase JS SDK | 12.19.0, loaded from `gstatic.com` (not npm) | imports in `public/js/*.js` |
| Discord sign-in + old images | Cloudflare Worker `ilovejvo-auth` (free plan) with Workers KV `MEDIA` | `worker/` |
| Billing safety | One Cloud Function `billingKillSwitch` (Pub/Sub `billing-killswitch`), Node 22 | `functions/` |
| Pickup bot | Node ≥ 20, discord.js 14.27.0, runs 24/7 on an AWS EC2 t3.micro (Sydney) as systemd service `jvo-bot` | `bot/` |
| In-browser libraries (CDN) | tesseract.js 5.1.1 (OCR), gifuct-js 2.1.2 + gifenc 1.0.3 (GIF shrinking), from jsDelivr | `js/ocr.js`, `js/gif-shrink.js` |
| Tests | Node's built-in test runner (`node --test`) | `tests/`, `bot/tests/` |

## 3. Folder structure

```
jvo-hub/
├─ public/                 the website (deployed as-is to Firebase Hosting)
│  ├─ index.html, sw.js (service worker: bump CACHE on every deploy), manifest.webmanifest
│  ├─ css/app.css          all styles
│  ├─ images/, icons/      art, game logo (used with the developer's OK), characters
│  └─ js/
│     ├─ app.js            router (route table), page drawing, update banner
│     ├─ config.js         Firebase web config (public), Discord client id, Worker URL, switches
│     ├─ firebase.js, auth.js        two Firebase apps (players / admins), sign-in, admin mode
│     ├─ data.js           all reads (cached), event "bundles", schedule plan
│     ├─ writes.js, admin-data.js, player-data.js   all saves (batched, with audit log)
│     ├─ admin-sync.js     admin browsers save fixtures at the lock, finals, finals opening time
│     ├─ live.js           Firestore listeners (live redraws, live event watcher)
│     ├─ shell.js, menu.js, nav.js   desktop game-menu chrome, side menu, navigation/back trail
│     ├─ featured.js, reel.js, notifications.js, search.js, chat-panel.js, chatbox.js
│     ├─ media.js, gif-shrink.js, ocr.js, transfers.js, characters.js, help-defaults.js
│     ├─ rules/            PURE logic, unit-tested (no Firebase): autofix (fixtures/groups/knockout),
│     │                    flow (match night), votes, match, standings, stats, badges, events (dates,
│     │                    time zones, countdown), endscreen (OCR layout), profanity, markdown...
│     └─ pages/            one file per page; pages/admin/ for admin pages; parts.js shared pieces
├─ firestore.rules, storage.rules, firestore.indexes.json   security rules (deployed)
├─ firebase.json, .firebaserc   Firebase config; projects: default = demo-jvo-hub (emulator), prod = i-love-jvo
├─ functions/              billing kill switch (Cloud Function)
├─ worker/                 Cloudflare Worker (Discord OAuth → Firebase token; old image store)
├─ bot/                    Discord pickup bot (own package.json, tests, deploy scripts, .env.example)
├─ seed/                   made-up sample data + loader for the local emulators
├─ tests/                  unit tests for public/js/rules and the worker
├─ tools/, scripts/        live-config check, icon maker, art cut-out scripts
├─ art-src/                source pictures for the art and characters
└─ *.md                    CLAUDE.md (rulebook), HANDOVER.md, PROGRESS.md, AGENTS.md, README.md,
                           GO-LIVE.md, DISCORD-SETUP.md, BOT-SETUP.md (setup checklists)
```

### Which file controls what
| Page / feature | File(s) |
|---|---|
| Routes (URL → page) | `public/js/app.js` (the `routes` list) |
| Home, Events list, Event page (sign-ups, groups, bracket) | `pages/events.js`, shared pieces in `pages/parts.js` |
| Event rules section | `pages/event-rules.js` |
| Live now panel / FEATURED! card | `pages/live-parts.js`, `featured.js` |
| Fixtures page | `pages/fixtures.js` |
| Match page + result voting + captain confirm | `pages/match.js`, `pages/report.js` |
| Stats | `pages/stats.js`, `pages/career.js`, `rules/stats.js` |
| Player / team profiles, customising | `pages/player.js`, `pages/team.js`, `pages/profile-parts.js`, `pages/customise.js` |
| Me page, Club hub, Teams & players | `pages/me.js`, `pages/club.js`, `pages/manage.js`, `pages/teams.js` |
| Pickup page | `pages/pickup.js` |
| Admin: events, rule config, fixtures tab, match night controls | `pages/admin/event-edit.js` |
| Admin: result entry + OCR | `pages/admin/result.js`, `ocr.js`, `rules/endscreen.js` |
| Admin: requests inbox, people, FAQ editor | `pages/admin/requests.js`, `people.js`, `help-edit.js` |
| Fixture generation, groups, knockout | `rules/autofix.js`, `rules/schedule.js` |
| Match night flow | `rules/flow.js` |
| Who can read/write what | `firestore.rules`, `storage.rules` |

## 4. Commands

You need **Node.js 20+**, **Java 11+** (for the Firestore emulator) and the **Firebase CLI** (`npm i -g firebase-tools`).

```bash
npm install                 # root dev tools (jimp, for icons/art scripts)
cd bot && npm install       # the bot's dependencies (discord.js)
cd functions && npm install # only to deploy the kill switch
```

| Task | Command (from the project folder) |
|---|---|
| Run the site locally | `npm run dev` (emulators: site http://localhost:5000, emulator UI http://localhost:4000) |
| Load sample data + test admin | `npm run seed` (in a second terminal; the test admin is `admin`, password in `seed/seed.mjs`, emulator only) |
| Local Worker (only for old images) | `npm run worker` |
| Tests (site rules + bot) | `npm test` |
| Build | **None needed**: `public/` is served as-is |
| Check live config before deploying | `npm run check-live` |
| Deploy site + rules | `firebase deploy --only hosting,firestore:rules,storage --project prod` (or `npm run deploy` for everything) |
| Deploy the Worker | `cd worker && npx wrangler@4.146.0 deploy` |
| Bot locally | `cd bot && npm start` (needs `bot/.env`) |
| Bot on the server | `bot/deploy/upload.ps1` (see `BOT-SETUP.md` Part 6) |

Locally, the site uses the emulators automatically (`config.js` switches on `localhost`). Pretend Discord players (Wavecrash, Coralyn, Drift, Newbie) are on the Me page, local only.

**Every deploy of the site:** bump `CACHE` in `public/sw.js` (e.g. `jvo-shell-v48` → `v49`). Open tabs then show "The site has been updated · Refresh".

## 5. Hosting and deployment

- **Website:** Firebase Hosting, project **`i-love-jvo`**, at https://i-love-jvo.web.app (also `i-love-jvo.firebaseapp.com`). All URLs go to `index.html` (SPA). `/sw.js` is never cached and everything else is `no-cache` (`firebase.json`). Domain `ilovejvo.com`: see `GO-LIVE.md` Part 5. Whether it's connected yet isn't confirmed in the notes, so check the Firebase console → Hosting.
- **Deploying:** the person running the deploy must be logged into the Firebase CLI (`firebase login`) with access to `i-love-jvo`. Until now, Claude ran `firebase deploy --only hosting[,firestore:rules] --project prod` from this computer.
- **Plan and cost:** Blaze (pay-as-you-go) only for Storage. A **$5 AUD budget plus `billingKillSwitch`** turns billing off if reached (`GO-LIVE.md` Part 7). Everything must stay within free allowances. Don't add Cloud Functions or paid services unless the owner asks.
- **Worker:** Cloudflare account, free plan, `ilovejvo-auth.ilovejvo.workers.dev`.
- **Bot:** AWS EC2 t3.micro (Sydney, Ubuntu), service `jvo-bot`, paid from AWS new-account free credits. Oracle Cloud Always Free was the plan, but sign-up was stuck. When the AWS credits run out this will cost money, so move it then. See `BOT-SETUP.md`.

## 6. Services, credentials and where to get them

Nothing secret is in the repo. Secrets live in:

| Secret | Used by | Where it's kept | Where to get / reset it |
|---|---|---|---|
| Discord **client secret** | Worker (sign-in) | Cloudflare Worker secret `DISCORD_CLIENT_SECRET` | Discord Developer Portal → app → OAuth2 → Reset Secret |
| Google **service account key** (zero permissions, signs Firebase custom tokens) | Worker | Worker secret `FIREBASE_SERVICE_ACCOUNT` | Google Cloud console → IAM → Service accounts (`DISCORD-SETUP.md` Part B) |
| Discord **bot token** | Bot | `bot/.env` on the PC and the server (git-ignored) | Developer Portal → app → Bot → Reset Token |
| Bot's Firebase **password** | Bot (`STORE=firebase`) | `bot/.env` | Firebase console → Authentication → user `pickup-bot@users.ilovejvo.com` → reset password |
| Admin **passwords** | Admin sign-in | Firebase Authentication | Firebase console → Authentication |
| AWS server **SSH key** | Bot deploys | The owner's PC (not in the repo) | AWS console → EC2 → Key pairs |

**Not secret (and in the repo on purpose):** the Firebase web config (`public/js/config.js`), the Discord client id, the Worker URL, and the KV namespace id. Security comes from `firestore.rules` / `storage.rules`.

**Admin list:** the `/admins/{uid}` docs are added **only by the owner in the Firebase console**: `{ name, discord: true }` for Discord admins, where uid = `discord:<discordId>`. The bot's account is listed in `/pickupBots/{uid}`.

**External APIs:**
- Discord: OAuth2 and the bot gateway.
- Firebase: Auth, Firestore, Storage.
- Cloudflare Workers + KV.
- jsDelivr / gstatic CDNs.
- Nothing else is paid.

See **`.env.example`** (root) for every name, and **`bot/.env.example`** for the bot's full list.

## 7. Database (Firestore)

The schema is enforced by `firestore.rules`, and the sample data is in `seed/sample-data.mjs` (all names invented). There are no migrations: new fields are optional, and missing ones mean the old behaviour.

| Collection | What |
|---|---|
| `events/{id}` | One event: `type`, `title`, `date` (timestamp), `timeTbd`, `status` (upcoming/finished/cancelled), `published`, `featured`, `teamIds`, `teamSize`, `matchFormat.bestOf`, `autoFixtures` (off/once/double), `signups`, `solos`, `groups {count, draw, assign}`, `finals {type, semiBestOf, finalBestOf}`, `fixturesLockedAt`, `flow {on, breakMinutes, stuckMinutes, matchMinutes, paused, openAt, finalsOpenAt}`, `showTable`... |
| `events/{id}/fixtures/{fid}` | `homeTeamId`, `awayTeamId`, `order`, `label`, `group`, `stage` ('playoffs' for knockout), `scheduledAt`, `bestOf`, `homePlaceholder`... |
| `events/{id}/results/{fid}` | `sets [{home, away}]`, `playerStats {playerId: {pts, spk, blk, rec, set, ast, ace, dig}}`, `mvpPlayerId`, `forfeit`, `source` ('votes' or admin), `confirmedBy`, `statsStatus` (pending/reviewed), `enteredAt` |
| `events/{id}/submissions/{fid}__{playerId}` | Player score votes (+ `screenshotPaths`) |
| `events/{id}/entries/{teamId}`, `/solos/{playerId}`, `/rosters/{teamId}` | Club sign-ups, solo sign-ups, who played for whom |
| `teams/{id}` | Clubs: name, shortName, colors, theme, logo/banner/background paths + frames, manager, `status` (pending/approved/disbanded), `mix`, `invitePlayerIds` |
| `players/{id}` | `displayName`, `number`, `uid` (`discord:<id>`), `discordId`, `teamId`, `lft`, `staff`, profile fields, `gameNames` |
| `teams/{id}/chat`, `teams/{id}/comments`, `players/{id}/comments`, `chat` | Club chat, comments, global chat |
| `joinRequests`, `offers`, `leaveRequests`, `claims`, `transfers`, `playerLinks` | Club moves and profile claims |
| `chatLimits`, `commentLimits` | Rate limits (one doc per user) |
| `settings/faq`, `settings/rules` | FAQ and rulebook text |
| `admins/{uid}`, `pickupBots/{uid}` | Admin list and bot account (console-only) |
| `auditLog` | Append-only record of admin changes |
| `pickupRatings`, `pickupGames`, `pickupSignups`, `pickupMeta`, `pickupControl`, `rankedSignups`, `rankedRatings`, `rankedGames` | Pickup bot and 1v1 ranked (bot-written) |

**Storage:** `teams/{id}/{logo|banner|background}/…`, `players/{id}/{avatar|banner|background|shot}/…` (`storage.rules`; limits 2 / 4 / 6 MB, screenshots 4 MB).

**Sample data:** `npm run seed` loads made-up teams, players and events into the emulators.

**Live data can't be exported from here:** it would need an admin key, which isn't kept anywhere in the project. To back it up: Firebase console → Firestore → Import/Export (needs a Cloud Storage bucket; small cost), or `gcloud firestore export`.

## 8. What works, known issues, unfinished

**Works (deployed and tested; details in `CLAUDE.md`):** everything in §1. All **179 unit tests** pass (`npm test`).

**Known limits / issues:**
- **No server.** Saving fixtures at the lock (10 minutes before the start) and saving the finals and their opening time need **an admin with the site open** at those moments.
- **Rules can't check everything.** "One match at a time per team" is checked by the site, not the database rules. Squad size (6) is checked by the app only.
- **Mix teams.** Their players can't vote on results, so admins enter those.
- **OCR.** The game's right-hand stats table is cut off at ace/dig on 16:9 screens.
- **Match night flow** (2026-10-24) has only run on a local copy. The first real run is the DEMO EXHIBITION NIGHT (2026-10-24, 6 pm AEDT).
- **Bot.** The 1v1 ranked queue hasn't had a real game yet, and the welcome message hasn't greeted a real member yet.
- **Bot hosting.** It runs on AWS free credits (temporary).
- **Custom domain.** Status not confirmed.

**Unfinished / asked about:**
- The user asked to tidy the event page's fixtures "to the clean format we made before". It was interrupted and not done; check with the user.
- From the shelved league plan, nice to have: data export button, analytics, Season Wrapped, streams page.

## 9. Design decisions and constraints (keep these)

- **Name:** "I<3JVO" everywhere people see it (`I&lt;3JVO` in HTML).
- **Look:**
  - Light "beach day" theme: ball-blue `#1438d8`, navy `#18204a` outlines, yellow only for small highlights, Fredoka headings, Graduate numbers.
  - Desktop (≥1024px) copies the game's own menu. Phones keep a light layout.
  - Avoid a generic "AI dashboard" look.
- **Phone-first.** Tables scroll inside themselves; no sideways page scroll.
- **Computed, not stored.** Standings, stats, records and badges are worked out from results, never stored by hand.
- **Security.**
  - The public reads, and only the right people write, all enforced in `firestore.rules`.
  - **Never put secrets in code or in chat.** A secret pasted into chat must be reset.
- **Free.** Everything stays inside free allowances; ask before anything that costs money.
- **Data-model changes:** explain them and how existing data migrates first (so far always "optional field, missing = old behaviour").
- **JVO rules:**
  - 4v4, squads of 6.
  - Best of 3, sets to 10, win by 2.
  - Table points 3 / 2 / 1 / 0, forfeit 2–0 (10–0, 10–0).
  - Stats: pts / spk / blk / rec / set / ast / ace / dig.
  - Ask rather than guess on game rules.
- **Working style the owner wants:**
  - plain-language explanations
  - tell them how to test
  - suggest simpler options
  - commit (and deploy) after each piece, commit trailer naming the assistant
  - admin records (`/admins`) are only changed by the owner

## 10. How each piece is verified before saying "done"

1. `npm test` passes.
2. Check in the browser on the local emulators (`npm run dev` + `npm run seed`) at phone and desktop sizes.
3. Deploy, then load the live site and confirm the change (a fresh `sw.js` CACHE version).
4. Commit, and update `PROGRESS.md`.

## 11. GitHub (recommended for syncing with ChatGPT)

- **Current state:** no remote. Branch `main`. Latest commit: see `git log -1` (this handover is committed on top of `847803b` "Match night flow…").
- **To set it up (owner, ~3 minutes):**
  1. Create an empty **private** repository on github.com (no README).
  2. In this folder, run:
     ```bash
     git remote add origin https://github.com/<you>/jvo-hub.git
     git push -u origin main
     ```
  3. Connect ChatGPT to that repository.
- **After that:** both assistants pull before working and push after. `.gitignore` already keeps out `node_modules`, `.env` files, keys, logs and local data.
