// "More" menu for phones (the bottom bar only fits five tabs).

export const title = 'More';

export function loading() {
  return '';
}

const LINKS = [
  ['/teams', 'Teams', 'Every team and roster'],
  ['/playoffs', 'Playoffs', 'Bracket and the playoff picture'],
  ['/awards', 'Awards & Records', 'Prizes, records and milestones'],
  ['/admin', 'Admin', 'For league admins'],
];

export async function render() {
  return `
    <section class="hero"><h1>More</h1></section>
    <nav class="more-list">
      ${LINKS.map(([href, name, sub]) => `<a href="${href}" data-link><b>${name}</b><span class="muted">${sub}</span><span aria-hidden="true">›</span></a>`).join('')}
    </nav>`;
}
