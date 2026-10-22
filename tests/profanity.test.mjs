import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkText, censor, SEVERE_PATTERN } from '../public/js/rules/profanity.js';

test('clean messages pass, including look-alike innocent words', () => {
  for (const ok of ['good game everyone!', 'gg wp', 'Niger is a country', 'that raccoon spiked it', 'snigger', 'Scunthorpe? no: assist king', 'class act', 'pass it', 'chinkchester city', 'cockpit', 'peacock', 'grass', 'shiitake']) {
    assert.equal(checkText(ok).level, 'none', ok);
  }
});

test('mild swearing is detected, with tricks undone', () => {
  for (const bad of ['fuck', 'what the FUCK', 'fuuuuck', 'f*ck off', 'sh1t', 'bullshit', 'b!tch', 'f u c k', 'f.u.c.k this', 'ass', 'wtf']) {
    assert.equal(checkText(bad).level, 'mild', bad);
  }
});

test('slurs are severe', () => {
  for (const bad of ['n1gger', 'NIGGA', 'faggot', 'f4g', 'retard', 'you r3tarded', 'tranny']) {
    assert.equal(checkText(bad).level, 'severe', bad);
  }
});

test('censor stars out swear words and keeps the rest', () => {
  assert.equal(censor('holy shit!'), 'holy s***!');
  assert.equal(censor('fucking hell'), 'f****** hell');
  assert.equal(censor('nice block'), 'nice block');
  assert.equal(censor('f u c k off'), 'f*** off');
});

test('the database rules use the same slur pattern', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const escaped = SEVERE_PATTERN.replace(/\\/g, '\\\\');
  assert.ok(rules.includes(escaped), 'firestore.rules should contain SEVERE_PATTERN (with doubled backslashes)');
});
