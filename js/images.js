'use strict';
/* ---------- изображения в задачах (до 5) ----------
   Ключ изображения — «<uid загрузившего>/<uuid>»; в хранилище два файла: полный (до 1600 px) и миниатюра 240×240.
   Хранилище закрытое: ссылки подписываются на час и кешируются. Только что загруженные показываем из памяти. */
const MAX_IMAGES = 5;
const imgCache = new Map();   // путь → { url, exp }
const localImg = new Map();   // ключ → адрес blob: (своё, только что выбранное — показываем без сервера)
const pendingImgs = new Map(); // id задачи → [{ key, local }] — ещё загружаются
const imgPath = (key, thumb) => `${key}${thumb ? '_t' : ''}.webp`;
function imgUrl(key, thumb) {
  if (localImg.has(key)) return localImg.get(key);
  const c = imgCache.get(imgPath(key, thumb));
  return c && c.exp > Date.now() ? c.url : '';
}
let signWant = new Set(), signT = null;
function requestSign(paths) {
  for (const p of paths) signWant.add(p);
  clearTimeout(signT);
  signT = setTimeout(async () => {
    const list = [...signWant]; signWant = new Set();
    if (!list.length) return;
    try {
      const res = await backend.signImages(list), exp = Date.now() + 55 * 60e3;
      for (const r of res) if (r.signedUrl) imgCache.set(r.path, { url: r.signedUrl, exp });
    } catch {}
    hydrateImages(document);
  }, 30);
}
// Подставить адреса в <img data-img>; недостающие — подписать пачкой.
function hydrateImages(root = document) {
  const need = [];
  $$('img[data-img]', root).forEach(el => {
    const key = el.dataset.img, thumb = el.dataset.t === '1', u = imgUrl(key, thumb);
    if (u) { if (el.getAttribute('src') !== u) el.src = u; }
    else if (!el.dataset.asked) { el.dataset.asked = '1'; need.push(imgPath(key, thumb)); }
  });
  if (need.length) requestSign(need);
}
const thumbImg = (key, cls = '') => {
  const u = imgUrl(key, true);
  return `<img class="${cls}" data-img="${esc(key)}" data-t="1" alt=""${u ? ` src="${esc(u)}"` : ''} loading="lazy" decoding="async">`;
};

// Выход из профиля: ссылки и превью — только для того, кто их загрузил или кому они видны.
function forgetImages() {
  imgCache.clear();
  for (const u of localImg.values()) URL.revokeObjectURL(u);
  localImg.clear(); pendingImgs.clear();
  for (const x of state.newImages) URL.revokeObjectURL(x.local);
  state.newImages = []; renderComposerImages();
}

/* ---------- клеточки ---------- */
// В задаче: просмотр (клик — целиком) или правка (× у каждой, «+» — добавить, перетаскивание на карточку).
function imgsHtml(t, edit) {
  const keys = t.images || [], pend = pendingImgs.get(t.id) || [], del = edit || taskEditable(t);
  if (!keys.length && !pend.length && !edit) return '';
  const cells = keys.map((k, i) => `<div class="img-cell">
      <button type="button" class="img-btn" data-view-img="${t.id}" data-i="${i}" aria-label="Изображение ${i + 1} из ${keys.length} — открыть">${thumbImg(k)}</button>
      ${del ? `<button type="button" class="img-x${edit ? '' : ' hov'}" data-img-del="${t.id}" data-key="${esc(k)}" aria-label="Убрать изображение ${i + 1}">${icon('x')}</button>` : ''}
    </div>`).join('') + pend.map(p => `<div class="img-cell busy"><img src="${p.local}" alt=""><span class="spin" aria-hidden="true"></span></div>`).join('');
  const free = MAX_IMAGES - keys.length - pend.length;
  const add = edit && free > 0 ? `<button type="button" class="img-add" data-img-add="${t.id}" aria-label="Добавить изображения (можно ещё ${free})" title="Добавить изображения">${icon('plus')}</button>` : '';
  return `<div class="imgs" role="group" aria-label="Изображения">${cells}${add}${edit ? `<span class="imgs-hint">${keys.length + pend.length}/${MAX_IMAGES}<span class="dnd-only"> · можно перетащить сюда или вставить (Ctrl+V)</span></span>` : ''}</div>`;
}
// В поле новой задачи.
function renderComposerImages() {
  const box = $('#nImgs'), list = state.newImages;
  box.hidden = !list.length;
  box.innerHTML = list.map((x, i) => `<div class="img-cell${x.done ? '' : ' busy'}">
      <button type="button" class="img-btn" data-view-new="${i}" aria-label="Изображение ${i + 1} — открыть"><img src="${x.local}" alt=""></button>
      ${x.done ? '' : '<span class="spin" aria-hidden="true"></span>'}
      <button type="button" class="img-x" data-new-del="${i}" aria-label="Убрать изображение ${i + 1}">${icon('x')}</button>
    </div>`).join('') + (list.length < MAX_IMAGES ? `<button type="button" class="img-add" id="nImgAdd" aria-label="Добавить ещё изображения">${icon('plus')}</button>` : '');
  $('#nAttachN').textContent = list.length ? `${list.length}/${MAX_IMAGES}` : '';
  $('#nAttach').classList.toggle('has', list.length > 0);
}
// При отправке: готовые — сразу в задачу, догружающиеся — допишутся в неё, когда загрузятся.
function composerImages(taskId) {
  const done = state.newImages.filter(x => x.done).map(x => x.key);
  const rest = state.newImages.filter(x => !x.done);
  if (rest.length) pendingImgs.set(taskId, rest.map(x => { x.taskId = taskId; return { key: x.key, local: x.local }; }));
  state.newImages = [];
  return done;
}

/* ---------- подготовка и загрузка ---------- */
async function loadBitmap(file) {
  if (window.createImageBitmap) try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
  const url = URL.createObjectURL(file);
  try { return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Не удалось открыть картинку')); i.src = url; }); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}
async function encode(src, max, square, q) {
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  let sx = 0, sy = 0, sw = w, sh = h, dw, dh;
  if (square) { const side = Math.min(w, h); sx = (w - side) / 2; sy = (h - side) / 2; sw = sh = side; dw = dh = Math.min(max, side); }
  else { const k = Math.min(1, max / Math.max(w, h)); dw = Math.round(w * k); dh = Math.round(h * k); }
  const c = Object.assign(document.createElement('canvas'), { width: dw, height: dh });
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
  const toBlob = type => new Promise(res => c.toBlob(res, type, q));
  let b = await toBlob('image/webp');
  if (!b || b.type !== 'image/webp') b = await toBlob('image/jpeg');
  if (!b) throw new Error('Не удалось сжать картинку');
  return b;
}
async function prepImage(file) {
  if (file.size > 25 * 1024 * 1024) throw new Error('Файл больше 25 МБ');
  const bmp = await loadBitmap(file);
  try { return { full: await encode(bmp, 1600, false, .84), thumb: await encode(bmp, 240, true, .8) }; }
  finally { bmp.close?.(); }
}
const imageFiles = list => [...(list || [])].filter(f => /^image\//.test(f.type));
// target: 'new' — поле новой задачи; иначе id задачи (правка).
async function addImages(files, target) {
  files = imageFiles(files);
  if (!files.length) return toast('Это не изображения');
  const t = target === 'new' ? null : state.db.tasks.find(x => x.id === target);
  if (target !== 'new' && (!t || !taskEditable(t))) return;
  const used = target === 'new' ? state.newImages.length : t.images.length + (pendingImgs.get(target)?.length || 0);
  const free = MAX_IMAGES - used;
  if (free <= 0) return toast(`Не больше ${MAX_IMAGES} изображений`);
  if (files.length > free) toast(`Добавлено ${free} из ${files.length}: не больше ${MAX_IMAGES} изображений`);
  const items = files.slice(0, free).map(file => ({ key: `${state.me}/${newId()}`, local: URL.createObjectURL(file), file, done: false }));
  if (target === 'new') { state.newImages.push(...items); renderComposerImages(); }
  else { pendingImgs.set(target, (pendingImgs.get(target) || []).concat(items)); renderList({ flip: false }); }
  await Promise.all(items.map(it => uploadOne(it, target)));
}
async function uploadOne(it, target) {
  try {
    const { full, thumb } = await prepImage(it.file);
    await backend.uploadImage(it.key, full, thumb);
    localImg.set(it.key, it.local);   // своё — показываем из памяти, без лишней загрузки
    it.done = true;
  } catch (e) { it.error = true; toast(`Изображение не загрузилось: ${errText(e)}`); }
  // Задача могла быть создана, пока файл загружался: допишем его туда.
  const taskId = it.taskId || (target !== 'new' ? target : null);
  if (taskId) {
    const left = (pendingImgs.get(taskId) || []).filter(p => p.key !== it.key);
    left.length ? pendingImgs.set(taskId, left) : pendingImgs.delete(taskId);
    const t = state.db.tasks.find(x => x.id === taskId);
    if (it.done && t && !t.images.includes(it.key) && t.images.length < MAX_IMAGES) await ops.patchTask(taskId, { images: [...t.images, it.key] });
    else renderList({ flip: false });
  } else {
    if (it.error) state.newImages = state.newImages.filter(x => x !== it);
    renderComposerImages();
  }
}
// Удаление фото: сразу из задачи, файл — после того, как пропадёт «Отменить».
const purgeT = new Map();
function removeTaskImage(id, key) {
  const t = state.db.tasks.find(x => x.id === id); if (!t || !taskEditable(t)) return false;
  const at = t.images.indexOf(key); if (at < 0) return false;
  ops.patchTask(id, { images: t.images.filter(k => k !== key) }).then(okk => {
    if (!okk) return;
    purgeT.set(key, setTimeout(() => { purgeT.delete(key); backend.removeImages([key]); }, UNDO_MS + 1500));
  });
  toast('Фото удалено', () => {
    clearTimeout(purgeT.get(key)); purgeT.delete(key);
    const x = state.db.tasks.find(y => y.id === id);
    if (x && taskEditable(x) && !x.images.includes(key) && x.images.length < MAX_IMAGES) {
      const imgs = x.images.slice(); imgs.splice(Math.min(at, imgs.length), 0, key);
      ops.patchTask(id, { images: imgs });
    }
  });
  return true;
}

/* ---------- просмотр целиком ---------- */
let vw = { keys: [], i: 0, local: false, taskId: null };
function openViewer(keys, i, local = false, taskId = null) {
  vw = { keys, i, local, taskId };
  showViewerImage();
  const d = $('#viewer');
  if (!d.open) d.showModal();
}
async function showViewerImage() {
  const { keys, i, local } = vw, img = $('#vwImg'), key = keys[i];
  $('#vwN').textContent = keys.length > 1 ? `${i + 1} / ${keys.length}` : '';
  $('#vwPrev').hidden = $('#vwNext').hidden = keys.length < 2;
  const t = vw.taskId && state.db.tasks.find(x => x.id === vw.taskId);
  $('#vwDel').hidden = !(local || (t && taskEditable(t)));
  if (local) { img.src = key; return; }
  // Сначала миниатюра (уже есть), затем полное изображение.
  const full = imgUrl(key, false);
  if (full) { img.src = full; return; }
  img.src = imgUrl(key, true) || '';
  try {
    const [r] = await backend.signImages([imgPath(key, false)]);
    if (r?.signedUrl) { imgCache.set(r.path, { url: r.signedUrl, exp: Date.now() + 55 * 60e3 }); if (vw.keys[vw.i] === key) img.src = r.signedUrl; }
  } catch {}
}
// Удалить открытое фото: из задачи (с «Отменить») или из поля новой задачи.
function deleteViewerImage() {
  const key = vw.keys[vw.i];
  if (vw.local) {
    const at = state.newImages.findIndex(x => x.local === key); if (at < 0) return;
    const [x] = state.newImages.splice(at, 1); if (x.done) backend.removeImages([x.key]);
    renderComposerImages(); vw.keys = state.newImages.map(y => y.local);
  } else {
    if (!removeTaskImage(vw.taskId, key)) return;
    vw.keys = vw.keys.filter(k => k !== key);
  }
  if (!vw.keys.length) return $('#viewer').close();
  vw.i = Math.min(vw.i, vw.keys.length - 1); showViewerImage();
}
$('#vwDel').addEventListener('click', deleteViewerImage);
// Копировать открытое изображение в буфер (PNG — его понимают все программы, куда вставляют).
async function fullImageUrl(key) {
  if (vw.local) return key;
  const u = imgUrl(key, false); if (u) return u;
  const [r] = await backend.signImages([imgPath(key, false)]);
  if (!r?.signedUrl) throw new Error('нет доступа к изображению');
  imgCache.set(r.path, { url: r.signedUrl, exp: Date.now() + 55 * 60e3 });
  return r.signedUrl;
}
async function pngOf(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await loadBitmap(blob);
  const c = Object.assign(document.createElement('canvas'), { width: bmp.width || bmp.naturalWidth, height: bmp.height || bmp.naturalHeight });
  c.getContext('2d').drawImage(bmp, 0, 0); bmp.close?.();
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('не удалось подготовить')), 'image/png'));
}
$('#vwCopy').addEventListener('click', async () => {
  const key = vw.keys[vw.i], btn = $('#vwCopy');
  if (!navigator.clipboard?.write || !window.ClipboardItem) return toast('Здесь нельзя копировать изображения — сохраните его (долгое нажатие или правая кнопка мыши)');
  btnBusy(btn, true, 'Копирую…');
  try {
    // Promise внутри ClipboardItem — так копирование срабатывает и в Safari (буфер открыт только во время нажатия).
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': fullImageUrl(key).then(pngOf) })]);
    toast('Изображение скопировано');
  } catch (e) { toast(`Не удалось скопировать изображение${e?.message ? `: ${e.message}` : ''}`); }
  finally { btnBusy(btn, false); }
});
$('#viewer').addEventListener('keydown', e => { if (e.key === 'Delete' && !$('#vwDel').hidden) deleteViewerImage(); });
function stepViewer(d) { if (vw.keys.length < 2) return; vw.i = (vw.i + d + vw.keys.length) % vw.keys.length; showViewerImage(); }
$('#vwPrev').addEventListener('click', () => stepViewer(-1));
$('#vwNext').addEventListener('click', () => stepViewer(1));
$('#viewer').addEventListener('click', e => {
  if (e.target.closest('[data-close]') || e.target === e.currentTarget) $('#viewer').close();
});
$('#viewer').addEventListener('keydown', e => { if (e.key === 'ArrowLeft') stepViewer(-1); else if (e.key === 'ArrowRight') stepViewer(1); });
$('#viewer').addEventListener('close', () => { $('#vwImg').removeAttribute('src'); });
// Свайп влево/вправо на телефоне.
let swipeX = null;
$('#viewer').addEventListener('pointerdown', e => { if (e.pointerType === 'touch') swipeX = e.clientX; });
$('#viewer').addEventListener('pointerup', e => {
  if (swipeX == null) return; const dx = e.clientX - swipeX; swipeX = null;
  if (Math.abs(dx) > 50) stepViewer(dx < 0 ? 1 : -1);
});

/* ---------- события ---------- */
let imgTarget = 'new';
function pickImages(target) { imgTarget = target; $('#imgFile').value = ''; $('#imgFile').click(); }
$('#imgFile').addEventListener('change', e => { if (e.target.files.length) addImages(e.target.files, imgTarget); });
$('#nAttach').addEventListener('click', () => pickImages('new'));
$('#nImgs').addEventListener('click', e => {
  if (e.target.closest('#nImgAdd')) return pickImages('new');
  const del = e.target.closest('[data-new-del]');
  if (del) {
    const [x] = state.newImages.splice(Number(del.dataset.newDel), 1);
    if (x?.done) backend.removeImages([x.key]);
    renderComposerImages(); $('#nTitle').focus(); return;
  }
  const v = e.target.closest('[data-view-new]');
  if (v) openViewer(state.newImages.map(x => x.local), Number(v.dataset.viewNew), true);
});
$('#list').addEventListener('click', e => {
  const v = e.target.closest('[data-view-img]');
  if (v) { const t = state.db.tasks.find(x => x.id === v.dataset.viewImg); if (t) openViewer(t.images, Number(v.dataset.i), false, t.id); return; }
  const add = e.target.closest('[data-img-add]'); if (add) return pickImages(add.dataset.imgAdd);
  const del = e.target.closest('[data-img-del]'); if (del) return removeTaskImage(del.dataset.imgDel, del.dataset.key);
});
// Вставка из буфера (Ctrl+V): в поле новой задачи или в редактируемую задачу.
document.addEventListener('paste', e => {
  const files = imageFiles([...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean));
  if (!files.length || !state.me) return;
  const inNew = e.target.closest?.('#newForm'), ed = e.target.closest?.('[data-form]');
  if (!inNew && !ed) return;
  e.preventDefault();
  addImages(files, inNew ? 'new' : ed.dataset.form);
});
// Перетаскивание (ПК): на поле новой задачи или на редактируемую задачу — подсветка и прикрепление.
const dropTarget = e => e.target.closest?.('#cBox') || e.target.closest?.('#list .task.editing');
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragover', e => {
  if (!hasFiles(e)) return;
  const t = dropTarget(e);
  $$('.drop-over').forEach(el => el !== t && el.classList.remove('drop-over'));
  if (t) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; t.classList.add('drop-over'); }
});
document.addEventListener('dragleave', e => {
  const t = dropTarget(e); if (t && !t.contains(e.relatedTarget)) t.classList.remove('drop-over');
});
document.addEventListener('drop', e => {
  const t = dropTarget(e);
  $$('.drop-over').forEach(el => el.classList.remove('drop-over'));
  if (!t || !hasFiles(e)) return;
  e.preventDefault();
  addImages(e.dataTransfer.files, t.id === 'cBox' ? 'new' : t.dataset.task);
});
