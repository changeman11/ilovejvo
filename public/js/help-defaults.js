// Starter FAQ and rulebook, shown until an admin saves their own at /admin/help, plus the roles
// guide (/help?tab=roles, not editable on the site). Rewritten 2026-11-21: more detail, and
// formats are per event (each event page's "📜 Event rules" has the exact settings).

export const DEFAULT_FAQ = `# Getting started
## What is I<3JVO?
The home of Just Volleyball Oceania: events, fixtures, results, player and club stats, pickup games and the community around them. Everything you see (tables, stats, awards, trophies) is worked out from match results, so nobody types it in by hand.

## How do I make a profile?
Press **make profile** (top right, or the Me tab on a phone) and sign in with Discord. You'll get a player profile straight away.
- **Already have stats under your name?** Choose to claim that profile instead. An admin checks it's you and approves it, and the stats join your account.
- You can change your name, number, bio, pictures, banner, theme colour and socials any time from the Me page.

## Do I need a club to play?
No. You can be a **free agent**: join pickup games, sign up solo to events that allow it, and tick **LFT** (looking for team) on the Me page so clubs can find you. LFT players are listed first when managers look for players.

## Where do I talk to everyone?
On the JVO Discord (link in the bottom bar and the footer). The site also has a chat panel on the right edge of every page: **Global** for everyone and **Club** for your squad.

# Events
## What kinds of events are there?
**Exhibition nights** (casual, often one night) and **tournaments** (groups, knockouts, elimination brackets). Each event is set up on its own, so the team size, number of sets, finals and sign-up rules can be different every time. The Events page has tabs for **Upcoming**, **Past** and **🧪 Pre-launch** events (from before the game launched).

## How many players do we need?
Each event sets **players per game** (for example 3v3) and how many **subs** a team may use. You'll see it as "3v3 · 2 subs" on the event page. A team can check in up to that many players (players per game + subs) for the event. Your club squad can still have up to 6 players.

## How do I know the format of an event?
Open the event and read its **📜 Event rules** section. It's written from that event's own settings: team size, best of how many sets, points per set, groups, finals, check-in and how results work. If it's there, it beats anything general in this FAQ.

## How does my club get into an event?
When sign-ups are open, the club's manager presses **Sign up** on the event page. Sign-ups close **10 minutes before the start** (or when an admin locks them), and the fixtures are set **5 minutes before the start**. Admins can also add clubs themselves.

## I don't have a club. Can I still play an event?
If the event allows **solo sign-ups**, press **Sign up solo** on the event page. Admins put solo players into mix teams for that event only. Your own club (if you have one) doesn't change.

## When are fixtures made?
For events with automatic fixtures, you can see the draft schedule as clubs sign up. It locks at the start time and then doesn't change. Some events (like hand-made brackets) are filled in by the admins as rounds finish.

## What is check-in?
Some events ask every player on the roster, **subs included**, to **check in once** at the start (✋ on the event page or your match page). A match opens when enough players from both teams have checked in. If you can't, ask a staff member to check you in. The bot pings everyone in #matches when it's time, and again 10 minutes later if you still haven't.

# Clubs
## How do I join a club?
Open the club's page (Teams & players) and press **Request to join**, or accept an invite from a manager. Invites and answers show under the 🔔 bell. A squad can have up to **6 players** (for example 4 + 2 subs).

## How do I start a club?
While you're a free agent, open the Club tab and register a team: name, colours, **a logo (required)**, and players you'd like to invite. An admin approves it, you become the **manager**, and your invites are sent.

## Can I leave or switch clubs?
Yes, leave any time from the Club hub, no approval needed. You can add a short goodbye message: it shows under your move in #transfer-news and on the site's transfers ticker. One club at a time. **Moves are paused while an event is running** (from 10 minutes before the start until it's finished), so line-ups don't change mid-event.

## Can a manager close the club?
Yes: Club hub → **Manager** → **Disband the club**, then type the club's name. Everyone becomes a free agent, its sign-ups to events that haven't started are withdrawn, and the name can be used again. If the club is in an event that's already started, its remaining matches there count as **forfeits** (the other team wins 2–0).

## What if the manager leaves?
A manager hands the club to another squad member first (Club hub → Manager → hand over). If the manager is the last player and leaves, the club is **disbanded**: its results and history stay, and the name can be used again.

# Results and stats
## Where are the match threads?
In the **#matches** forum on Discord. Every match has its own post (named after the two clubs) with a status tag: 🟢 Live, ✅ Score in, 📸 Needs stats, 🏁 Done. Filter by tag to find yours. Each event also has a **📢 check-in & reminders** post.

## How do results get on the site?
1. After the match, players from each team vote the set scores on the match page (or in the Discord match thread) and attach the end-of-match screenshot.
2. When a home vote and an away vote agree, the score goes up straight away. A captain can also tap **✓ Confirm this score** on the other team's vote.
3. Stats are read from the screenshot (by the bot or the admins), checked, then published.

## The score is wrong. What do I do?
Open the match and press **🛠 Fix this result**. Send the right set scores, a screenshot or a note. If both teams send the same fix, it changes straight away; otherwise an admin looks at it.

## The bot says there's no screenshot (or it can't read it)
Stats come from the **end-of-match screen** (the table with everyone's stats). Take a **full-screen screenshot** of it (Print Screen, Steam's F12, or Win+Shift+S over the whole game window) and **post it in the match thread** on Discord as a PNG or JPG: not a GIF, not a phone photo of your screen, not cropped. Or open the match on the site → **🛠 Fix this result** → add the screenshot. Best is the end-of-match screen with both teams side by side. The match details pop-up from the menu works too, as long as every player is in the picture (post two screenshots if you had to scroll), and don't crop it. The bot reads it within a few minutes. Until then, nobody gets stats or awards from that match, and the bot pings both teams every 15 minutes until it's sorted.

## My stats are wrong or missing.
Use **🛠 Fix this result** with a note, or ask an admin on Discord. Admins can fix stat lines and link your in-game name to your profile, so you're recognised automatically next time.

## What do the stats mean?
They come straight from the game's end-of-match screen: **PTS** points, **SPK** spikes, **BLK** blocks, **REC** receives, **SET** sets, **AST** assists, **ACE** aces, **DIG** digs. **MVP** is the player of the match, and always comes from the **winning team**.

## Where did my old stats go?
just volleyball launched on **21 November 2026**, so everyone's stats started again from 0. Everything from before is kept in **🧪 Pre-launch stats** on the Stats page, and on each player's page. It doesn't count towards live stats, awards, levels or badges.

## How do I find someone's stats or compare two players?
On the Stats page: **🔥 Last event**, **🌏 All time** or **🗄️ Archived** events, then Overview, Players (with search), Teams, and **⚖️ Compare** for two players side by side, including their head-to-head record.

# Awards, roles and trophies
## How do awards work?
Each stat has a 🥇 1st, 🥈 2nd and 🥉 3rd place, worked out from the **last event with stats** (shown on the Stats page). The 🥇 1st place for each stat also gets a matching Discord role named after the award, like "Spike Royalty 💥" or "Point Machine 👑". When the next event's stats come in, the roles move to that event's top 3s automatically.

## What are the Discord roles?
- **Club role:** your club's name in its colour, so teammates share a name colour.
- **Captain:** every club manager.
- **🎟️ Event Player:** you're in an upcoming or running event.
- **Award roles:** your current 🥇 1st places.
- **🏆 Pre-launch Champion:** you won an event before the game launched.
- **Event winner roles** (e.g. "🏆 TOURNAMENT 2 Champion"): some events give their winning team a role. Every player on that team gets it once the final is played, and keeps it. Tournaments use **🏆 1x Tournament Champion**, which goes up to 2x, 3x… with every title you win.
- **Divider roles (━ TEAM ━ / ━ AWARDS ━):** just split your roles into sections on your profile.
- **Staff:** the JVO team, who are also admins on the site.
More in the **Roles** tab.

## Where are trophies shown?
Event winners go in the club's **🏆 Trophy cabinet** on its page, and the latest champions show on the right of every page. Every player who played for the winning team gets a **🏆 Honours** entry on their profile. Winners of pre-launch events also get the **🏆 Pre-launch Champion** role on Discord, and events with a winner role give it to every player on the winning team.

# Pickup games
## What is pickup?
Quick games on the Discord. Sign up in #pickup (or on the site's Pickup page), and once enough players are in, the bot runs a ready check, picks a mode (2v2 to 6v6), and captains draft teams (or teams are random if most players vote for that). Results build your **Elo** rating. Elo and 1v1 RP started again at launch (21 November 2026); the old ones are under **🧪 Pre-launch ratings** on the Pickup page.

## How does 1v1 ranked work?
Queue in #1v1-queue, ready up in the voice channel, play, then both players report the winner with a screenshot. You earn **RP** (5 placement games, then ±20).
`;

export const DEFAULT_RULES = `# How rules work at JVO
Every event has its own settings. **The event's 📜 Event rules section (on its page) is the final word** on team size, match length, groups, finals, check-in and timings. The rules below are the general ones that apply unless an event says otherwise.

# Matches
- **Players per game and subs are set per event** (for example 3v3 with 2 subs). Play with the number the event says; only that many players plus subs can check in for a team.
- Matches are usually **best of 3 sets**. Finals or special events can be best of 5.
- A set is usually **first to 10, win by 2**, with no cap, unless the event sets something else.
- Play the match as scheduled once it opens. If you can't, tell the other team and the staff as early as you can.

# Results
- After the match, each team reports the set scores and adds the end-of-match screenshot (match page or Discord match thread).
- The score goes up once both teams agree, or a captain confirms the other team's vote.
- If teams disagree, staff decide using the screenshots. Keep your screenshot until the result and stats are on the site.
- Mistakes are fixed with **🛠 Fix this result** on the match page.

# Forfeits
- A team that doesn't show (or can't field enough players) can be given a forfeit loss by staff.
- A club that disbands or is taken out of an event after its fixtures are set forfeits its remaining matches there automatically.
- A forfeit counts as a **2–0** win, with both sets **10–0**. No player stats are recorded.

# Tables
When an event has a table, the usual points are:
- **3** for a 2–0 win
- **2** for a 2–1 win
- **1** for a 1–2 loss
- **0** for a 0–2 loss

Ties are split by points, then wins, then set ratio, then point ratio, then head-to-head.

# Clubs
- One club at a time, up to 6 players in a squad.
- No club moves while an event is running.
- Mix teams (made from solo sign-ups) last for one event only.

# Fair play
- Play under your own profile and in-game name. Stats are checked, and numbers that look wrong are looked into.
- Be good to each other in chat, comments and match threads. Staff can remove pictures, text or messages that break the Discord's rules.
- Staff decisions on disputes are final for that event.
`;

export const DEFAULT_ROLES = `# Who does what
At JVO everyone is one of these. You can be more than one, like a manager who's also staff.
- **Player:** anyone with a profile (sign in with Discord).
- **Free agent:** a player with no club. Can play pickup, sign up solo and tick LFT.
- **Manager (captain):** runs a club: invites players, signs the club up, confirms scores. Has the **Captain** role on Discord.
- **Staff:** the JVO team (Staff role on Discord), who are admins on the site. Some have a badge: 🛡️ Admin, 🔨 Mod or 🎙️ Caster.

# Discord roles
- **Club role:** given automatically to everyone whose profile is in a club, in the club's colour. That's why your name shows your club colour.
- **Captain:** given automatically to every club's manager.
- **🎟️ Event Player:** given automatically while you're in an upcoming or running event (your club signed up, you're on its roster as a sub, or you signed up solo). It comes off after the event. Staff use it to ping everyone playing.
- **Award roles (like "Point Machine 👑"):** the leader of each stat at the last event with stats (2nd and 3rd are shown on the site). They move by themselves when the next event's stats come in. They don't change your name colour.
- **Staff:** given by the server owners. Anyone with it is automatically an admin on the site.
- Your Discord account must be linked (sign in to the site with Discord) for any of this to work.

# Players
## Before an event
- Make sure your profile is in the right club (or sign up solo if the event allows it).
- Read the event's **📜 Event rules**: team size, format, start time.
- Make sure your in-game name looks like your profile name, so your stats are matched to you.

## During an event
- **Check in** once at the start if the event asks (✋ on the event page).
- Watch for "● on now" on your matches, and the Discord match thread.
- After each match, vote the set scores and add the **end-of-match screenshot**.
- No club moves while the event is on.

## After an event
- Check your match pages. If a score or stat is wrong, use **🛠 Fix this result**.
- Your stats, awards and the event's trophies update by themselves.

# Managers (captains)
## Before an event
- **Sign your club up** on the event page before sign-ups close (10 minutes before the start).
- If your club is short of players, the bot pings you in #matches 24 hours and 2 hours before the start.
- Make sure your squad is set: invites accepted, up to 6 players, enough for the event's team size.
- Tell your players the start time and to read the event rules.

## During an event
- Make sure enough of your players check in so your matches can open.
- After each match, vote the score, or tap **✓ Confirm this score** on the other team's vote.
- If something goes wrong (a no-show, a dispute, a disconnect), tell the staff in the match thread.

## After an event
- Check your club's results on **My matches** (/matches) and send fixes for anything wrong.
- Hand the club to someone else (Club hub → Manager) before leaving it.

# Staff
## Before an event
- Create the event, set the format in **Rule config**, publish it and open sign-ups.
- Check sign-ups and solo players; make mix teams if needed.
- Be online around the start: fixtures lock and save then.

## During an event
- Watch the admin **Fixtures & results** tab for stuck matches, disputes and check-ins.
- Check players in if they can't, pause, open matches early or open finals.
- Enter or correct results when teams can't.

## After an event
- Publish stats on **/admin/stats** and close result fixes in **Requests**.
- Mark the event finished if it doesn't finish by itself.
- The admin guide (/admin/guide) has every step in detail.
`;
