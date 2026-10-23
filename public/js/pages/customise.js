// The "customise your profile" form, shared by players (Me page) and team managers (Manage page):
// picture/logo, banner and page background (GIFs welcome), tagline, bio, theme colour,
// showcase stats and social links. The security rules check every field again on save.

import { esc, frameStyle, validFrame } from '../ui.js';
import { mediaUrl, MEDIA, prepareImage, uploadImage, deleteImage, FriendlyError } from '../media.js';
import { uploadsReady } from '../config.js';
import { SOCIALS, showcaseOptions, DEFAULT_SHOWCASE, validTheme } from './profile-parts.js';

export const IMAGE_KINDS = { team: ['logo', 'banner', 'background'], player: ['avatar', 'banner', 'background'] };
const pathField = (k) => `${k}Path`;
const frameField = (k) => `${k}Frame`;

const CENTRE = { x: 50, y: 50, zoom: 1 };
const EMPTY = '<span class="muted small">None yet</span>';

// One picture: a preview shaped like where it shows (drag to move, slider to zoom), Choose and Remove.
function imageField(k, current, frame) {
  const spec = MEDIA[k];
  const url = mediaUrl(current);
  const f = validFrame(frame) ? frame : CENTRE;
  return `
    <div class="img-field" data-img-field="${k}">
      <span class="img-label">${spec.label}</span>
      <div class="img-preview img-${k}" data-preview="${k}">${url ? `<img src="${esc(url)}" alt="" draggable="false" style="${frameStyle(f)}">` : EMPTY}</div>
      <input type="hidden" name="frame-${k}" value="${esc(JSON.stringify(f))}">
      <input type="hidden" name="remove-${k}" value="">
      <div class="img-adjust" ${url ? '' : 'hidden'}>
        <label class="img-zoom"><span>Zoom</span><input type="range" name="zoom-${k}" min="1" max="4" step="0.05" value="${f.zoom}" aria-label="${esc(spec.label)} zoom"></label>
        <button type="button" class="link-btn small" data-img-centre>Centre</button>
        <span class="muted small">Drag the picture to move it.</span>
      </div>
      ${uploadsReady ? `
        <div class="img-actions">
          <label class="btn btn-sm">Choose…<input type="file" name="file-${k}" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
          <button type="button" class="btn btn-sm btn-danger" data-img-remove ${url ? '' : 'hidden'}>✕ Remove</button>
        </div>` : ''}
      <span class="muted small">${spec.hint} GIFs up to ${spec.gifInMb} MB (shrunk to fit).</span>
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
      <div class="img-grid">${IMAGE_KINDS[kind].map((k) => imageField(k, doc[pathField(k)], doc[frameField(k)])).join('')}</div>
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

// The picture editor: preview as soon as a file is picked, drag to move, slider to zoom,
// Centre, and Remove. Bind once per page draw.
export function bindImagePreviews(root) {
  const parts = (el) => {
    const field = el.closest('[data-img-field]');
    if (!field) return null;
    const k = field.dataset.imgField;
    return {
      field,
      k,
      box: field.querySelector(`[data-preview="${k}"]`),
      frameInput: field.querySelector(`[name="frame-${k}"]`),
      removeInput: field.querySelector(`[name="remove-${k}"]`),
      fileInput: field.querySelector(`[name="file-${k}"]`),
      zoom: field.querySelector(`[name="zoom-${k}"]`),
      adjust: field.querySelector('.img-adjust'),
      removeBtn: field.querySelector('[data-img-remove]'),
    };
  };
  const readFrame = (p) => { try { const f = JSON.parse(p.frameInput.value); return validFrame(f) ? f : { ...CENTRE }; } catch { return { ...CENTRE }; } };
  const setFrame = (p, f) => {
    const clean = { x: Math.round(Math.min(100, Math.max(0, f.x)) * 10) / 10, y: Math.round(Math.min(100, Math.max(0, f.y)) * 10) / 10, zoom: Math.round(Math.min(4, Math.max(1, f.zoom)) * 100) / 100 };
    p.frameInput.value = JSON.stringify(clean);
    if (p.zoom) p.zoom.value = clean.zoom;
    const img = p.box.querySelector('img');
    if (img) img.setAttribute('style', frameStyle(clean));
  };
  const showing = (p, on) => {
    if (p.adjust) p.adjust.hidden = !on;
    if (p.removeBtn) p.removeBtn.hidden = !on;
  };

  root.addEventListener('change', (e) => {
    const input = e.target.closest('input[type=file][name^="file-"]');
    const p = input && parts(input);
    const file = input?.files?.[0];
    if (!p || !file) return;
    p.box.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="" draggable="false">`;
    p.removeInput.value = '';
    setFrame(p, CENTRE);
    showing(p, true);
  });

  root.addEventListener('input', (e) => {
    if (!e.target.matches('input[type=range][name^="zoom-"]')) return;
    const p = parts(e.target);
    setFrame(p, { ...readFrame(p), zoom: Number(e.target.value) });
  });

  root.addEventListener('click', (e) => {
    const centre = e.target.closest('[data-img-centre]');
    if (centre) { setFrame(parts(centre), CENTRE); return; }
    const remove = e.target.closest('[data-img-remove]');
    if (!remove) return;
    const p = parts(remove);
    if (p.fileInput) p.fileInput.value = ''; // forget a file picked but not saved
    p.removeInput.value = '1'; // and take away the saved one when they save
    p.box.innerHTML = '<span class="muted small">Removed. Save to confirm.</span>';
    setFrame(p, CENTRE);
    showing(p, false);
  });

  // Drag the picture to move it inside its shape.
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    const img = e.target.closest('[data-preview] img');
    if (!img) return;
    const p = parts(img);
    e.preventDefault();
    img.setPointerCapture?.(e.pointerId);
    drag = { p, img, startX: e.clientX, startY: e.clientY, start: readFrame(p), w: p.box.clientWidth, h: p.box.clientHeight };
    p.box.classList.add('dragging');
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { p, start, w, h } = drag;
    // Dragging right shows more of the left side, so the centre point moves the other way.
    const speed = 100 / start.zoom;
    setFrame(p, { ...start, x: start.x - ((e.clientX - drag.startX) / w) * speed, y: start.y - ((e.clientY - drag.startY) / h) * speed });
  });
  const stop = () => {
    if (!drag) return;
    drag.p.box.classList.remove('dragging');
    drag = null;
  };
  root.addEventListener('pointerup', stop);
  root.addEventListener('pointercancel', stop);
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
      const removing = !changes[pathField(k)] && form.querySelector(`[name="remove-${k}"]`)?.value === '1' && doc[pathField(k)];
      if (removing) {
        changes[pathField(k)] = null;
        oldPaths.push(doc[pathField(k)]);
      }
      // Framing (crop / zoom / move) for whatever picture is there after this save.
      const hasPicture = changes[pathField(k)] ?? (removing ? null : doc[pathField(k)]);
      let frame = null;
      try { frame = JSON.parse(form.querySelector(`[name="frame-${k}"]`)?.value ?? 'null'); } catch { frame = null; }
      changes[frameField(k)] = hasPicture && validFrame(frame) ? frame : null;
    }
    await save(changes);
  } catch (err) {
    await Promise.all(uploaded.map((p) => deleteImage(p, { admin })));
    throw err;
  }
  await Promise.all(oldPaths.map((p) => deleteImage(p, { admin })));
}
