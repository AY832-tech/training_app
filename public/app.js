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
const titles = { home: 'ホーム', log: 'トレ記録', meal: '食事管理', body: '体組成', stats: '統計' };
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
  el.innerHTML = `
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
      <button class="btn-ghost btn-sm" id="manage-ex">種目を管理</button>
      <button class="btn-ghost btn-sm" id="manage-tpl">テンプレート</button>
    </div>
    <div id="workout-list"></div>`;
  $('#add-workout').onclick = () => workoutModal();
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

function setLineHtml(set = {}) {
  return `<div class="set-line" data-set>
    <span class="num">●</span>
    <select class="grow" data-ex>${exerciseOptions(set.exercise_id)}</select>
    <input type="number" inputmode="decimal" step="0.5" placeholder="kg" style="width:64px" data-w value="${set.weight ?? ''}">
    <input type="number" inputmode="numeric" placeholder="回" style="width:54px" data-r value="${set.reps ?? ''}">
    <button class="icon-btn" data-rm type="button">✕</button>
  </div>`;
}

async function workoutModal(existing) {
  const isEdit = !!existing;
  const sets = isEdit ? existing.sets : [{}];
  let tplOptions = '';
  try {
    const tpls = await get('/api/templates');
    if (tpls.length) tplOptions = `<div class="field"><label>テンプレートから読み込み</label>
      <select id="tpl-pick"><option value="">— 選択 —</option>${
        tpls.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>`;
    window._tpls = tpls;
  } catch (e) {}

  openModal(`
    <h3>${isEdit ? 'トレ記録を編集' : 'トレ記録'}</h3>
    <div class="field"><label>日付</label><input type="date" id="w-date" value="${existing?.date || todayStr()}"></div>
    ${isEdit ? '' : tplOptions}
    <label>種目・セット</label>
    <div id="sets">${sets.map(setLineHtml).join('')}</div>
    <button class="btn-ghost btn-block btn-sm" id="add-set" type="button" style="margin-bottom:12px">＋ セット追加</button>
    <div class="field"><label>メモ</label><textarea id="w-note" rows="2" placeholder="調子・気づきなど">${esc(existing?.note || '')}</textarea></div>
    <div class="row">
      ${isEdit ? `<button class="btn-danger" id="w-del">削除</button>` : ''}
      <button class="btn-ghost grow" id="w-cancel">キャンセル</button>
      <button class="btn-primary grow" id="w-save">保存</button>
    </div>`);

  const setsEl = $('#sets');
  const bind = () => setsEl.querySelectorAll('[data-rm]').forEach((b) =>
    b.onclick = () => { if (setsEl.children.length > 1) b.closest('[data-set]').remove(); });
  bind();
  $('#add-set').onclick = () => {
    // 直前のセットの種目を引き継ぐ
    const last = setsEl.lastElementChild;
    const exId = last ? $('[data-ex]', last).value : undefined;
    setsEl.insertAdjacentHTML('beforeend', setLineHtml({ exercise_id: exId }));
    bind();
  };
  if ($('#tpl-pick')) $('#tpl-pick').onchange = (e) => {
    const t = (window._tpls || []).find((x) => x.id === Number(e.target.value));
    if (!t) return;
    setsEl.innerHTML = t.items.flatMap((it) =>
      Array.from({ length: it.target_sets }, () => setLineHtml({ exercise_id: it.exercise_id, reps: it.target_reps }))
    ).join('') || setLineHtml();
    bind();
  };

  $('#w-cancel').onclick = closeModal;
  $('#w-save').onclick = async () => {
    const payload = {
      date: $('#w-date').value,
      note: $('#w-note').value,
      sets: [...setsEl.querySelectorAll('[data-set]')].map((r) => ({
        exercise_id: Number($('[data-ex]', r).value),
        weight: $('[data-w]', r).value,
        reps: $('[data-r]', r).value,
      })).filter((s) => s.exercise_id && (s.reps !== '' || s.weight !== '')),
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
