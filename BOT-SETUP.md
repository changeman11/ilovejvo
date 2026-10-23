# JVO pickup bot: setup checklist

The pickup bot runs pick-up games in the JVO Discord. The code is in [`bot/`](bot/).

1. **Sign up:** players pick **Sign up** (or **Withdraw**) in the menu on the bot's queue card in `#pickup`. They don't need to be in voice.
2. **Countdown:** once 4 or more are signed up, a 30-second countdown gives others time to join.
3. **Random mode:** the bot picks a random mode (2v2 to 6v6) from the ones that fit the number signed up.
   - The longest-waiting players get in. Everyone else stays queued for the next game.
   - With 12 signed up, it starts straight away.
4. **Ready check (the queue "pops"):** the bot makes a **locked** voice channel (`🏐 ready up · 4v4`) and a **locked match chat** (`#ready-up-4v4`).
   - The match chat is visible only to the picked players and admins. The ready-check card in it pings them, and ticks each player off as they join the voice channel.
   - Once everyone's in, the chat becomes the game's chat (`#game-12`) until the result is in, then it's deleted.
   - Everyone can see it, but only those players (and admins) can join.
   - Each player confirms by joining it within **60 seconds**.
   - Anyone who doesn't is **dropped** from the queue (they can sign up again). The next player in the queue takes their place and gets pinged.
   - If there aren't enough players to replace them, the ready check is cancelled. The players who did confirm stay signed up at the front of the queue.
   - Leaving the ready-up channel before everyone's in un-confirms you; you can come back before the time's up.
5. **Captains:** once everyone's in, one random player on each team becomes captain. A coin flip decides who picks first.
6. **Draft:** captains take turns (A, B, A, B) picking teammates by pressing names in the pickup channel.
   - 60 seconds per pick, or the pick is random.
   - The last player is placed automatically.
   - If anyone leaves the ready-up channel during the draft, it's cancelled. Everyone else stays signed up in their old places.
7. **Team channels:** the bot makes two **locked** voice channels (`🏐 #12 Team 1 · Alice`, `🏐 #12 Team 2 · Bob`) and moves each team into its own.
   - Only that team (and admins) can join; everyone else can see who's in.
   - The ready-up channel is then deleted.
8. **Result:** when the game ends, **both captains press who won**.
   - If they agree, Elo updates. If they disagree, admins are pinged to decide.
   - If both press **Cancel game**, nothing changes.
   - The team channels are deleted once they're empty.
9. **Elo:** everyone starts at **1000**, K = **32**, and a team's rating is its players' average.
   - Every player on a team gets the same change. For example, two even teams move ±16.
   - Ratings are saved in the site's Firestore, so the website can show them later.

**What it costs:** nothing.

- **Server:** Oracle Cloud's Always Free server, public IPv4 address included.
- **Database:** Firestore's free daily allowance.
  - A game uses about 15 writes.
  - Each bot start reads one document per rated player.
  - `/leaderboard` and `/elo` don't use the database.
- **Why not Google Cloud:** Google's free VM now charges about US$3.65 a month for its IPv4 address, and Discord doesn't work over IPv6.

### Where the secrets go (never in chat, never in git)

| Secret | Where it goes |
|---|---|
| **Discord bot token** | `bot/.env` on your PC, and `~/jvo-bot/.env` on the server |
| **Bot's Firebase password** | The same two `.env` files, plus your password manager |
| **Oracle server key** (`.key` file) | `C:\Users\<you>\.ssh\jvo-bot.key` |

Both `.env` files are git-ignored.

**If one of these ever leaks** (pasted somewhere, or seen in a screenshot):

- **Bot token:** reset it (Part 1, step 5), then update both `.env` files.
- **Firebase password:** in Firebase Authentication, delete the bot user and add it again with a new password (Part 5, step 1). Then:
  - In `pickupBots`, delete the old document and add one for the new UID (step 2).
  - Update both `.env` files.

---

## Part 1: Make the I<3JVO Discord app a bot (you, ~3 min)

The bot lives in the same Discord application as the website's "Sign in with Discord" (client ID `1562397361878343743`). Adding a bot doesn't change sign-in.

1. Open https://discord.com/developers/applications → **I<3JVO**.
2. **Installation** (left menu) → **Install Link** → choose **None** → **Save Changes**. This lets you make the bot private in the next step.
3. **Bot** (left menu):
   - **Public Bot:** **off**, so only you can add it to servers.
   - **Privileged Gateway Intents:** leave all three **off**. The bot doesn't need them.
   - **Save Changes**.
4. Optional, on the same page: set the bot's **icon** and **username** (it defaults to the app name, "I<3JVO").
5. **Reset Token** → **Yes, do it!** → **Copy**. Paste it straight into `bot/.env` (Part 3), not anywhere else. Discord only shows it once. If you lose it, reset it again.

## Part 2: Invite the bot to your server (you, ~1 min)

Try it in a **test server** first. In Discord: **+** (Add a Server) → **Create My Own** → **For me and my friends**.

Open this link, choose the server, then press **Authorize**:

```
https://discord.com/oauth2/authorize?client_id=1562397361878343743&scope=bot%20applications.commands&permissions=17910800
```

It gives the bot these permissions and nothing more:

- View Channels, Send Messages, Embed Links, Read Message History: to post the queue and the game cards.
- Connect and **Move Members**: to move players into team channels.
- **Manage Channels**: to make and delete the team voice channels.

Later, use the same link for the real JVO server.

## Part 3: Channels and settings (you, ~5 min)

1. Discord → **User Settings** → **Advanced** → turn on **Developer Mode**. This adds "Copy ID" to right-click menus.
2. In the server, create a **category** (for example `PICKUP`), and in it a **text channel** `#pickup`.
   - The bot's locked ready-up and team voice channels are made in that category.
3. If the category is private, open its **Edit Category** → **Permissions** → add the bot's role (`I<3JVO`). Allow **View Channel, Connect, Move Members, Manage Channels, Send Messages, Embed Links**.
   - Locked channels need nothing extra: the bot doesn't need "Manage Roles".
4. On your PC, in the `bot` folder, copy `.env.example` to a new file called `.env`. Fill in **`.env`**, never `.env.example`: the example is the blank template that goes into git, so anything typed there could end up public. Get each ID by right-clicking → **Copy ID**:
   - `DISCORD_TOKEN`: the token from Part 1.
   - `GUILD_ID`: right-click the **server icon** → Copy Server ID.
   - `PICKUP_CHANNEL_ID`: the `#pickup` text channel.
   - `ADMIN_ROLE_IDS` (optional): Server Settings → Roles → right-click a role → Copy Role ID. Separate several with commas.
     - Anyone with **Manage Server** is already an admin.
     - Admin roles can join every locked channel, and get pinged when captains disagree.

## Part 4: Try it on your PC (you, ~5 min)

Testing alone works: the bot can add **pretend players** to fill the queue.

1. In the `bot` folder's `.env`, set `STORE=file` (ratings go in `bot/data/pickup.json`) and `ALLOW_TEST_PLAYERS=1`.
2. Install and start the bot (Node.js 22.12 or newer; you have 24), in a terminal in the repo folder:
   ```bash
   cd bot
   ```
   ```bash
   npm install
   ```
   ```bash
   npm start
   ```
   You should see `Logged in as I<3JVO#…. Queue card in #pickup…`, and a **Pickup games: sign up** card with a menu appears in `#pickup`.
   - If it prints warnings about missing permissions, fix them (Part 3, step 3) and restart. To stop the bot: Ctrl+C.
3. In the card's menu, pick **Sign up**. The card lists you.
4. In `#pickup`, type `/pickup testfill count:3`. That makes 4 signed up, so a 30-second countdown starts.
   - To skip the wait, use `/pickup start`.
5. **Ready check:** the bot pings you and makes a locked `🏐 ready up · 2v2` channel. Pretend players are always ready.
   - Join it within 60 seconds.
   - To see a no-show, don't join: you're dropped, and with nobody to replace you the check is cancelled.
6. A **2v2 draft** card appears.
   - If you're a captain, press a name when it's your turn.
   - Pretend captains pick by themselves after a second or two.
7. The bot makes two locked team voice channels, **moves you** into yours, and deletes the ready-up channel.
8. On the game card, press the team that won.
   - **If you're the captain:** the pretend captain agrees, and Elo updates (+16 or −16).
   - **If you're not:** you're the server owner, so your press counts as an admin decision.
9. Try `/elo`, `/leaderboard` and `/queue`.
10. Leave the team voice channel. It disappears.

**Real test:** you plus 3 friends sign up. With `ALLOW_TEST_PLAYERS` empty, it's exactly how real games run.

To run the automated tests (no Discord needed), from the repo folder:

```bash
npm test
```

## Part 5: Keep ratings in Firestore (you, ~5 min)

This lets the website show Elo later. The bot gets **its own Firebase account**. The security rules let that account write only the pickup collections (`pickupRatings`, `pickupGames`, `pickupMeta`), so its password can't touch anything else on the site.

1. Firebase console → **i-love-jvo** → **Authentication** → **Users** → **Add user**:
   - Email: `pickup-bot@users.ilovejvo.com`
   - Password: a long one, **letters and numbers only** (about 30 characters), saved in your password manager.
   - Then **Add user**, and copy the new user's **User UID**.
2. **Firestore Database** → **Data** → **+ Start collection**:
   - Collection ID: `pickupBots`.
   - Document ID: paste the UID.
   - Add a field `name` (string) = `JVO pickup bot` → **Save**.
3. Publish the new security rules, from the repo folder:
   ```bash
   firebase deploy --only firestore:rules --project prod
   ```
4. In `bot/.env`, set `STORE=firebase` and `FIREBASE_BOT_PASSWORD=` the password, then restart the bot.
   - The log should say `[store] Firestore (i-love-jvo): 0 rated players`.
   - Ratings in `bot/data/pickup.json` from Part 4 aren't copied over, so live ratings start fresh.

**Optional, safer try first:** test against the local emulators. Run `npm run dev` in the repo folder, then set `STORE=firebase` and `FIREBASE_EMULATOR=1` in `bot/.env`. No account or password is needed. You can watch the data at http://127.0.0.1:4000/firestore.

## Part 6: Always on: Oracle Cloud free server (you, ~25 min)

Your PC only runs the bot while it's on. For 24/7, use Oracle's Always Free server.

**Run only one copy of the bot at a time.** Two copies with the same token would both answer, causing double drafts. Stop the PC one (Ctrl+C) before starting the server.

### A. Make the Oracle account
1. Go to https://www.oracle.com/cloud/free/ → **Start for free**.
2. **Home Region:** choose **Australia East (Sydney)**. You can't change it later, and free servers must be in the home region.
3. Card check: Oracle may hold a small amount and give it back. Always Free resources are never charged.
4. Wait for the "your account is ready" email, then sign in.

### B. Make the server
1. Menu ☰ → **Compute** → **Instances** → **Create instance**.
2. **Name:** `jvo-bot`.
3. **Image and shape** → **Edit**:
   - **Change image** → **Ubuntu** → **Canonical Ubuntu 24.04** → **Select image**.
   - **Change shape** → **Virtual machine** → **Specialty and previous generation** → tick **VM.Standard.E2.1.Micro** (it's marked "Always Free-eligible") → **Select shape**.
   - Oracle's Ampere (Arm) shapes are also free, but they're often "out of capacity" in Sydney, and the micro one is plenty.
4. **Networking:** keep **Create new virtual cloud network** and **Create new public subnet**, and make sure **Assign a public IPv4 address** is on. No ports need opening: the bot only connects out.
5. **Add SSH keys:** **Generate a key pair for me** → **Save private key**. A `.key` file downloads. Treat it like a password.
6. Leave the rest as it is → **Create**. When it shows **Running**, copy the **Public IP address**.

### C. Connect from your PC
1. Make a folder `C:\Users\<you>\.ssh` (if there isn't one) and move the `.key` file into it, renamed to `jvo-bot.key`.
2. In PowerShell, replacing `<IP>` with the server's address:
   ```bash
   ssh -i $HOME\.ssh\jvo-bot.key ubuntu@<IP>
   ```
   The first time, type `yes`. You're in when you see `ubuntu@jvo-bot:~$`. Type `exit` to leave.

### D. Put the bot on the server
1. On your PC, in the `bot` folder:
   ```bash
   npm run upload -- -Server ubuntu@<IP> -Key $HOME\.ssh\jvo-bot.key
   ```
   It copies the code (not your `.env`) and remembers the server for next time.
2. Connect (step C.2) and run the one-time setup. It takes about 2 minutes: Node.js, a swap file, and a service that starts the bot on boot.
   ```bash
   bash ~/jvo-bot/deploy/setup-server.sh
   ```
   Then type `exit`.
3. Copy your settings from your PC. First make sure `bot/.env` has the live values:
   - `STORE=firebase`, plus the Firebase password.
   - `ALLOW_TEST_PLAYERS` empty.
   - The real server's IDs, if you're moving from the test server.

   Then, in the `bot` folder:
   ```bash
   scp -i $HOME\.ssh\jvo-bot.key .env ubuntu@<IP>:jvo-bot/.env
   ```
4. Start it and watch the log. Look for `Logged in as …`, then press Ctrl+C to stop watching (the bot keeps running):
   ```bash
   ssh -i $HOME\.ssh\jvo-bot.key ubuntu@<IP> "sudo systemctl restart jvo-bot && journalctl -u jvo-bot -f"
   ```

### E. Later
- **Update the bot** after code changes: run `npm run upload` in the `bot` folder. It restarts by itself.
- **See the log:** `ssh -i $HOME\.ssh\jvo-bot.key ubuntu@<IP> "journalctl -u jvo-bot -n 100"`.
- **Idle servers:** Oracle may **stop** free servers that are idle for 7 days, and a bot uses very little.
  - If that happens you'll get an email: open **Compute → Instances → jvo-bot → Start**, and the bot starts by itself.
  - To stop it ever happening: **Billing → Upgrade to Pay As You Go**. Always Free resources stay free, but anything extra you create would be charged, so add a **Budget** alert (Billing → Budgets) at $1.

## Part 6 (instead): Always on with AWS (you, ~25 min)

Use this while Oracle isn't working.

**What it costs:**

- **New AWS accounts** get US$100–200 of credits on the **Free plan**. The plan lasts 6 months, or until the credits run out.
- **This server** uses roughly US$10–13 a month of those credits: about US$7–10 for the t3.micro server, plus US$3.65 for its public IPv4 address.
- **Nothing is charged** to your card on the Free plan. When it ends, AWS pauses the account unless you upgrade.
- **Before then:** move the bot (Oracle, if support sorts it out), or upgrade and pay about US$11 a month.

**Run only one copy of the bot at a time.** Stop the PC one (Ctrl+C in its window) before starting this.

### A. Make the AWS account
1. Go to https://aws.amazon.com/free/ → **Create a free account**.
2. When asked, choose the **Free plan** (not Paid). Finish the card and phone checks.
3. Sign in to the console. At the top right, set the region to **Asia Pacific (Sydney)**.

### B. Make the server
1. Search **EC2** → **Launch instance**.
2. **Name:** `jvo-bot`.
3. **Image:** **Ubuntu Server 24.04 LTS** (64-bit x86).
4. **Instance type:** **t3.micro**.
5. **Key pair:** **Create new key pair** → name `jvo-bot`, type **RSA**, format **.pem** → **Create**. A `jvo-bot.pem` file downloads. Treat it like a password.
6. **Network settings:**
   - **Auto-assign public IP:** Enable.
   - **Allow SSH traffic from:** **My IP**. Nothing else needs opening: the bot only connects out.
7. **Storage:** 8 GB is enough → **Launch instance**.
8. Open the instance. When it shows **Running**, copy its **Public IPv4 address**.

### C. Connect, upload, start

These are the same as Oracle's steps C to E, with an AWS key instead of an Oracle one:

1. Move `jvo-bot.pem` to `C:\Users\<you>\.ssh\jvo-bot.pem`.
2. Test the connection (type `yes` the first time, then `exit`):
   ```bash
   ssh -i $HOME\.ssh\jvo-bot.pem ubuntu@<IP>
   ```
3. In the `bot` folder:
   ```bash
   npm.cmd run upload -- -Server ubuntu@<IP> -Key $HOME\.ssh\jvo-bot.pem
   ```
4. Connect, run the one-time setup, then `exit`:
   ```bash
   bash ~/jvo-bot/deploy/setup-server.sh
   ```
5. In the `bot` folder, copy your settings over:
   ```bash
   scp -i $HOME\.ssh\jvo-bot.pem .env ubuntu@<IP>:jvo-bot/.env
   ```
6. Start the bot and watch its log (Ctrl+C stops watching; the bot keeps running):
   ```bash
   ssh -i $HOME\.ssh\jvo-bot.pem ubuntu@<IP> "sudo systemctl restart jvo-bot && journalctl -u jvo-bot -f"
   ```

### D. Good to know
- **Updates:** run `npm.cmd run upload` in the `bot` folder.
- **If SSH stops connecting:** your home internet address probably changed. Go to EC2 → the instance → **Security** → the security group → **Edit inbound rules** → SSH source **My IP** → Save.
- **If you stop and start the server:** it gets a new public IP. Use the new one in `ssh`, and run the upload once with `-Server ubuntu@<new IP>`.
- **Keep an eye on the credits:** Billing → **Credits** shows what's left.

---

## Part 7: Club roles (you, ~2 min)

The bot gives every I<3JVO club a Discord role:

- **Look:** the club's name, in the club's colour. Club members show as their own group in the member list.
- **Who gets it:** each club player whose site profile has their Discord ID. That's everyone who signed in to the site with Discord.

**How it updates:**

- **Every 5 minutes** it checks the site for changes. When someone joins, leaves or moves club, their role follows. When a club changes its name or colour, the role changes too.
- **Disbanded clubs** have their role deleted.
- **Which clubs:** only approved clubs. Pending clubs and one-event mix teams get no role.
- **Other roles:** it never touches roles it didn't make. Players keep all their other roles.

**Turn it on:**

1. Discord → **Server Settings → Roles** → the bot's role (`i<3JVO`) → **Permissions** → turn on **Manage Roles** → **Save Changes**.
2. Still in **Roles**, drag the bot's role **near the top of the list**.
   - It must be above every role whose colour you want the club colour to beat.
   - Club roles are created just under it, and a bot can only manage roles below its own.
3. `CLUB_ROLES=1` in `.env` (already set). To refresh straight away, type `/pickup syncroles` in Discord. Otherwise it happens within 5 minutes.

**Settings:**

- `CLUB_ROLES_GROUPED=0`: don't group club members in the member list.
- `CLUB_ROLES_MINUTES`: how often it checks.

**Cost:** a check only reads what changed. A full check of all clubs and players runs every 6 hours. Together that's a few hundred Firestore reads a day, well inside the free allowance.

## Commands

| Who | What |
|---|---|
| Everyone | **Sign up** or **Withdraw** with the menu on the queue card in `#pickup`. After a game, sign up again to play again. |
| Picked players | When the bot pings you, join your locked `🏐 ready up` channel within 60 seconds, or you're dropped. |
| Everyone | `/queue` (who's signed up), `/elo` or `/elo player:@someone`, `/leaderboard` (top 20) |
| Captains | Press names on the draft card on your turn. Press the winner (or **Cancel game**) on the game card. |
| Admins | `/pickup start` (start now, optional `mode`). Press the winner on any game card. Pick for an away captain. |
| Admins | `/pickup result game:<number> winner:<Team 1, Team 2 or Cancel>`: set or **correct** a result. The old Elo change is undone first. |
| Admins | `/pickup syncroles`: update club roles from the site now (with `CLUB_ROLES=1`). |
| Admins (testing) | `/pickup testfill count:<n>` and `/pickup testclear` (only with `ALLOW_TEST_PLAYERS=1`) |

**Changing the rules:** in `.env`, then restart the bot.

- `MODES`: which team sizes can come up.
- `COUNTDOWN_SECONDS`, `READY_SECONDS`, `PICK_SECONDS`: the countdown, ready-check and pick timers.
- `DRAFT_ORDER=snake`: A B B A instead of A B A B.
- `ELO_START`, `ELO_K`: the starting rating and how far one game moves it.

## Troubleshooting

| You see | Fix |
|---|---|
| `The bot's settings need fixing` | The message lists what's missing in `.env`. |
| `Discord login failed: An invalid token` | Reset the token (Part 1, step 5) and paste it into `.env` again. |
| `The bot is missing Move Members…` (or Manage Channels) | Give the bot's role those permissions on the PICKUP category (Part 3, step 3). |
| Slash commands don't appear | Wait a minute or press Ctrl+R in Discord. Make sure the invite link (Part 2) was used, since it adds the commands. |
| `Firebase sign-in … failed (INVALID_LOGIN_CREDENTIALS)` | Wrong `FIREBASE_BOT_PASSWORD` or email in `.env`. |
| `Firestore … failed (403)` | The `pickupBots` document is missing or has the wrong UID (Part 5, step 2), or the rules weren't deployed (step 3). |
| Everything happens twice | Two copies of the bot are running (your PC and the server). Stop one. |
| `ssh`: `UNPROTECTED PRIVATE KEY FILE` | In PowerShell: `icacls $HOME\.ssh\jvo-bot.key /inheritance:r /grant:r "$($env:USERNAME):(R)"` |
| A player "isn't in voice, so they weren't moved" | Discord can only move people who are connected to voice. They join their team channel by hand. |
| Someone vanished from the queue | They were picked but didn't join their ready-up channel in time. They can sign up again. |
| A `🏐 ready up · …` channel was left behind | This happens if the bot stops mid-check. The next time the bot starts, it deletes it. |

## Where things are

| File | What it does |
|---|---|
| `bot/src/logic/` | Pure rules with tests: modes, draft, Elo, votes, rating records |
| `bot/src/pickup.js` | The game manager: queue → draft → game → result |
| `bot/src/views.js` | What the cards look like |
| `bot/src/discord-io.js`, `bot/src/index.js` | Discord connection |
| `bot/src/store/` | Storage: JSON file, or Firestore over its REST API |
| `bot/deploy/` | Oracle server setup and the upload script |

**Firestore data** (public to read, only the bot writes; `firestore.rules`):

| Path | What it holds |
|---|---|
| `pickupRatings/{discordId}` | `{ name, rating, games, wins, losses, form, lastGameAt }` |
| `pickupGames/g{n}` | Teams, captains, the captains' reports, winner, each player's rating change |
| `pickupMeta/bot` | Last game number |

Site players are linked by the same Discord ID (player id `d<discordId>`).
