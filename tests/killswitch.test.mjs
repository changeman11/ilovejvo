import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldCutBilling, describe } from '../functions/killswitch.js';

test('cuts billing only once the month’s cost reaches the budget', () => {
  assert.equal(shouldCutBilling({ costAmount: 0, budgetAmount: 5 }), false);
  assert.equal(shouldCutBilling({ costAmount: 4.99, budgetAmount: 5 }), false);
  assert.equal(shouldCutBilling({ costAmount: 5, budgetAmount: 5 }), true);
  assert.equal(shouldCutBilling({ costAmount: 37.2, budgetAmount: 5 }), true);
});

test('ignores broken or test messages instead of cutting billing', () => {
  assert.equal(shouldCutBilling(null), false);
  assert.equal(shouldCutBilling({}), false);
  assert.equal(shouldCutBilling({ costAmount: 10 }), false);
  assert.equal(shouldCutBilling({ costAmount: 10, budgetAmount: 0 }), false);
  assert.equal(shouldCutBilling({ costAmount: 'lots', budgetAmount: 5 }), false);
});

test('log line', () => {
  assert.equal(describe({ budgetDisplayName: 'I<3JVO', costAmount: 1.5, budgetAmount: 5, currencyCode: 'AUD' }), 'I<3JVO: 1.50 of 5.00 AUD');
});
