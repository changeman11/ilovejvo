// The slash commands, in Discord's JSON shape. They're registered on your server each time the
// bot starts, so changes show up straight away.
import { modeLabel } from './logic/modes.js';

const SUB = 1;
const STRING = 3;
const INTEGER = 4;
const USER = 6;

export function commandList(config) {
  const testing = config.allowTestPlayers
    ? [
        {
          type: SUB,
          name: 'testfill',
          description: 'Testing only: add pretend players to the queue',
          options: [{ type: INTEGER, name: 'count', description: 'How many (1-11)', required: true, min_value: 1, max_value: 11 }],
        },
        { type: SUB, name: 'testclear', description: 'Testing only: remove the pretend players from the queue' },
      ]
    : [];
  return [
    { name: 'queue', description: "See who's ready for a pickup game" },
    {
      name: 'elo',
      description: 'Show a pickup Elo rating',
      options: [{ type: USER, name: 'player', description: 'Whose rating (leave empty for yours)', required: false }],
    },
    { name: 'leaderboard', description: 'The top pickup Elo ratings' },
    {
      name: 'pickup',
      description: 'Pickup admin tools',
      options: [
        {
          type: SUB,
          name: 'start',
          description: "Start a game now with the players who are ready (don't wait for the countdown)",
          options: [
            {
              type: INTEGER,
              name: 'mode',
              description: 'Team size; leave empty for a random one that fits',
              required: false,
              choices: config.modes.map((n) => ({ name: modeLabel(n), value: n })),
            },
          ],
        },
        {
          type: SUB,
          name: 'result',
          description: 'Set or change a game result (Elo is recalculated)',
          options: [
            { type: INTEGER, name: 'game', description: 'Game number (on the game card)', required: true, min_value: 1 },
            {
              type: STRING,
              name: 'winner',
              description: 'Who won',
              required: true,
              choices: [
                { name: 'Team 1', value: 'a' },
                { name: 'Team 2', value: 'b' },
                { name: 'Cancel the game (no Elo change)', value: 'cancel' },
              ],
            },
          ],
        },
        ...(config.clubRoles ? [{ type: SUB, name: 'syncroles', description: 'Update club roles from the I<3JVO site now' }] : []),
        ...testing,
      ],
    },
  ];
}
