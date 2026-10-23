// Keeps ratings and games in the site's Firestore database (STORE=firebase), so the I<3JVO
// website can show them later. Collections (public to read, only the bot can write):
//   pickupRatings/{discordId}  one per player: rating, games, wins, losses, form
//   pickupGames/g{number}      one per game: teams, captains' reports, winner, rating changes
//   pickupMeta/bot             last game number, the queue message's id
//
// All ratings are read once when the bot starts and then kept in memory, so commands like
// /leaderboard cost no database reads. A game result is one write per player plus one.
import { FirestoreRest } from './firestore-rest.js';
import { newRecord, ranked } from '../logic/ratings.js';

const META = 'pickupMeta/bot';

export class FirestoreStore {
  constructor({ firebase, startRating = 1000, log = console, rest = null }) {
    this.rest = rest ?? new FirestoreRest(firebase);
    this.startRating = startRating;
    this.log = log;
    this.cache = new Map();
    this.meta = { lastGame: 0 };
  }

  async init() {
    if (this.rest.emulator) await this.rest.bootstrapEmulator();
    else await this.rest.signIn();
    for (const { id, data } of await this.rest.list('pickupRatings')) this.cache.set(id, { ...data, discordId: id });
    this.meta = { lastGame: 0, ...(await this.rest.get(META)) };
    this.log.info?.(`[store] Firestore (${this.rest.projectId}${this.rest.emulator ? ', emulator' : ''}): ${this.cache.size} rated players, last game #${this.meta.lastGame}`);
  }

  rating(id) {
    return structuredClone(this.cache.get(id)) ?? newRecord(id, '', this.startRating);
  }

  ratings() {
    return ranked([...this.cache.values()].map((r) => structuredClone(r)));
  }

  nextGameNumber() {
    return this.meta.lastGame + 1;
  }

  getMeta(key) {
    return this.meta[key];
  }

  async setMeta(key, value) {
    await this.rest.commit([{ path: META, data: { [key]: value }, mask: [key] }]);
    this.meta[key] = value;
  }

  async createGame(game) {
    await this.rest.commit([
      { path: `pickupGames/${game.id}`, data: game, mustNotExist: true },
      { path: META, data: { lastGame: game.number }, mask: ['lastGame'] },
    ]);
    this.meta.lastGame = Math.max(this.meta.lastGame, game.number);
  }

  async saveGame(game) {
    await this.rest.commit([{ path: `pickupGames/${game.id}`, data: game }]);
  }

  async saveResult(game, records) {
    await this.rest.commit([
      { path: `pickupGames/${game.id}`, data: game },
      ...records.map((r) => ({ path: `pickupRatings/${r.discordId}`, data: r })),
    ]);
    for (const r of records) this.cache.set(r.discordId, structuredClone(r));
  }

  async getGame(id) {
    return this.rest.get(`pickupGames/${id}`);
  }

  async openGames() {
    return (await this.rest.query('pickupGames', 'open', true)).map((d) => d.data);
  }
}
