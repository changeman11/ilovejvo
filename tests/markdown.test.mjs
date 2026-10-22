import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdown, inline, parseFaq } from '../public/js/rules/markdown.js';

test('anything typed is escaped', () => {
  assert.equal(markdown('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(inline('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

test('only web and site links become links', () => {
  assert.match(inline('[join](https://discord.gg/abc)'), /<a href="https:\/\/discord.gg\/abc" target="_blank" rel="noopener">join<\/a>/);
  assert.match(inline('[fixtures](/fixtures)'), /<a href="\/fixtures" data-link>fixtures<\/a>/);
  assert.doesNotMatch(inline('[x](javascript:alert(1))'), /<a /);
  assert.doesNotMatch(inline('[x](https://a.com" onclick="y)'), /onclick="/);
});

test('headings, lists, paragraphs, bold', () => {
  const html = markdown('# Matches\nBest of **3**.\nSets to 10.\n\n- win by 2\n- no cap\n\n1. one\n2. two');
  assert.equal(html, '<h2>Matches</h2>\n<p>Best of <strong>3</strong>.<br>Sets to 10.</p>\n<ul><li>win by 2</li><li>no cap</li></ul>\n<ol><li>one</li><li>two</li></ol>');
  assert.match(markdown('## Sub', { headingLevel: 2 }), /<h3>Sub<\/h3>/);
  assert.match(inline('an *italic* word'), /an <em>italic<\/em> word/);
});

test('FAQ questions and groups', () => {
  const faq = parseFaq('# Basics\n## How long is a match?\nBest of 3.\n\nSets to 10.\nQ: Forfeits?\nA: 2–0.\n# Teams\n## Max size?\n4');
  assert.equal(faq.length, 2);
  assert.equal(faq[0].heading, 'Basics');
  assert.deepEqual(faq[0].items.map((i) => i.q), ['How long is a match?', 'Forfeits?']);
  assert.equal(faq[0].items[1].a.trim(), '2–0.');
  assert.equal(faq[1].items[0].q, 'Max size?');
  assert.deepEqual(parseFaq(''), []);
});
