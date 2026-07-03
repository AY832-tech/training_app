'use strict';

// ---------- ユーティリティ ----------
const $ = (sel, el = document) => el.querySelector(sel);
const api = async (method, url, body) => {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && url !== '/api/auth') { showLogin(); throw new Error('要ログイン'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
};
const get = (u) => api('GET', u);
const post = (u, b) => api('POST', u, b);
const put = (u, b) => api('PUT', u, b);
const del = (u) => api('DELETE', u);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => new Date().toLocaleDateString('sv-SE');
const fmtDate = (d) => {
  const dt = new Date(d + 'T00:00:00');
  const w = ['日', '月', '火', '水', '木', '金', '土'][dt.getDay()];
  return `${dt.getMonth() + 1}/${dt.getDate()}(${w})`;
};
const round = (n, p = 1) => Math.round(n * 10 ** p) / 10 ** p;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1600);
}

// ---------- ログイン ----------
function showLogin(msg) {
  if ($('#login-overlay')) { if (msg) $('#login-err').textContent = msg; return; }
  const el = document.createElement('div');
  el.id = 'login-overlay';
  el.innerHTML = `
    <div class="login-box">
      <div class="login-logo">🏋️</div>
      <h2 style="color:var(--text);text-align:center;margin:0 0 4px">筋トレ管理</h2>
      <p class="muted small" style="text-align:center;margin:0 0 18px">パスワードを入力してください</p>
      <input type="password" id="login-pw" placeholder="パスワード" autocomplete="current-password">
      <div id="login-err" class="small" style="color:var(--danger);min-height:18px;margin:6px 2px"></div>
      <button class="btn-primary btn-block" id="login-btn">ログイン</button>
    </div>`;
  document.body.appendChild(el);
  const submit = async () => {
    const pw = $('#login-pw').value;
    if (!pw) return;
    $('#login-btn').disabled = true;
    try {
      const r = await fetch('/api/auth', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
      });
      if (!r.ok) { $('#login-err').textContent = (await r.json()).error || 'ログイン失敗'; $('#login-btn').disabled = false; return; }
      el.remove();
      init();
    } catch (e) { $('#login-err').textContent = '通信エラー'; $('#login-btn').disabled = false; }
  };
  $('#login-btn').onclick = submit;
  $('#login-pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  $('#login-pw').focus();
}

async function logout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  location.reload();
}

// ---------- モーダル ----------
function openModal(html) {
  $('#modal').innerHTML = html;
  $('#modal-bg').classList.add('open');
}
function closeModal() { $('#modal-bg').classList.remove('open'); }
$('#modal-bg').addEventListener('click', (e) => { if (e.target.id === 'modal-bg') closeModal(); });

// ---------- 状態 ----------
const state = { exercises: [], view: 'home' };
async function loadExercises() { state.exercises = await get('/api/exercises'); }
const exById = (id) => state.exercises.find((e) => e.id === Number(id));

function exerciseOptions(selectedId) {
  const cats = [...new Set(state.exercises.map((e) => e.category))];
  return cats.map((c) => `<optgroup label="${esc(c)}">` +
    state.exercises.filter((e) => e.category === c)
      .map((e) => `<option value="${e.id}" ${e.id === Number(selectedId) ? 'selected' : ''}>${esc(e.name)}</option>`)
      .join('') + '</optgroup>').join('');
}

// ---------- ナビゲーション ----------
const titles = { home: 'ホーム', log: 'トレ記録', stretch: 'ストレッチ', meal: '食事管理', body: '体組成', stats: '統計' };
const renderers = {};
async function switchView(v) {
  state.view = v;
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  $('#view-' + v).classList.add('active');
  document.querySelectorAll('nav.tabbar button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === v));
  $('#header-title').textContent = titles[v];
  window.scrollTo(0, 0);
  await renderers[v]();
}
document.querySelectorAll('nav.tabbar button').forEach((b) =>
  b.addEventListener('click', () => switchView(b.dataset.view)));

// ==================================================
// ホーム（ダッシュボード）
// ==================================================
renderers.home = async function () {
  const s = await get('/api/summary?today=' + todayStr());
  const el = $('#view-home');
  const body = s.latest_body;
  const m = s.mesocycle;
  const mesoHtml = m ? `
    <div class="card ${m.over ? 'meso-over' : m.due ? 'meso-due' : ''}" style="margin-bottom:2px">
      <div class="row between">
        <div><div class="muted small">現在のメニュー（v${m.version_no}）</div>
          <div style="font-weight:600;margin-top:2px">${esc(m.name)}</div></div>
        <div class="right"><div class="muted small">メソサイクル</div>
          <div class="big">第${m.week}<span class="unit muted" style="font-size:13px">週 / 8-12</span></div></div>
      </div>
      ${m.over ? `<div class="small" style="color:var(--danger);margin-top:6px">⚠️ 12週を超えました。メニューの抜本見直しを推奨します。</div>`
        : m.due ? `<div class="small" style="color:var(--accent);margin-top:6px">💡 8週を超えました。そろそろメニュー改訂を検討しましょう。</div>` : ''}
    </div>` : '';
  el.innerHTML = `
    ${mesoHtml}
    <div class="stats-grid">
      <div class="stat"><div class="label">今週のトレ回数</div><div class="val">${s.workouts_this_week}<span class="unit"> 回</span></div></div>
      <div class="stat"><div class="label">今週の総挙上量</div><div class="val">${round(s.total_volume_this_week / 1000, 1)}<span class="unit"> t</span></div></div>
      <div class="stat"><div class="label">今日のたんぱく質</div><div class="val">${round(s.protein_today.p)}<span class="unit"> g</span></div></div>
      <div class="stat"><div class="label">今日のカロリー</div><div class="val">${round(s.protein_today.c)}<span class="unit"> kcal</span></div></div>
    </div>
    <div class="card">
      <div class="row between">
        <div><div class="muted small">最新の体重</div>
        <div class="big">${body && body.weight != null ? body.weight + ' <span class="unit muted" style="font-size:14px">kg</span>' : '—'}</div></div>
        <div class="right"><div class="muted small">体脂肪率</div>
        <div class="big">${body && body.body_fat != null ? body.body_fat + ' <span class="unit muted" style="font-size:14px">%</span>' : '—'}</div></div>
      </div>
      ${body ? `<div class="muted small" style="margin-top:6px">記録日: ${fmtDate(body.date)}</div>` : ''}
    </div>
    <h2>クイック記録</h2>
    <div class="row wrap">
      <button class="btn-primary grow" id="q-workout">＋ トレを記録</button>
      <button class="btn-ghost grow" id="q-meal">＋ 食事</button>
      <button class="btn-ghost grow" id="q-body">＋ 体組成</button>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="muted small">累計トレ回数</div>
      <div class="big">${s.total_workouts} <span class="unit muted" style="font-size:14px">回</span></div>
    </div>
    <button class="btn-ghost btn-block btn-sm" id="logout-btn" style="margin-top:8px">ログアウト</button>`;
  $('#q-workout').onclick = () => workoutModal();
  $('#q-meal').onclick = () => mealModal();
  $('#q-body').onclick = () => bodyModal();
  $('#logout-btn').onclick = logout;
};

// ==================================================
// トレ記録
// ==================================================
renderers.log = async function () {
  const workouts = await get('/api/workouts');
  const el = $('#view-log');
  el.innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <button class="btn-primary grow" id="add-workout">＋ 新しいトレ記録</button>
    </div>
    <div class="row wrap" style="margin-bottom:14px">
      <button class="btn-ghost btn-sm" id="manage-menu">📋 メニュー</button>
      <button class="btn-ghost btn-sm" id="manage-ex">種目を管理</button>
      <button class="btn-ghost btn-sm" id="manage-tpl">テンプレート</button>
    </div>
    <div id="workout-list"></div>`;
  $('#add-workout').onclick = () => workoutModal();
  $('#manage-menu').onclick = () => programModal();
  $('#manage-ex').onclick = () => exerciseModal();
  $('#manage-tpl').onclick = () => templateListModal();

  const list = $('#workout-list');
  if (!workouts.length) { list.innerHTML = `<div class="empty">まだ記録がありません。<br>「＋ 新しいトレ記録」から始めましょう💪</div>`; return; }
  list.innerHTML = workouts.map((w) => {
    const vol = w.sets.reduce((a, s) => a + s.weight * s.reps, 0);
    const byEx = {};
    w.sets.forEach((s) => { (byEx[s.exercise_name] ||= []).push(s); });
    const exHtml = Object.entries(byEx).map(([name, sets]) =>
      `<div class="small" style="margin-top:6px"><b>${esc(name)}</b> <span class="muted">${
        sets.map((s) => `${round(s.weight)}${esc(sets[0].unit)}×${s.reps}`).join(' / ')}</span></div>`).join('');
    return `<div class="card tap" data-id="${w.id}">
      <div class="row between">
        <div><b>${fmtDate(w.date)}</b> <span class="chip">${w.sets.length} セット</span></div>
        <div class="muted small">${round(vol)} kg·rep</div>
      </div>
      ${exHtml}
      ${w.note ? `<div class="muted small" style="margin-top:8px">📝 ${esc(w.note)}</div>` : ''}
    </div>`;
  }).join('');
  list.querySelectorAll('.card').forEach((c) =>
    c.onclick = () => { const w = workouts.find((x) => x.id === Number(c.dataset.id)); workoutModal(w); });
};

// 自由入力モードの1行（種目ドロップダウン付き）
function setLineHtml(set = {}) {
  return `<div class="set-line" data-set>
    <span class="num">●</span>
    <select class="grow" data-ex>${exerciseOptions(set.exercise_id)}</select>
    <input type="number" inputmode="decimal" step="0.5" placeholder="kg" style="width:64px" data-w value="${set.weight ?? ''}">
    <input type="number" inputmode="numeric" placeholder="回" style="width:54px" data-r value="${set.reps ?? ''}">
    <button class="icon-btn" data-rm type="button">✕</button>
  </div>`;
}

// Day モードの1行（種目は固定）
function daySetRow(exId, unit, w) {
  return `<div class="set-line" data-set data-ex="${exId}">
    <span class="num">●</span>
    <input type="number" inputmode="decimal" step="0.5" placeholder="重量" style="width:76px" data-w value="${w ?? ''}">
    <span class="muted small" style="min-width:18px">${esc(unit || 'kg')}</span>
    <input type="number" inputmode="numeric" placeholder="回" style="width:56px" data-r value="">
    <button class="icon-btn" data-rm type="button">✕</button>
  </div>`;
}

// Day モードの種目グループ（前回値・推奨重量つき）
function exGroupHtml(pe) {
  const sug = pe.suggestion || { weight: null, source: 'none' };
  const last = pe.last_session;
  const lastTxt = last && last.sets.length
    ? last.sets.map((s) => `${round(s.weight)}×${s.reps}`).join(' / ') : 'なし';
  const srcLabel = { progress: '↑漸進', last: '前回維持', manual: '手動指定', none: '' }[sug.source] || '';
  const rows = Array.from({ length: pe.target_sets }, () => daySetRow(pe.exercise_id, pe.unit, sug.weight)).join('');
  return `<div class="ex-group" data-exgroup data-ex="${pe.exercise_id}" data-sugw="${sug.weight ?? ''}" data-sugsrc="${sug.source}">
    <div class="row between" style="align-items:center">
      <b>${esc(pe.exercise_name)}</b>
      <span class="chip">${pe.target_sets}×${pe.rep_min}-${pe.rep_max}</span>
    </div>
    <div class="muted small" style="margin:3px 0 6px">前回: ${lastTxt}${
      sug.weight != null ? ` ・ 推奨 <b class="accent">${sug.weight}${esc(pe.unit)}</b>${
        srcLabel ? ` <span class="chip cat">${srcLabel}</span>` : ''}` : ''}</div>
    <div class="set-rows">${rows}</div>
    <button class="btn-ghost btn-sm" data-addrow type="button" style="margin-top:4px">＋ セット</button>
  </div>`;
}

async function workoutModal(existing) {
  const isEdit = !!existing;
  let prog = null;
  if (!isEdit) { try { prog = await get('/api/program/active'); } catch (e) {} }

  const dayOptions = prog && prog.days
    ? prog.days.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('') : '';

  openModal(`
    <h3>${isEdit ? 'トレ記録を編集' : 'トレを記録'}</h3>
    <div class="field"><label>日付</label><input type="date" id="w-date" value="${existing?.date || todayStr()}"></div>
    ${isEdit ? '' : (dayOptions ? `<div class="field"><label>メニューの日を選ぶ</label>
      <select id="day-pick"><option value="">自由入力</option>${dayOptions}</select></div>` : '')}
    <label>種目・セット</label>
    <div id="sets">${(isEdit ? existing.sets : [{}]).map(setLineHtml).join('')}</div>
    <button class="btn-ghost btn-block btn-sm" id="add-set" type="button" style="margin-bottom:12px">＋ セット追加</button>
    <div class="field"><label>メモ</label><textarea id="w-note" rows="2" placeholder="調子・気づきなど">${esc(existing?.note || '')}</textarea></div>
    <div class="row">
      ${isEdit ? `<button class="btn-danger" id="w-del">削除</button>` : ''}
      <button class="btn-ghost grow" id="w-cancel">キャンセル</button>
      <button class="btn-primary grow" id="w-save">保存</button>
    </div>`);

  const setsEl = $('#sets');
  let mode = 'free';
  let dayId = existing?.day_id || null;

  const bindRemovers = () => setsEl.querySelectorAll('[data-rm]').forEach((b) =>
    b.onclick = () => {
      const line = b.closest('[data-set]');
      const container = line.parentElement;
      if (container.querySelectorAll('[data-set]').length > 1) line.remove();
    });
  const bindAddRows = () => setsEl.querySelectorAll('[data-addrow]').forEach((b) =>
    b.onclick = () => {
      const grp = b.closest('[data-exgroup]');
      $('.set-rows', grp).insertAdjacentHTML('beforeend', daySetRow(grp.dataset.ex, '', grp.dataset.sugw || ''));
      bindRemovers();
    });
  bindRemovers();

  $('#add-set').onclick = () => {
    const last = setsEl.querySelector('.set-line:last-child');
    const exId = last && $('[data-ex]', last) && $('[data-ex]', last).tagName === 'SELECT'
      ? $('[data-ex]', last).value : undefined;
    setsEl.insertAdjacentHTML('beforeend', setLineHtml({ exercise_id: exId }));
    bindRemovers();
  };

  if ($('#day-pick')) $('#day-pick').onchange = (e) => {
    const d = (prog.days || []).find((x) => x.id === Number(e.target.value));
    if (!d) {
      mode = 'free'; dayId = null;
      setsEl.innerHTML = setLineHtml();
      $('#add-set').style.display = '';
      bindRemovers();
      return;
    }
    mode = 'day'; dayId = d.id;
    setsEl.innerHTML = d.exercises.map(exGroupHtml).join('') || setLineHtml();
    $('#add-set').style.display = 'none';
    bindRemovers(); bindAddRows();
  };

  $('#w-cancel').onclick = closeModal;
  $('#w-save').onclick = async () => {
    const sets = [...setsEl.querySelectorAll('[data-set]')].map((r) => {
      const w = $('[data-w]', r).value;
      const reps = $('[data-r]', r).value;
      const exId = Number(r.dataset.ex || ($('[data-ex]', r) ? $('[data-ex]', r).value : 0));
      let manual = false;
      const grp = r.closest('[data-exgroup]');
      if (grp) {
        const sugw = grp.dataset.sugw, src = grp.dataset.sugsrc;
        if (src === 'manual') manual = true;
        else if (sugw !== '' && w !== '' && Number(w) !== Number(sugw)) manual = true;
      }
      return { exercise_id: exId, weight: w, reps, manual_override: manual };
    }).filter((s) => s.exercise_id && (s.reps !== '' || s.weight !== ''));

    const payload = {
      date: $('#w-date').value,
      note: $('#w-note').value,
      version_id: (mode === 'day' && prog) ? prog.id : (existing?.version_id || null),
      day_id: (mode === 'day') ? dayId : (existing?.day_id || null),
      sets,
    };
    if (!payload.date) return toast('日付を入れてください');
    if (!payload.sets.length) return toast('セットを入力してください');
    if (isEdit) await put('/api/workouts/' + existing.id, payload);
    else await post('/api/workouts', payload);
    closeModal(); toast('保存しました'); renderers[state.view]();
  };
  if (isEdit) $('#w-del').onclick = async () => {
    if (!confirm('この記録を削除しますか？')) return;
    await del('/api/workouts/' + existing.id);
    closeModal(); toast('削除しました'); renderers[state.view]();
  };
}

// ---------- 種目管理 ----------
async function exerciseModal() {
  await loadExercises();
  const cats = ['胸', '背中', '脚', '肩', '腕', '腹', 'その他'];
  openModal(`
    <h3>種目の管理</h3>
    <div class="field-row">
      <div class="field" style="flex:2"><label>種目名</label><input id="ex-name" placeholder="例: インクラインベンチ"></div>
      <div class="field"><label>部位</label><select id="ex-cat">${cats.map((c) => `<option>${c}</option>`).join('')}</select></div>
      <div class="field" style="flex:.7"><label>単位</label><select id="ex-unit"><option>kg</option><option>回</option><option>秒</option></select></div>
    </div>
    <button class="btn-primary btn-block btn-sm" id="ex-add" style="margin-bottom:14px">＋ 追加</button>
    <div class="divider"></div>
    <ul class="clean" id="ex-list"></ul>
    <button class="btn-ghost btn-block" id="ex-close" style="margin-top:12px">閉じる</button>`);
  const renderList = () => {
    $('#ex-list').innerHTML = state.exercises.map((e) =>
      `<li class="row between" style="padding:8px 0;border-bottom:1px solid var(--border)">
        <span><b>${esc(e.name)}</b> <span class="chip cat">${esc(e.category)}</span></span>
        <button class="icon-btn" data-del="${e.id}">🗑</button></li>`).join('');
    $('#ex-list').querySelectorAll('[data-del]').forEach((b) =>
      b.onclick = async () => {
        if (!confirm('削除しますか？（過去の記録は残ります）')) return;
        try { await del('/api/exercises/' + b.dataset.del); await loadExercises(); renderList(); toast('削除しました'); }
        catch (e) { toast('使用中の種目は削除できません'); }
      });
  };
  renderList();
  $('#ex-add').onclick = async () => {
    const name = $('#ex-name').value.trim();
    if (!name) return toast('種目名を入れてください');
    try {
      await post('/api/exercises', { name, category: $('#ex-cat').value, unit: $('#ex-unit').value });
      await loadExercises(); renderList(); $('#ex-name').value = ''; toast('追加しました');
    } catch (e) { toast('同名の種目が既にあります'); }
  };
  $('#ex-close').onclick = closeModal;
}

// ---------- テンプレート管理 ----------
async function templateListModal() {
  const tpls = await get('/api/templates');
  openModal(`
    <h3>テンプレート</h3>
    <button class="btn-primary btn-block btn-sm" id="tpl-new" style="margin-bottom:14px">＋ 新規作成</button>
    <ul class="clean" id="tpl-list">${
      tpls.length ? tpls.map((t) =>
        `<li class="card" style="margin-bottom:8px"><div class="row between">
          <div><b>${esc(t.name)}</b><div class="muted small">${
            t.items.map((i) => `${esc(i.exercise_name)} ${i.target_sets}×${i.target_reps}`).join(', ') || '（種目なし）'}</div></div>
          <button class="icon-btn" data-del="${t.id}">🗑</button></div></li>`).join('')
      : '<div class="empty">テンプレートがありません</div>'}</ul>
    <button class="btn-ghost btn-block" id="tpl-close">閉じる</button>`);
  $('#tpl-new').onclick = () => templateEditModal();
  $('#tpl-close').onclick = closeModal;
  $('#tpl-list').querySelectorAll('[data-del]').forEach((b) =>
    b.onclick = async () => {
      if (!confirm('テンプレートを削除しますか？')) return;
      await del('/api/templates/' + b.dataset.del); toast('削除しました'); templateListModal();
    });
}

function tplItemHtml(it = {}) {
  return `<div class="set-line" data-item>
    <select class="grow" data-ex>${exerciseOptions(it.exercise_id)}</select>
    <input type="number" inputmode="numeric" style="width:50px" placeholder="ｾｯﾄ" data-sets value="${it.target_sets ?? 3}">
    <span class="muted small">×</span>
    <input type="number" inputmode="numeric" style="width:50px" placeholder="回" data-reps value="${it.target_reps ?? 10}">
    <button class="icon-btn" data-rm type="button">✕</button>
  </div>`;
}

function templateEditModal() {
  openModal(`
    <h3>テンプレート作成</h3>
    <div class="field"><label>名前</label><input id="tpl-name" placeholder="例: 胸の日"></div>
    <label>種目</label>
    <div id="tpl-items">${tplItemHtml()}</div>
    <button class="btn-ghost btn-block btn-sm" id="tpl-add-item" type="button" style="margin:8px 0 14px">＋ 種目追加</button>
    <div class="row">
      <button class="btn-ghost grow" id="tpl-cancel">戻る</button>
      <button class="btn-primary grow" id="tpl-save">保存</button>
    </div>`);
  const itemsEl = $('#tpl-items');
  const bind = () => itemsEl.querySelectorAll('[data-rm]').forEach((b) =>
    b.onclick = () => { if (itemsEl.children.length > 1) b.closest('[data-item]').remove(); });
  bind();
  $('#tpl-add-item').onclick = () => { itemsEl.insertAdjacentHTML('beforeend', tplItemHtml()); bind(); };
  $('#tpl-cancel').onclick = () => templateListModal();
  $('#tpl-save').onclick = async () => {
    const name = $('#tpl-name').value.trim();
    if (!name) return toast('名前を入れてください');
    const items = [...itemsEl.querySelectorAll('[data-item]')].map((r) => ({
      exercise_id: Number($('[data-ex]', r).value),
      target_sets: $('[data-sets]', r).value,
      target_reps: $('[data-reps]', r).value,
    })).filter((i) => i.exercise_id);
    await post('/api/templates', { name, items });
    toast('保存しました'); templateListModal();
  };
}

// ==================================================
// メニュー（プログラム）管理
// ==================================================
async function programModal() {
  await loadExercises();
  const versions = await get('/api/program');
  window._progVersions = versions;
  if (!versions.length) {
    openModal(`<h3>メニュー</h3><div class="empty">メニューがありません</div>
      <button class="btn-ghost btn-block" id="p-close">閉じる</button>`);
    $('#p-close').onclick = closeModal; return;
  }
  const active = versions.find((v) => v.is_active) || versions[0];
  renderProgramView(active.id);
}

function renderProgramView(versionId) {
  const versions = window._progVersions || [];
  const v = versions.find((x) => x.id === versionId) || versions[0];
  const verSwitch = versions.length > 1
    ? `<div class="field"><label>バージョン切替</label><select id="ver-pick">${
        versions.map((x) => `<option value="${x.id}" ${x.id === v.id ? 'selected' : ''}>v${x.version_no} ${esc(x.name)}${x.is_active ? '（現行）' : ''}</option>`).join('')}</select></div>`
    : '';
  openModal(`
    <h3>メニュー v${v.version_no}</h3>
    ${verSwitch}
    <div class="card">
      <div style="font-weight:600">${esc(v.name)}</div>
      <div class="muted small" style="margin-top:2px">開始 ${v.start_date || '—'}${v.is_active ? ' ・ 現行（アクティブ）' : ' ・ 過去版'}</div>
      ${v.note ? `<div class="muted small">📝 ${esc(v.note)}</div>` : ''}
    </div>
    ${v.days.map((d) => `
      <div class="card">
        <div style="font-weight:600;margin-bottom:2px">${esc(d.name)}</div>
        ${d.exercises.map((pe) => `
          <div class="row between" style="padding:7px 0;border-top:1px solid var(--border);align-items:center">
            <div class="grow small"><b>${esc(pe.exercise_name)}</b>
              <span class="muted"> ${pe.target_sets}×${pe.rep_min}-${pe.rep_max}</span></div>
            <div class="right small" style="white-space:nowrap">
              <span class="muted" style="font-size:11px">次回手動</span>
              <input type="number" inputmode="decimal" step="0.5" style="width:60px" data-manual="${pe.id}" value="${pe.next_weight_manual ?? ''}" placeholder="自動">
            </div>
          </div>`).join('')}
      </div>`).join('')}
    <div class="row wrap" style="margin-top:8px">
      ${v.is_active
        ? `<button class="btn-ghost btn-sm" id="p-edit">✏️ 編集（軽微）</button>
           <button class="btn-ghost btn-sm" id="p-new">🔄 新バージョン</button>`
        : `<button class="btn-ghost btn-sm" id="p-activate">この版を現行にする</button>`}
      <button class="btn-ghost btn-sm" id="p-hist">変更履歴</button>
    </div>
    <button class="btn-ghost btn-block" id="p-close" style="margin-top:10px">閉じる</button>`);

  $('#modal').querySelectorAll('[data-manual]').forEach((inp) => inp.onchange = async () => {
    try { await put('/api/program-exercise/' + inp.dataset.manual, { next_weight_manual: inp.value }); toast('次回重量を更新'); }
    catch (e) { toast('更新に失敗しました'); }
  });
  if ($('#ver-pick')) $('#ver-pick').onchange = (e) => renderProgramView(Number(e.target.value));
  if ($('#p-edit')) $('#p-edit').onclick = () => programEditModal(v, 'minor');
  if ($('#p-new')) $('#p-new').onclick = () => programEditModal(v, 'major');
  if ($('#p-activate')) $('#p-activate').onclick = async () => {
    await post('/api/program/' + v.id + '/activate', {}); toast('現行にしました'); programModal();
    if (state.view === 'home') renderers.home();
  };
  if ($('#p-hist')) $('#p-hist').onclick = () => programHistoryModal(v.id);
  $('#p-close').onclick = closeModal;
}

async function programHistoryModal(versionId) {
  const rows = await get('/api/program/' + versionId + '/changes');
  openModal(`<h3>変更履歴</h3>
    ${rows.length ? rows.map((r) => `<div class="card"><b>${fmtDate(r.date)}</b><div class="small">${esc(r.description)}</div></div>`).join('')
      : '<div class="empty">履歴はありません</div>'}
    <button class="btn-ghost btn-block" id="h-close" style="margin-top:8px">戻る</button>`);
  $('#h-close').onclick = () => programModal();
}

function progExRow(it = {}) {
  return `<div class="set-line" data-pit data-inc="${it.increment ?? 2.5}">
    <select class="grow" data-ex>${exerciseOptions(it.exercise_id)}</select>
    <input type="number" inputmode="numeric" style="width:40px" data-sets placeholder="ｾｯﾄ" value="${it.target_sets ?? 3}">
    <input type="number" inputmode="numeric" style="width:40px" data-rmin placeholder="min" value="${it.rep_min ?? 8}">
    <span class="muted small">-</span>
    <input type="number" inputmode="numeric" style="width:40px" data-rmax placeholder="max" value="${it.rep_max ?? 12}">
    <button class="icon-btn" data-rm type="button">✕</button>
  </div>`;
}

function progDayHtml(d = {}) {
  return `<div class="card" data-pday>
    <div class="row between" style="margin-bottom:6px">
      <input class="grow" data-dayname placeholder="Day名（例: Day1 上半身）" value="${esc(d.name || '')}" style="font-weight:600">
      <button class="icon-btn" data-rmday type="button">🗑</button>
    </div>
    <div data-pitems>${(d.exercises && d.exercises.length ? d.exercises : [{}]).map(progExRow).join('')}</div>
    <button class="btn-ghost btn-sm" data-additem type="button" style="margin-top:4px">＋ 種目</button>
  </div>`;
}

function programEditModal(v, mode) {
  const isMajor = mode === 'major';
  openModal(`
    <h3>${isMajor ? '新バージョン作成' : 'メニューを編集'}</h3>
    <div class="field"><label>メニュー名</label>
      <input id="pe-name" value="${esc(isMajor ? '' : v.name)}" placeholder="例: PPL 上級"></div>
    <label>トレーニング日</label>
    <div id="pe-days">${v.days.map(progDayHtml).join('')}</div>
    <button class="btn-ghost btn-block btn-sm" id="pe-addday" type="button" style="margin:6px 0 12px">＋ 日を追加</button>
    <div class="field"><label>${isMajor ? '改訂メモ（新バージョンの理由）' : '変更メモ（履歴に残ります）'}</label>
      <input id="pe-note" placeholder="${isMajor ? '例: 分割をPPLに変更' : '例: サイドレイズを追加'}"></div>
    ${isMajor
      ? `<div class="muted small" style="margin-bottom:10px">⚠️ 新バージョンはメソサイクルの週数がリセットされます。現行版は過去版として残ります。</div>`
      : `<div class="muted small" style="margin-bottom:10px">軽微編集：同じバージョン内を更新し、メソサイクルの週数は継続します。</div>`}
    <div class="row">
      <button class="btn-ghost grow" id="pe-cancel">戻る</button>
      <button class="btn-primary grow" id="pe-save">${isMajor ? '新バージョンを作成' : '保存'}</button>
    </div>`);

  const daysEl = $('#pe-days');
  const bindItem = () => daysEl.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => {
    const items = b.closest('[data-pitems]');
    if (items.querySelectorAll('[data-pit]').length > 1) b.closest('[data-pit]').remove();
  });
  const bindDay = () => {
    daysEl.querySelectorAll('[data-additem]').forEach((b) => b.onclick = () => {
      $('[data-pitems]', b.closest('[data-pday]')).insertAdjacentHTML('beforeend', progExRow());
      bindItem();
    });
    daysEl.querySelectorAll('[data-rmday]').forEach((b) => b.onclick = () => {
      if (daysEl.querySelectorAll('[data-pday]').length > 1) b.closest('[data-pday]').remove();
    });
  };
  bindDay(); bindItem();
  $('#pe-addday').onclick = () => { daysEl.insertAdjacentHTML('beforeend', progDayHtml({})); bindDay(); bindItem(); };
  $('#pe-cancel').onclick = () => programModal();
  $('#pe-save').onclick = async () => {
    const days = [...daysEl.querySelectorAll('[data-pday]')].map((dEl) => ({
      name: $('[data-dayname]', dEl).value.trim() || 'Day',
      exercises: [...dEl.querySelectorAll('[data-pit]')].map((r) => ({
        exercise_id: Number($('[data-ex]', r).value),
        target_sets: $('[data-sets]', r).value,
        rep_min: $('[data-rmin]', r).value,
        rep_max: $('[data-rmax]', r).value,
        increment: r.dataset.inc || 2.5,
      })).filter((x) => x.exercise_id),
    })).filter((d) => d.exercises.length);
    if (!days.length) return toast('種目を入れてください');
    const name = $('#pe-name').value.trim() || (isMajor ? '新メニュー' : v.name);
    const note = $('#pe-note').value.trim();
    if (isMajor) await post('/api/program', { name, note, days, copy_from_version_id: v.id });
    else await put('/api/program/' + v.id, { name, days, change_description: note || '編集' });
    toast('保存しました');
    await programModal();
    if (state.view === 'home') renderers.home();
  };
}

// ==================================================
// ストレッチ（可動域改善）
// ==================================================
renderers.stretch = async function () {
  const el = $('#view-stretch');
  const date = state.stretchDate || todayStr();
  state.stretchDate = date;
  const [stretches, logs, sum] = await Promise.all([
    get('/api/stretches'),
    get('/api/stretch-logs?date=' + date),
    get('/api/stretch-summary?today=' + todayStr()),
  ]);
  const logBy = {};
  logs.forEach((l) => { logBy[Number(l.stretch_id)] = l; });

  const romHint = sum.rom_days_ago == null
    ? '📏 可動域（ROM）の初回記録をしておきましょう'
    : sum.rom_days_ago >= 28
      ? `📏 前回のROM記録から${Math.floor(sum.rom_days_ago / 7)}週経過。4週ごとの記録時期です`
      : '';

  const section = (timing, title, subtitle) => {
    const items = stretches.filter((s) => s.timing === timing);
    return `<div class="card">
      <div style="font-weight:600">${title}</div>
      <div class="muted small" style="margin-bottom:4px">${subtitle}</div>
      ${items.map((s) => {
        const l = logBy[s.id] || {};
        return `<div class="row" style="padding:8px 0;border-top:1px solid var(--border);align-items:center">
          <input type="checkbox" class="st-check" data-st="${s.id}" ${l.done ? 'checked' : ''}>
          <div class="grow small" style="min-width:0">
            <b>${esc(s.name)}</b>
            <div class="muted" style="font-size:11px">${esc(s.detail)} ・ ${esc(s.target)}</div>
          </div>
          ${timing === 'post'
            ? `<input type="number" inputmode="numeric" style="width:56px" placeholder="秒" data-sec="${s.id}" value="${l.seconds ?? ''}">`
            : ''}
        </div>`;
      }).join('')}
    </div>`;
  };

  el.innerHTML = `
    <div class="card">
      <div class="row between" style="align-items:center">
        <div><div class="muted small">今週の実施</div>
          <div class="big">${sum.days_this_week}<span class="unit muted" style="font-size:13px"> 日 / 目標3-5</span></div></div>
        <div class="field" style="margin:0"><label>記録する日</label>
          <input type="date" id="st-date" value="${date}"></div>
      </div>
      ${romHint ? `<div class="small" style="color:var(--accent);margin-top:6px">${romHint}</div>` : ''}
    </div>
    ${section('pre', '🔥 トレーニング前（動的）', 'トレ日に実施')}
    ${section('post', '🧘 トレ後・休息日（静的）', '各30〜60秒×2セット・週3〜5回')}
    <div class="card">
      <div class="row between" style="align-items:center">
        <div style="font-weight:600">📏 可動域（ROM）の記録</div>
        <button class="btn-ghost btn-sm" id="rom-add">＋ 記録</button>
      </div>
      <div class="muted small" style="margin:2px 0 4px">4週ごとに「スクワットの深さ」「前屈の指先位置」等をメモ</div>
      <div id="rom-list"></div>
    </div>`;

  $('#st-date').onchange = (e) => { state.stretchDate = e.target.value; renderers.stretch(); };

  const save = async (id) => {
    const done = $(`.st-check[data-st="${id}"]`).checked;
    const secEl = $(`[data-sec="${id}"]`);
    await post('/api/stretch-logs', {
      date: state.stretchDate, stretch_id: id, done, seconds: secEl ? secEl.value : null,
    });
  };
  el.querySelectorAll('.st-check').forEach((c) =>
    c.onchange = () => save(Number(c.dataset.st)).then(() => toast(c.checked ? '実施を記録 ✅' : '記録を解除')));
  el.querySelectorAll('[data-sec]').forEach((inp) =>
    inp.onchange = () => save(Number(inp.dataset.sec)));

  const roms = await get('/api/rom');
  $('#rom-list').innerHTML = roms.length
    ? roms.map((r) => `<div class="row between small" style="padding:6px 0;border-top:1px solid var(--border)">
        <div class="grow"><b>${fmtDate(r.date)}</b><div class="muted" style="white-space:pre-wrap">${esc(r.note)}</div></div>
        <button class="icon-btn" data-romdel="${r.id}">✕</button></div>`).join('')
    : '<div class="muted small" style="padding:6px 0">まだ記録がありません</div>';
  $('#rom-list').querySelectorAll('[data-romdel]').forEach((b) =>
    b.onclick = async () => {
      if (!confirm('このROM記録を削除しますか？')) return;
      await del('/api/rom/' + b.dataset.romdel); toast('削除しました'); renderers.stretch();
    });
  $('#rom-add').onclick = () => romModal();
};

function romModal() {
  openModal(`
    <h3>可動域（ROM）を記録</h3>
    <div class="field"><label>日付</label><input type="date" id="rom-date" value="${todayStr()}"></div>
    <div class="field"><label>メモ</label>
      <textarea id="rom-note" rows="4" placeholder="例:&#10;スクワット: パラレルまで沈めた&#10;前屈: 指先が床に触れた"></textarea></div>
    <div class="row">
      <button class="btn-ghost grow" id="rom-cancel">キャンセル</button>
      <button class="btn-primary grow" id="rom-save">保存</button>
    </div>`);
  $('#rom-cancel').onclick = closeModal;
  $('#rom-save').onclick = async () => {
    const note = $('#rom-note').value.trim();
    if (!note) return toast('メモを入れてください');
    await post('/api/rom', { date: $('#rom-date').value, note });
    closeModal(); toast('保存しました'); renderers.stretch();
  };
}

// ==================================================
// 食事管理
// ==================================================
renderers.meal = async function () {
  const meals = await get('/api/meals');
  const el = $('#view-meal');
  // 日付でグループ化
  const byDate = {};
  meals.forEach((m) => { (byDate[m.date] ||= []).push(m); });
  const today = todayStr();
  const tToday = (byDate[today] || []).reduce((a, m) => ({
    cal: a.cal + m.calories, p: a.p + m.protein, f: a.f + m.fat, c: a.c + m.carbs }),
    { cal: 0, p: 0, f: 0, c: 0 });

  el.innerHTML = `
    <button class="btn-primary btn-block" id="add-meal" style="margin-bottom:14px">＋ 食事を記録</button>
    <div class="card">
      <div class="muted small">今日の合計 (${fmtDate(today)})</div>
      <div class="row between" style="margin-top:8px">
        <div><div class="big accent">${round(tToday.p)}</div><div class="muted small">たんぱく質 g</div></div>
        <div class="right"><div class="big">${round(tToday.cal)}</div><div class="muted small">kcal</div></div>
      </div>
      <div class="row between small muted" style="margin-top:8px">
        <span>脂質 ${round(tToday.f)}g</span><span>炭水化物 ${round(tToday.c)}g</span>
      </div>
    </div>
    <div id="meal-list"></div>`;
  $('#add-meal').onclick = () => mealModal();

  const list = $('#meal-list');
  const dates = Object.keys(byDate).sort().reverse();
  if (!dates.length) { list.innerHTML = `<div class="empty">食事の記録がありません🍚</div>`; return; }
  list.innerHTML = dates.map((d) => {
    const items = byDate[d];
    const sum = items.reduce((a, m) => ({ cal: a.cal + m.calories, p: a.p + m.protein }), { cal: 0, p: 0 });
    return `<div class="card">
      <div class="row between" style="margin-bottom:6px">
        <b>${fmtDate(d)}</b>
        <span class="muted small">P ${round(sum.p)}g / ${round(sum.cal)}kcal</span>
      </div>
      ${items.map((m) => `<div class="row between small" style="padding:5px 0;border-top:1px solid var(--border)">
        <span class="grow">${esc(m.name) || '（無題）'}</span>
        <span class="muted">P${round(m.protein)} ${round(m.calories)}kcal</span>
        <button class="icon-btn" data-del="${m.id}">✕</button></div>`).join('')}
    </div>`;
  }).join('');
  list.querySelectorAll('[data-del]').forEach((b) =>
    b.onclick = async () => { await del('/api/meals/' + b.dataset.del); toast('削除しました'); renderers.meal(); });
};

function mealModal() {
  openModal(`
    <h3>食事を記録</h3>
    <div class="field"><label>日付</label><input type="date" id="m-date" value="${todayStr()}"></div>
    <div class="field"><label>メニュー名</label><input id="m-name" placeholder="例: 鶏むね肉とご飯"></div>
    <div class="field-row">
      <div class="field"><label>たんぱく質 (g)</label><input type="number" inputmode="decimal" id="m-p" placeholder="0"></div>
      <div class="field"><label>カロリー (kcal)</label><input type="number" inputmode="decimal" id="m-cal" placeholder="0"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>脂質 (g)</label><input type="number" inputmode="decimal" id="m-f" placeholder="0"></div>
      <div class="field"><label>炭水化物 (g)</label><input type="number" inputmode="decimal" id="m-c" placeholder="0"></div>
    </div>
    <div class="row">
      <button class="btn-ghost grow" id="m-cancel">キャンセル</button>
      <button class="btn-primary grow" id="m-save">保存</button>
    </div>`);
  $('#m-cancel').onclick = closeModal;
  $('#m-save').onclick = async () => {
    await post('/api/meals', {
      date: $('#m-date').value, name: $('#m-name').value,
      protein: $('#m-p').value, calories: $('#m-cal').value,
      fat: $('#m-f').value, carbs: $('#m-c').value,
    });
    closeModal(); toast('保存しました');
    if (state.view === 'meal') renderers.meal(); else if (state.view === 'home') renderers.home();
  };
}

// ==================================================
// 体組成
// ==================================================
renderers.body = async function () {
  const logs = await get('/api/body');
  const el = $('#view-body');
  el.innerHTML = `
    <button class="btn-primary btn-block" id="add-body" style="margin-bottom:14px">＋ 体組成を記録</button>
    <div class="card"><div class="muted small">体重の推移</div><canvas id="body-chart" data-height="170"></canvas></div>
    <div id="body-list"></div>`;
  $('#add-body').onclick = () => bodyModal();

  const labels = logs.map((l) => fmtDate(l.date).replace(/\(.+\)/, ''));
  Charts.line($('#body-chart'), labels, [
    { data: logs.map((l) => l.weight), color: '#4ade80' },
    { data: logs.map((l) => l.body_fat), color: '#60a5fa' },
  ]);

  const list = $('#body-list');
  if (!logs.length) { list.innerHTML = `<div class="empty">記録がありません⚖️</div>`; return; }
  list.innerHTML = [...logs].reverse().map((l) =>
    `<div class="card"><div class="row between">
      <div><b>${fmtDate(l.date)}</b>${l.note ? `<div class="muted small">📝 ${esc(l.note)}</div>` : ''}</div>
      <div class="right">
        <span class="accent" style="font-weight:700">${l.weight != null ? l.weight + ' kg' : '—'}</span>
        <span class="muted small"> / ${l.body_fat != null ? l.body_fat + ' %' : '—'}</span>
        <button class="icon-btn" data-del="${l.id}">✕</button>
      </div></div></div>`).join('');
  list.querySelectorAll('[data-del]').forEach((b) =>
    b.onclick = async () => { await del('/api/body/' + b.dataset.del); toast('削除しました'); renderers.body(); });
};

function bodyModal() {
  openModal(`
    <h3>体組成を記録</h3>
    <div class="field"><label>日付</label><input type="date" id="b-date" value="${todayStr()}"></div>
    <div class="field-row">
      <div class="field"><label>体重 (kg)</label><input type="number" inputmode="decimal" step="0.1" id="b-weight" placeholder="0.0"></div>
      <div class="field"><label>体脂肪率 (%)</label><input type="number" inputmode="decimal" step="0.1" id="b-fat" placeholder="0.0"></div>
    </div>
    <div class="field"><label>メモ</label><input id="b-note" placeholder="任意"></div>
    <div class="muted small" style="margin-bottom:12px">※ 同じ日付の記録は上書きされます</div>
    <div class="row">
      <button class="btn-ghost grow" id="b-cancel">キャンセル</button>
      <button class="btn-primary grow" id="b-save">保存</button>
    </div>`);
  $('#b-cancel').onclick = closeModal;
  $('#b-save').onclick = async () => {
    await post('/api/body', {
      date: $('#b-date').value, weight: $('#b-weight').value,
      body_fat: $('#b-fat').value, note: $('#b-note').value,
    });
    closeModal(); toast('保存しました');
    if (state.view === 'body') renderers.body(); else if (state.view === 'home') renderers.home();
  };
}

// ==================================================
// 統計
// ==================================================
renderers.stats = async function () {
  const el = $('#view-stats');
  el.innerHTML = `
    <div class="field"><label>種目を選択</label><select id="stat-ex">${exerciseOptions()}</select></div>
    <div class="card">
      <div class="row between"><div class="muted small">推定1RM の推移</div><span class="chip">Epley式</span></div>
      <canvas id="rm-chart" data-height="170"></canvas>
    </div>
    <div class="card"><div class="muted small">最大重量の推移</div><canvas id="maxw-chart" data-height="150"></canvas></div>
    <div class="card"><div class="muted small">セッション総挙上量</div><canvas id="vol-chart" data-height="150"></canvas></div>`;
  const draw = async () => {
    const id = $('#stat-ex').value;
    if (!id) return;
    const rows = await get('/api/stats/exercise/' + id);
    const labels = rows.map((r) => fmtDate(r.date).replace(/\(.+\)/, ''));
    Charts.line($('#rm-chart'), labels, [{ data: rows.map((r) => round(r.est_1rm)), color: '#4ade80' }]);
    Charts.line($('#maxw-chart'), labels, [{ data: rows.map((r) => r.max_weight), color: '#60a5fa' }]);
    Charts.bar($('#vol-chart'), labels, rows.map((r) => r.volume), '#a78bfa');
  };
  $('#stat-ex').onchange = draw;
  await draw();
};

// ---------- 起動 ----------
let _booted = false;
async function init() {
  try {
    await loadExercises();        // 401 なら showLogin が呼ばれて中断
  } catch (e) { return; }
  await switchView('home');
  if (_booted) return;
  _booted = true;
  // 画面回転・リサイズ時に現在ビューを再描画（チャート用）
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => {
    if (state.view === 'body' || state.view === 'stats') renderers[state.view]();
  }, 250); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
init();
