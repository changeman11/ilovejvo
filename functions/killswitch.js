// The billing kill switch's decision, kept free of Google libraries so it can be tested.
//
// Google Cloud sends a budget update to our Pub/Sub topic several times a day, shaped like:
//   { budgetDisplayName, costAmount, budgetAmount, currencyCode, costIntervalStart, alertThresholdExceeded }
// costAmount is what the project has cost so far this month.

// Turn billing off once this month's cost reaches the budget (e.g. $5 of a $5 budget).
export function shouldCutBilling(update) {
  const cost = Number(update?.costAmount);
  const budget = Number(update?.budgetAmount);
  if (!Number.isFinite(cost) || !Number.isFinite(budget) || budget <= 0) return false;
  return cost >= budget;
}

// One line for the logs.
export function describe(update) {
  const cur = update?.currencyCode ?? '';
  return `${update?.budgetDisplayName ?? 'budget'}: ${Number(update?.costAmount ?? 0).toFixed(2)} of ${Number(update?.budgetAmount ?? 0).toFixed(2)} ${cur}`.trim();
}
