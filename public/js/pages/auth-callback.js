// Discord sends people back here after they approve sign-in.

import { finishDiscordSignIn } from '../auth.js';
import { navigate } from '../nav.js';
import { notice } from '../ui.js';

export const title = 'Signing in';

export function loading() {
  return notice('Signing you in…', ' Checking with Discord.');
}

export async function render() {
  try {
    const next = await finishDiscordSignIn();
    queueMicrotask(() => navigate(next, { replace: true }));
    return notice('Signed in', ' Taking you there…');
  } catch (err) {
    return `${notice('Sign-in didn’t work', ` ${err.message}`)}
      <p style="text-align:center;margin-top:16px"><a class="btn" href="/admin" data-link>Try again</a></p>`;
  }
}
