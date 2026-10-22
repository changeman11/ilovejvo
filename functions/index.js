// I<3JVO billing kill switch (Cloud Functions, Blaze plan).
//
// Your budget sends spending updates to the Pub/Sub topic "billing-killswitch". If this month's
// cost reaches the budget, this turns billing OFF for the project, so nothing more can be charged.
// The site then stops working (images, database writes past the free amounts) until you turn
// billing back on: Firebase console -> Usage and billing -> link the billing account again.
//
// Setup (once): see GO-LIVE.md, "Billing kill switch".
// Needs: the budget connected to the topic, and the function's service account given the
// "Project Billing Manager" role on the project (so it's allowed to switch billing off).

import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { logger } from 'firebase-functions';
import { CloudBillingClient } from '@google-cloud/billing';
import { shouldCutBilling, describe } from './killswitch.js';

const projectId = process.env.GCLOUD_PROJECT;

export const billingKillSwitch = onMessagePublished(
  { topic: 'billing-killswitch', region: 'us-central1', retry: false, memory: '256MiB', maxInstances: 1 },
  async (event) => {
    const update = event.data.message.json ?? {};
    if (!shouldCutBilling(update)) {
      logger.info(`Under budget, nothing to do. ${describe(update)}`);
      return;
    }
    const billing = new CloudBillingClient();
    const name = `projects/${projectId}`;
    const [info] = await billing.getProjectBillingInfo({ name });
    if (!info.billingEnabled) {
      logger.info(`Billing is already off. ${describe(update)}`);
      return;
    }
    await billing.updateProjectBillingInfo({ name, projectBillingInfo: { billingAccountName: '' } });
    logger.warn(`KILL SWITCH: spending reached the budget, billing turned OFF for ${projectId}. ${describe(update)}`);
  },
);
