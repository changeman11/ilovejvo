// Keeps ratings and games in one JSON file (STORE=file). Good for trying the bot on your PC.
// With no file path it only keeps things in memory (used by the tests).
//
// Every store has the same methods (see FirestoreStore too):
//   init(), rating(id), ratings(), nextGameNumber(), getMeta(key), setMeta(key, value),
//   createGame(game), saveGame(game), saveResult(game, records), getGame(id), openGames()
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { newRecord, ranked } from '../logic/ratings.js';

const copy = (value) => (value == null ? value : structuredClone(value));

export class FileStore {
  constructor({ path = null, startRating = 1000 } = {}) {
    this.path = path;
    this.startRating = startRating;
    this.data = { ratings: {}, games: {}, meta: { lastGame: 0 } };
    this.writing = Promise.resolve();
  }

  async init() {
    if (!this.path) return;
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8'));
      this.data = { ratings: saved.ratings ?? {}, games: saved.games ?? {}, meta: { lastGame: 0, ...saved.meta } };
    } catch (err) {
      if (err.code !== 'ENOENT') throw new Error(`Couldn't read ${this.path}: ${err.message}`);
    }
  }

  rating(id) {
    return copy(this.data.ratings[id]) ?? newRecord(id, '', this.startRating);
  }

  ratings() {
    return ranked(Object.values(this.data.ratings).map(copy));
  }

  nextGameNumber() {
    return this.data.meta.lastGame + 1;
  }

  getMeta(key) {
    return this.data.meta[key];
  }

  async setMeta(key, value) {
    this.data.meta[key] = value;
    await this.save();
  }

  async createGame(game) {
    if (this.data.games[game.id]) throw new Error(`Game ${game.id} already exists`);
    this.data.games[game.id] = copy(game);
    this.data.meta.lastGame = Math.max(this.data.meta.lastGame, game.number);
    await this.save();
  }

  async saveGame(game) {
    this.data.games[game.id] = copy(game);
    await this.save();
  }

  // The game and its players' new ratings, saved together.
  async saveResult(game, records) {
    this.data.games[game.id] = copy(game);
    for (const r of records) this.data.ratings[r.discordId] = copy(r);
    await this.save();
  }

  async getGame(id) {
    return copy(this.data.games[id]) ?? null;
  }

  async openGames() {
    return Object.values(this.data.games).filter((g) => g.open).map(copy);
  }

  // Write to a temporary file, then swap it in, so a crash mid-write can't leave half a file.
  save() {
    if (!this.path) return Promise.resolve();
    const text = JSON.stringify(this.data, null, 1);
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(`${this.path}.tmp`, text);
      await rename(`${this.path}.tmp`, this.path);
    });
    return this.writing;
  }
}
