// Made-up exhibition nights and tournaments for local testing. Every date is TBD.
// One draft (unpublished) to check the public can't see drafts.

export function buildSampleEvents() {
  const base = {
    date: null,
    timeTbd: true,
    status: 'upcoming',
    streamUrl: null,
    signupUrl: null,
    format: null,
    teamSize: null,
    prize: null,
    createdBy: 'seed',
    updatedBy: 'seed',
  };
  const at = (n) => new Date(Date.UTC(2026, 9, 1 + n));
  return [
    {
      id: 'exhibition-launch-night',
      ...base,
      type: 'exhibition',
      title: 'Launch Night Showmatches',
      summary: 'The first I<3JVO exhibition night: a few 4v4 showmatches between community squads, casted live.',
      details: 'Come watch, cheer and meet the community.\n\nTeams and casters will be announced in the Discord closer to the night.',
      published: true,
      createdAt: at(1),
    },
    {
      id: 'exhibition-all-stars',
      ...base,
      type: 'exhibition',
      title: 'All-Stars Exhibition',
      summary: 'Community-voted all-star teams go head to head.',
      details: 'Voting opens in the Discord before the night.',
      published: true,
      createdAt: at(2),
    },
    {
      id: 'tournament-opening-cup',
      ...base,
      type: 'tournament',
      title: 'Opening Cup',
      summary: 'Our first open 4v4 tournament. Bring a team of four (plus subs).',
      details: 'Sign-ups open soon.\n\nFull rules and the bracket will be posted once team numbers are known.',
      format: 'Groups, then single elimination',
      teamSize: 4,
      prize: 'Discord champion role',
      published: true,
      createdAt: at(3),
    },
    {
      id: 'tournament-draft-idea',
      ...base,
      type: 'tournament',
      title: 'Summer Invitational (draft)',
      summary: 'Still being planned. Not public yet.',
      details: '',
      teamSize: 4,
      published: false,
      createdAt: at(4),
    },
  ];
}
