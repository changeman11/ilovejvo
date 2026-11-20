// Admin guide (/admin/guide, admins only, added 2026-11-21): how to do every admin job, step by
// step. "# Section" = a group, "## Job" = one collapsible how-to (same format as the FAQ), with a
// search box that opens the matching jobs.
import { esc, skeleton } from '../../ui.js';
import { markdown, parseFaq } from '../../rules/markdown.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';

export const title = 'Admin guide';

export function loading() {
  return skeleton([60, 400]);
}

const GUIDE = `# The basics
## Who is an admin?
Anyone with the **Staff** role on Discord is an admin on the site automatically (the bot checks every 5 minutes, and straight away when a role changes). Sign in to the site with that Discord account. Take the role away and admin access goes too. Older username + password admin accounts still work.

## Getting around
- **🏠 Home** (/admin): the **Needs you** cards (everything waiting on an admin), **Quick jobs** and every event.
- **📥 Requests:** result fixes, disputed scores, new clubs, profile claims.
- **📸 Stats:** check and publish stats read from screenshots.
- **👥 Teams & players:** edit any club or player.
- **🎭 Characters:** the community characters on the Home court.
- **🤖 Bot:** the Discord bot's switches, timings and quick fixes.
- **📜 FAQ & rules:** edit the help pages.
- The 🔔 bell also has an **Admin to-do** section.

## Admin mode on and off
At the top of admin pages: **Admin mode: on**. Turn it off to see the site like a normal player (no admin tools or to-dos). It's remembered on that device only. Fixtures still save at the lock in the background.

## Is anything here permanent?
Most things can be undone by editing again. These can't: **Delete event**, **Clear fixtures** (asks you to type CONFIRM), deleting a player or club, and deleting Discord threads. Every admin change is written to the audit log.

# Setting up an event
## Create an event
1. Admin home → **New exhibition night** or **New tournament**.
2. **Details:** title, date and time (leave empty for "TBD"), short summary, details, prize, stream link.
3. Leave **Published** off while you set it up: only admins can see drafts.
4. Tick **★ Feature this event** to pin it on every page (otherwise the next upcoming event is featured).
5. Save, then set the format in **Rule config** (next).

## Rule config: the format
In the Details tab, **Rule config**. Everything here is for this event only, and the event page's **📜 Event rules** are written from it.
- **Players per team:** 2, 3, 4… (the team size for this event).
- **Matches are best of** and points per set (finals can have their own best-of).
- **Fixtures:** automatic round robin (once, or home and away), or none if you'll add them by hand.
- **Groups:** how many, and the draw (automatic or by hand).
- **Knockout:** none, final, semi-finals or quarter-finals, plus the **🥉 3rd place match**.
- **Show a table**, club sign-ups, **solo sign-ups**.
- **Match night:** run matches by themselves, check-in, break before the finals, stuck-match alerts.
- **Discord match threads** for this event.
- **Use suggestion** fills in a sensible setup for the number of teams.

## Publish and open sign-ups
Tick **Published** and save. With club sign-ups on, managers press **Sign up** on the event page until **10 minutes before the start**. With solo sign-ups on, free agents press **Sign up solo**. New events show on the bell for players.

# Teams and rosters
## Add or remove clubs
Event → **Teams & rosters**. Clubs that signed up are listed under **Signed up by their managers**; add any others under **Teams added by admins**, then **Save teams**.

## Solo players and mix teams
In **Solo players**: tick players and **Make team from ticked**, or **Auto-group everyone** (teams of the event's size). **Break up** undoes a mix team. Mix teams only last for this event: players' own clubs don't change. Mix-team players can't vote on scores, so enter their results yourself.

## Groups
With groups on, the draw is automatic (random but fair) unless you place teams by hand in **Groups** and **Save groups**. **Re-draw everyone automatically** starts again. The full draw is saved at the lock.

# Fixtures
## Automatic fixtures
With automatic fixtures, the schedule shows as a draft while clubs sign up. At the start time **an admin's browser saves it and locks it**, so be on the site around the start. Or press **Lock fixtures now**. Finals are added once both teams are known.

## Clear fixtures
**Clear fixtures** deletes every match that has no result (and its votes), keeps played results, and unlocks the schedule so it rebuilds. Type **CONFIRM** to go ahead. There's no undo.

## Add matches by hand
With automatic fixtures off, add matches on the **Fixtures & results** tab: home, away, date and time, best of, and **Round**. The Round picker has single and double elimination names (Upper Round 1, Lower Round 2, Grand Final…). Plain numbers (1, 2, 3…) are fine too.

## Elimination brackets: fill in the next matches
**🪄 Fill in the next matches** completes the current round from the teams not placed yet, then makes the next round from the winners once a round is scored. Double elimination also makes the lower bracket and the Grand Final.
- Tick teams for a **bye** before filling a round.
- Your own numbering is kept: nothing is renamed.
- The bracket drawing on the event page follows automatically. Switch it (auto / single / double / off) in the 🪄 box.

## Add a 3rd place match later
On a finished event with semi-finals: **Add 3rd place match**. It's saved once both semis are played.

# On the night
## Before the start
- Be online about 10 minutes before the start: sign-ups close, fixtures lock and save.
- Check every club has enough players, and the solo players are in teams.

## Check-in
With check-in on, players check in once for the event. A match opens when enough players from each team are in. On the event page, staff can press **Check in for them** next to anyone who can't. **Admin: start this match now** starts one match without waiting.

## Running the matches
On the event's **Fixtures & results** tab:
- **Pause** / **Resume** stops and restarts reporting.
- **Open matches now** opens reporting before the start time.
- **Open finals now** ends the break early (or opens the finals if the break is set to wait for an admin).
- **Stuck matches** (disputed, one-sided or no votes for too long) are listed there and on the bell.

## Disputes and no-shows
When teams vote different scores, look at the screenshots in the match thread or result page and save the right score. For a no-show, open the result and record a **forfeit**: the other team wins 2–0 (10–0, 10–0) with no stats.

# Results and stats
## Enter or correct a result
Fixtures & results → the match → result page. Enter the set scores (deciding sets only show when needed), pick the **MVP**, or record a forfeit. Player votes are listed with **Use** to copy one. Saving also closes any open result fixes for that match.

## Read stats from a screenshot
On the result page, press **Read stats** on the end-of-match screenshot. Check the review table: match each line to a player (yellow = check this number), fix any numbers, then **Use these stats** and save. In-game names are remembered, so next time players are matched automatically. The bot usually reads screenshots from match threads by itself.

## Publish stats
**📸 Stats** (/admin/stats) groups matches:
- **✅ Ready to publish:** press **Publish all**.
- **🚩 Check before publishing:** numbers that look too high, or edited by a player. Check, then **Publish anyway**.
- **⏳ Waiting:** no stats yet. If there's no screenshot and no way to get one, **Publish with no stats** keeps the score and shows "No stats".

## Result fixes
Players send fixes with **🛠 Fix this result**. If both teams send the same score it changes by itself. Otherwise it's in **Requests → Result fixes**: correct the result (saving closes the fix), or press **Done** to close it without changes.

# After an event
## Finishing up
- Publish any stats still waiting, and clear result fixes.
- Set **Status** to finished if it doesn't show finished by itself (the podium is worked out from the final, or the table).
- Trophies, podiums and the Champions card update by themselves.
- 🥇 award roles move to this event's stat leaders as soon as its stats are in.
- **🤖 Bot → 🧹 Clear an event's threads** tidies its Discord match threads (this deletes them).

# Clubs and players
## Approve clubs and claims
**Requests:** approve or decline new clubs (players they invited get offers when you approve) and profile claims (check it's really them). Old leave requests can be cancelled there too.

## Edit a club or player
**👥 Teams & players:** names, colours, logos, squads, managers, numbers, in-game names. You can move anyone between clubs at any time, even during events. Remove pictures or text that break the rules here.

## Staff badges
In a player's form, set **Staff** to Admin, Mod or Caster. It's a badge only: admin access comes from the Discord Staff role.

## Old pictures
**Move images** on Teams & players copies older pictures from the old image store to Firebase. Only needed once per old picture.

# Discord bot
## Bot control panel
**🤖 Bot** shows whether the bot is online, and lets you switch features on and off (match threads, stats reading, ranked, stat roles, club roles, characters, welcomes) and change timings. Feature changes restart the bot; timings apply straight away.

## Staff desk on Discord
**#staff-desk** (staff only) gets a card for each quick job, every 90 seconds:
- **🆕 New club:** ✅ Approve (founder becomes manager, their invites are sent) or ❌ Decline.
- **🎭 New character:** ✅ Approve (on the Home court) or ❌ Deny.
- **🛠 Result fix:** ✅ Use this score (when the fix has a new score) or ❌ Close, no change. **Open result** goes to the site for anything bigger.
- **📸 Stats waiting:** how many matches need a stats check, with a link to the site.
Pressing a button saves straight to the site and the card shows who did it. Anything dealt with on the site is marked done on Discord too. Every change is in the audit log with the staff member's name.

## Quick fixes
- **🎨 Sync roles now:** fixes everyone's club and award roles.
- **🔄 Check match threads now** and **🔒 Close all open threads**.
- **📌 Post the queue cards again** if a card went missing.
- **♻️ Restart the bot:** back in about 15 seconds; ready checks in progress are cancelled.

## Pickup games
The **🏐 Pickup** section shows the live queue, ready checks, drafts and games. Start a game, cancel a match, set or correct a result, or remove someone from the queue. Discord's **/pickup** admin commands do the same, plus **/pickup setmode** to fix the mode.

## Roles on Discord
Club roles (club colour), Captain (managers), award roles (🥇 1st per stat, from the last event with stats), the TEAM / AWARDS divider roles and site admin from the Staff role are all automatic. Club logos will show after names once the server reaches boost level 2.

# Help pages and characters
## Edit the FAQ and rules
**📜 FAQ & rules** (/admin/help). Formatting: \`# Section\`, \`## Question\` (FAQ), \`- bullet\`, \`**bold**\`, \`[link](https://…)\`. Saving replaces the starter text for everyone. The **Roles** tab and this guide aren't edited here.

## Community characters
The bot picks up pictures from #in-game-characters. **🎭 Characters** lists them as waiting: **Approve** puts them on the Home court, **Deny** keeps them off. You can remove any character later and put it back.

# Troubleshooting
## Fixtures didn't save at the start
No admin was online at the lock. Open the event's Fixtures & results tab (that saves them) or press **Lock fixtures now**.

## A player's stats aren't matched to them
Open the result, set the line to the right player and save. That remembers their in-game name for next time. Also check their in-game name in their player form.

## Someone's Discord roles are wrong
Their profile needs their Discord account (they signed in with Discord). Then **🤖 Bot → 🎨 Sync roles now**.

## Someone needs admin access
Give them the **Staff** role on Discord. It takes up to 5 minutes, then they sign in to the site with Discord.
`;

export async function render() {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };
  const groups = parseFaq(GUIDE);
  return `
    <div class="admin-root">
      ${adminBar(gate.user, gate.admin, '/admin/guide')}
      <div class="page-head"><h1>📘 Admin guide</h1><p class="muted">How to do every admin job, step by step. Tap a job to open it, or search.</p></div>
      <form class="stats-search guide-search" role="search" data-guide-search-form>
        <span aria-hidden="true">🔎</span>
        <input type="search" placeholder="Search the guide (e.g. forfeit, bye, stats)" autocomplete="off" data-guide-search aria-label="Search the guide">
      </form>
      <nav class="faq-jump" aria-label="Guide sections">${groups.map((g, i) => `<a href="#guide-${i}">${esc(g.heading)}</a>`).join('')}</nav>
      <div class="stack">
        ${groups.map((g, i) => `
          <section class="faq-group" id="guide-${i}" data-guide-group>
            <h2>${esc(g.heading)}</h2>
            <div class="panel flush faq">${g.items.map((it) => `
              <details data-guide-item data-text="${esc(`${it.q} ${it.a}`.toLowerCase())}"><summary>${esc(it.q)}</summary><div class="prose">${markdown(it.a, { headingLevel: 3 })}</div></details>`).join('')}
            </div>
          </section>`).join('')}
        <p class="panel muted" data-guide-empty hidden>Nothing in the guide matches that. Try another word.</p>
      </div>
    </div>`;
}

export function mount(root) {
  bindAuthActions(root);
  const input = root.querySelector('[data-guide-search]');
  if (!input) return;
  input.form.addEventListener('submit', (e) => e.preventDefault());
  input.addEventListener('input', () => {
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const d of root.querySelectorAll('[data-guide-item]')) {
      const hit = words.every((w) => d.dataset.text.includes(w));
      d.hidden = !hit;
      d.open = Boolean(words.length) && hit;
      if (hit) shown++;
    }
    for (const g of root.querySelectorAll('[data-guide-group]')) g.hidden = ![...g.querySelectorAll('[data-guide-item]')].some((d) => !d.hidden);
    root.querySelector('[data-guide-empty]').hidden = shown > 0;
  });
}
