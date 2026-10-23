// The game-style menu cards (desktop): the big menu on Home, and the same cards kept open
// down the left side on every other page, with the current page's card in yellow.

import { discordLogo } from './pages/discord-cta.js';
import { steamUrl } from './config.js';

const ICONS = {
  fixtures: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  stats: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  events: '<path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"/>',
  teams: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2.5 19a5.5 5.5 0 0 1 11 0M12 19a4.5 4.5 0 0 1 9.5 0"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  heart: '<path d="M12 20s-7-4.3-9-8.7C1.6 8 3.6 4.6 7 4.6c2 0 3.3 1.1 5 3 1.7-1.9 3-3 5-3 3.4 0 5.4 3.4 4 6.7-2 4.4-9 8.7-9 8.7z"/>',
  club: '<path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 3.8M12 17.2v.1"/>',
  pickup: '<circle cx="12" cy="12" r="9"/><path d="M12 3c-2.5 3-2.5 15 0 18M3.5 9c4 1.5 13 1.5 17 0M5 17.5c3-3 11-3 14 0"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
};
const icon = (name, cls) => `<span class="gm-icon ${cls}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg></span>`;
const discordIcon = () => `<span class="gm-icon i-white">${discordLogo()}</span>`;

// state: 'guest' | 'new' | 'player'. active: the current section ('/fixtures', ...), or null on Home.
// On Home the profile card is the yellow "featured" one; elsewhere the current page's card is yellow.
export function menuCards(state, { active = null, hasClub = false } = {}) {
  const onHome = active === null;
  const card = ({ href, iconHtml, title, sub, section, signIn = false }) => {
    const on = onHome ? section === '/me' : active === section;
    const cls = `gm-card${on ? ' gm-feature' : ''}`;
    const inner = `${iconHtml}<span class="gm-text"><b>${title}</b><small>${sub}</small></span>`;
    return signIn
      ? `<button class="${cls}" type="button" data-discord-signin>${inner}</button>`
      : `<a class="${cls}" href="${href}" data-link${on && !onHome ? ' aria-current="page"' : ''}>${inner}</a>`;
  };
  const profile = state === 'guest'
    ? card({ iconHtml: discordIcon(), title: 'make your profile!', sub: 'sign in with discord · banners, gifs, badges &amp; your team', section: '/me', signIn: true })
    : state === 'new'
      ? card({ href: '/me', iconHtml: discordIcon(), title: 'finish your profile!', sub: 'one step to claim your stats', section: '/me' })
      : card({ href: '/me', iconHtml: icon('me', 'i-white'), title: 'my profile', sub: 'customise banners, gifs &amp; badges', section: '/me' });
  return `
    ${profile}
    ${card({ href: '/club', iconHtml: icon(hasClub ? 'club' : 'lock', hasClub ? 'i-orange' : 'i-grey'), title: 'club hub', sub: hasClub ? 'your squad, invites &amp; club page' : 'locked · join or start a club', section: '/club' })}
    ${card({ href: '/fixtures', iconHtml: icon('fixtures', 'i-blue'), title: 'fixtures', sub: 'upcoming matches &amp; results', section: '/fixtures' })}
    ${card({ href: '/stats', iconHtml: icon('stats', 'i-green'), title: 'stats', sub: 'leaderboards &amp; player stats', section: '/stats' })}
    ${card({ href: '/events', iconHtml: icon('events', 'i-pink'), title: 'events', sub: 'exhibition nights &amp; tournaments', section: '/events' })}
    ${card({ href: '/teams', iconHtml: icon('teams', 'i-purple'), title: 'teams &amp; players', sub: 'every club and player in jvo', section: '/teams' })}
    ${card({ href: '/pickup', iconHtml: icon('pickup', 'i-orange'), title: 'pickup', sub: 'random games, drafts &amp; elo', section: '/pickup' })}
    <div class="gm-pills">
      <a class="gm-pill" href="${steamUrl}" target="_blank" rel="noopener">${icon('heart', 'i-white sm')}<span>get just volleyball on steam</span></a>
      <a class="gm-pill gm-help${active === '/help' ? ' on' : ''}" href="/help" data-link${active === '/help' ? ' aria-current="page"' : ''}>${icon('help', 'i-white sm')}<span>faq &amp; rules</span></a>
    </div>`;
}
