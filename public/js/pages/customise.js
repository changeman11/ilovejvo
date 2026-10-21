// The "customise your profile" form, shared by players (Me page) and team managers (Manage page):
// picture/logo, banner and page background (GIFs welcome), tagline, bio, theme colour,
// showcase stats and social links. The security rules check every field again on save.

import { esc } from '../ui.js';
import { mediaUrl, MEDIA, prepareImage, uploadImage, deleteImage, FriendlyError } from '../media.js';
import { uploadsReady } from '../config.js';
import { SOCIALS, showcaseOptions, DEFAULT_SHOWCASE, validTheme } from './profile-parts.js';

export const IMAGE_KINDS = { team: ['logo', 'banner', 'background'], player: ['avatar', 'banner', 'background'] };
const pathField = (k) => `${k}Path`;

function imageField(k, current) {
  const spec = MEDIA[k];
  const url = mediaUrl(current);
  return `
    <div class="img-field">
      <span class="img-label">${spec.label}</span>
      <div class="img-preview img-${k}" data-preview="${k}">${url ? `<img src="${esc(url)}" alt="">` : '<span class="muted small">None yet</span>'}</div>
      ${uploadsReady ? `
        <div class="img-actions">
          <label class="btn btn-sm">Choose…<input type="file" name="file-${k}" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
          ${current ? `<label class="check small"><input type="checkbox" name="remove-${k}"> Remove</label>` : ''}
        </div>` : ''}
      <span class="muted small">${spec.hint} GIFs up to ${spec.maxMb} MB.</span>
    </div>`;
}

// kind: 'team' | 'player'. fallbackTheme: colour used until they pick one.
export function customiseFields(kind, doc, statDefs, fallbackTheme = '#1438d8') {
  const picked = doc.showcase?.length ? doc.showcase : DEFAULT_SHOWCASE[kind];
  const options = showcaseOptions(kind, statDefs);
  const who = kind === 'team' ? 'the team' : 'you';
  return `
    <fieldset class="cz">
      <legend>Images</legend>
      ${uploadsReady ? '' : '<p class="muted small" style="margin-bottom:8px">Image uploads are being switched on. Everything else works now.</p>'}
      <div class="img-grid">${IMAGE_KINDS[kind].map((k) => imageField(k, doc[pathField(k)])).join('')}</div>
    </fieldset>
    <fieldset class="cz">
      <legend>Words &amp; colour</legend>
      <label class="field"><span>Tagline</span><input type="text" name="tagline" maxlength="80" value="${esc(doc.tagline ?? '')}" placeholder="One line under the name"></label>
      <label class="field"><span>Bio</span><textarea name="bio" rows="4" maxlength="1000" placeholder="Tell people about ${who}">${esc(doc.bio ?? '')}</textarea></label>
      <label class="field"><span>Theme colour (colours the whole profile)</span><input type="color" name="theme" value="${esc(validTheme(doc.theme) ?? validTheme(fallbackTheme) ?? '#1438d8')}" class="color-input"></label>
    </fieldset>
    <fieldset class="cz">
      <legend>Showcase</legend>
      <p class="muted small" style="margin-bottom:8px">Up to 4 stats shown big at the top of the profile.</p>
      <div class="field-row">${[0, 1, 2, 3].map((i) => `
        <label class="field"><span class="sr-only">Showcase ${i + 1}</span><select name="show${i}">
          <option value="">(empty)</option>
          ${options.map((o) => `<option value="${esc(o.id)}"${picked[i] === o.id ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select></label>`).join('')}
      </div>
    </fieldset>
    <fieldset class="cz">
      <legend>Links</legend>
      ${SOCIALS.map((s) => `<label class="field"><span>${s.label}</span><input type="url" name="social-${s.key}" inputmode="url" placeholder="${s.hint}" value="${esc(doc.socials?.[s.key] ?? '')}"></label>`).join('')}
    </fieldset>`;
}

// Shows a preview as soon as a file is picked. Bind once per page draw.
export function bindImagePreviews(root) {
  root.addEventListener('change', (e) => {
    const input = e.target.closest('input[type=file][name^="file-"]');
    if (!input) return;
    const box = root.querySelector(`[data-preview="${input.name.slice(5)}"]`);
    const file = input.files?.[0];
    if (box && file) box.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="">`;
  });
}

function readLinks(form) {
  const socials = {};
  for (const s of SOCIALS) {
    let v = form.querySelector(`[name="social-${s.key}"]`)?.value.trim() ?? '';
    if (v && !/^https?:\/\//i.test(v)) v = `https://${v}`;
    if (v.startsWith('http://')) v = `https://${v.slice(7)}`;
    if (v) {
      try {
        new URL(v); // eslint-disable-line no-new
      } catch {
        throw new FriendlyError(`${s.label}: that doesn’t look like a link.`);
      }
      if (v.length > 200) throw new FriendlyError(`${s.label}: that link is too long.`);
    }
    socials[s.key] = v;
  }
  return socials;
}

// Reads the form, uploads any new images, then calls save(changes) once.
// If the save fails, new uploads are removed again; after it works, replaced images are removed.
// owner: 'teams' | 'players'
export async function saveCustomise({ form, kind, owner, id, doc, extra = {}, save, admin = false }) {
  const val = (n) => form.querySelector(`[name="${n}"]`)?.value.trim() ?? '';
  const showcase = [...new Set([0, 1, 2, 3].map((i) => val(`show${i}`)).filter(Boolean))];
  const changes = {
    ...extra,
    tagline: val('tagline') || null,
    bio: val('bio'),
    theme: val('theme') || null,
    showcase,
    socials: readLinks(form),
  };

  // Check every chosen file first, so a bad one stops the save before anything uploads.
  const chosen = [];
  for (const k of IMAGE_KINDS[kind]) {
    const file = form.querySelector(`[name="file-${k}"]`)?.files?.[0];
    if (file) chosen.push({ k, image: await prepareImage(file, k) });
  }
  const uploaded = [];
  const oldPaths = [];
  try {
    for (const { k, image } of chosen) {
      const path = await uploadImage({ owner, id, kind: k, image, admin });
      uploaded.push(path);
      if (doc[pathField(k)]) oldPaths.push(doc[pathField(k)]);
      changes[pathField(k)] = path;
    }
    for (const k of IMAGE_KINDS[kind]) {
      if (changes[pathField(k)] || !form.querySelector(`[name="remove-${k}"]`)?.checked) continue;
      changes[pathField(k)] = null;
      oldPaths.push(doc[pathField(k)]);
    }
    await save(changes);
  } catch (err) {
    await Promise.all(uploaded.map((p) => deleteImage(p, { admin })));
    throw err;
  }
  await Promise.all(oldPaths.map((p) => deleteImage(p, { admin })));
}
