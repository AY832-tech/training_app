'use strict';
// 種目ピクトグラム（棒人間の線画SVG）。種目名で照合し、無ければ汎用ダンベル。
(function () {
  const S = (inner) =>
    `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const GROUND = '<path d="M5 44h38" stroke-opacity=".3"/>';
  const dot = (x, y, r = 1.7) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
  const head = (x, y, r = 3.1) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;

  // ベンチ（フラット）
  const FLATBENCH = '<path d="M8 33h26M12 33v7M30 33v7"/>';
  // 仰向けの胴体＋脚（ベンチ上）
  const LIE = '<path d="M14 29h13"/><path d="M14 29 9 34v8"/>' + head(32, 28);

  const ICONS = {
    'ベンチプレス': S(FLATBENCH + LIE + '<path d="M26 29V17"/><path d="M16 15h20M18 10v10M34 10v10"/>'),
    'ダンベルプレス': S(FLATBENCH + LIE + '<path d="M23 29V19M30 29V19"/><path d="M19 17h8M26 17h8"/>' + dot(19, 17) + dot(27, 17) + dot(34, 17)),
    'チェストフライ': S(FLATBENCH + LIE + '<path d="M26 29 18 16M26 29 34 16"/>' + dot(18, 16) + dot(34, 16)),
    'インクラインダンベルプレス': S(GROUND + '<path d="M9 42 25 26M9 42h9"/><path d="M13 39 23 29"/>' + head(26, 26) + '<path d="M21 31 29 17"/><path d="M25 15l8 2"/>' + dot(25, 15) + dot(33, 17) + '<path d="M13 39l-3 5"/>'),
    'ディップス': S('<path d="M8 21h12M28 21h12"/>' + head(24, 9) + '<path d="M24 13v14"/><path d="M24 15l-8 6M24 15l8 6"/><path d="M24 27l-3 7 4 5"/>'),
    'ケーブルフライ': S(FLATBENCH + LIE + '<path d="M26 29 18 16M26 29 34 16"/><path d="M18 16 12 8M34 16l6-8" stroke-dasharray="2.5 2.5"/>' + dot(18, 16) + dot(34, 16)),

    'ラットプルダウン': S(dot(24, 5, 1.5) + '<path d="M24 6v6" stroke-dasharray="2.5 2.5"/><path d="M13 13h22"/>' + head(24, 20) + '<path d="M24 24v10"/><path d="M24 26 15 14M24 26l9-12"/><path d="M24 34h8v8"/>'),
    '懸垂': S('<path d="M10 7h28"/><path d="M18 7l4 8M30 7l-4 8"/>' + head(24, 13) + '<path d="M24 16v13"/><path d="M24 29l-4 6 3 5"/>'),
    'デッドリフト': S(GROUND + '<circle cx="31" cy="37" r="5.5"/>' + dot(31, 37, 1.4) + '<path d="M20 44l1-11"/><path d="M21 33 28 22"/>' + head(31, 19) + '<path d="M28 22l3 10"/>'),
    'ベントオーバーロウ': S(GROUND + '<circle cx="29" cy="36" r="4.5"/>' + dot(29, 36, 1.3) + '<path d="M19 44l2-11"/><path d="M21 33 29 23"/>' + head(32, 20) + '<path d="M29 23l0 6 0 3"/>'),
    'フェイスプル': S(GROUND + head(18, 11) + '<path d="M18 14v14"/><path d="M18 17l6-2 5-2"/><path d="M30 13l12-2" stroke-dasharray="2.5 2.5"/>' + dot(43, 11, 1.5) + '<path d="M18 28l-3 8-1 8M18 28l4 8v8"/>'),

    'スクワット': S(GROUND + '<path d="M12 17h24M14 13v8M34 13v8"/>' + head(24, 11) + '<path d="M23 17l-3 11"/><path d="M20 28l8 5"/><path d="M28 33l-2 9"/>'),
    'ルーマニアンデッドリフト': S(GROUND + '<circle cx="27" cy="31" r="4.5"/>' + dot(27, 31, 1.3) + '<path d="M20 44l1-12"/><path d="M21 32l8-10"/>' + head(32, 19) + '<path d="M29 22l-2 7"/>'),
    'レッグプレス': S(GROUND + '<path d="M7 34 17 24"/>' + head(19, 22) + '<path d="M17 26l6 8"/><path d="M23 34l8-7 5-7"/><path d="M32 13l10 12"/><path d="M23 37v7"/>'),
    'レッグカール': S('<path d="M8 31h24M12 31v9M28 31v9"/><path d="M10 29h16"/>' + head(8, 27) + '<path d="M26 29l7 2"/><path d="M33 31l2-9"/>' + dot(35, 22, 1.9)),
    'ブルガリアンスクワット': S(GROUND + '<path d="M34 33h9M36 33v7M42 33v7"/>' + head(18, 10) + '<path d="M18 13l-1 13"/><path d="M17 26l7 5-1 10"/><path d="M17 26l12 4 8 2"/><path d="M18 17l-4 8"/>' + dot(14, 26)),
    'スタンディングカーフレイズ': S(GROUND + '<path d="M22 40h12M22 40v4M34 40v4"/>' + head(27, 8) + '<path d="M27 11v16"/><path d="M27 27l-1 10"/><path d="M26 37l4 2"/><path d="M13 22V11m0 0-3 3m3-3 3 3"/>'),
    'シーテッドカーフレイズ': S(GROUND + head(17, 13) + '<path d="M17 16v13"/><path d="M17 29h11"/><path d="M23 26h8"/><path d="M28 29v9"/><path d="M28 38l4 2"/><path d="M27 42h8"/><path d="M17 29l-4 7v8"/>'),

    'ショルダープレス': S(GROUND + '<path d="M13 9h22M15 5v8M33 5v8"/>' + head(24, 16) + '<path d="M24 20l-7-9M24 20l7-9"/><path d="M24 20v10"/><path d="M24 30l-3 7v7M24 30l3 7v7"/>'),
    'サイドレイズ': S(GROUND + head(24, 9) + '<path d="M24 12v14"/><path d="M24 16H11M24 16h13"/>' + dot(10, 16) + dot(38, 16) + '<path d="M24 26l-3 9v9M24 26l3 9v9"/>'),

    'バーベルカール': S(GROUND + head(21, 9) + '<path d="M21 12v16"/><path d="M21 16v9"/><path d="M21 25l8-5"/><circle cx="30" cy="20" r="3.8"/>' + dot(30, 20, 1.2) + '<path d="M21 28l-3 8v8M21 28l4 8v8"/>'),
    'ダンベルカール': S(GROUND + head(21, 9) + '<path d="M21 12v16"/><path d="M21 16v9"/><path d="M21 25l8-5"/><path d="M27 17l6 5"/>' + dot(27, 17) + dot(33, 22) + '<path d="M21 28l-3 8v8M21 28l4 8v8"/>'),
    'トライセプスプレスダウン': S(GROUND + dot(31, 5, 1.5) + '<path d="M31 6v16" stroke-dasharray="2.5 2.5"/>' + head(19, 9) + '<path d="M19 12v16"/><path d="M19 16l6 3"/><path d="M25 19l6 5"/><path d="M26 24h10"/><path d="M19 28l-3 8v8M19 28l4 8v8"/>'),
    'アブローラー': S(GROUND + '<circle cx="36" cy="39" r="4.2"/>' + dot(36, 39, 1.3) + '<path d="M14 41l-6 2"/><path d="M14 41l4-8"/><path d="M18 33l12-7"/>' + head(33, 23) + '<path d="M30 26l5 10"/>'),
    'プランク': S(GROUND + '<path d="M9 39h8"/><path d="M13 39v-6"/>' + head(10, 30) + '<path d="M13 33l25 6"/><path d="M38 39l2 4"/>'),
    'ケーブルウッドチョップ': S(GROUND + dot(42, 8, 1.5) + '<path d="M41 9 31 15" stroke-dasharray="2.5 2.5"/>' + head(20, 10) + '<path d="M20 13l2 14"/><path d="M20 17l6-1 5-1"/><path d="M22 27l-4 8-1 9M22 27l4 8v9"/>'),
    'プランク（プレート）': null, // 予備

    // ===== ストレッチ =====
    'レッグスイング（前後・左右）': S(GROUND + '<path d="M9 8v28"/>' + head(21, 9) + '<path d="M21 12v14"/><path d="M21 16l-9-1"/><path d="M21 26l-2 9-1 9"/><path d="M21 26l9-6"/><path d="M27 31q7-3 5-13" stroke-dasharray="2.5 2.5"/>'),
    'ワールドグレイテストストレッチ': S(GROUND + head(29, 19) + '<path d="M14 42v-8l6-2"/><path d="M20 32l18 10"/><path d="M20 32l6-10"/><path d="M26 22l-5 16"/><path d="M26 22l4-11"/>' + dot(30, 10)),
    '肩回し＋バンドプルアパート': S(GROUND + head(24, 9) + '<path d="M24 12v14"/><path d="M24 16H10M24 16h14"/><path d="M10 17c9 5 19 5 28 0" stroke-dasharray="2.5 2.5"/><path d="M24 26l-3 9v9M24 26l3 9v9"/>'),
    '自重スクワット底で3秒静止': S(GROUND + head(23, 14) + '<path d="M23 17l-2 9"/><path d="M21 26l9 4"/><path d="M30 30l-3 12"/><path d="M23 20h10"/>'),
    '長座体前屈': S(GROUND + '<path d="M13 41h23"/><path d="M36 41l1-5"/>' + head(27, 30) + '<path d="M14 39l10-7"/><path d="M25 33l9 5"/>'),
    'ハーフニーリングランジ': S(GROUND + head(27, 15) + '<path d="M27 18l-1 14"/><path d="M26 32l-10 0"/><path d="M16 32l-2 10"/><path d="M26 32l3 10"/><path d="M29 42h8"/>'),
    'カエルストレッチ': S(GROUND + head(11, 33) + '<path d="M13 35l15 1"/><path d="M28 36l4 6"/><path d="M32 42h6"/><path d="M10 40h9"/>'),
    '壁ドリル（足首背屈）': S(GROUND + '<path d="M38 8v34"/>' + head(21, 12) + '<path d="M21 15l5 13"/><path d="M21 19l15-3"/><path d="M26 28l4 6v8"/><path d="M26 28l-4 8v8"/>'),
    'ピジョンストレッチ': S(GROUND + '<path d="M12 41l10-2"/><path d="M22 39l16 3"/>' + head(21, 21) + '<path d="M22 38l-1-14"/><path d="M21 28l-7 10"/>'),
    'ドアフレームストレッチ': S(GROUND + '<path d="M31 6v38"/>' + head(17, 10) + '<path d="M17 13v15"/><path d="M17 16l14-2"/><path d="M17 28l-4 8-2 8"/><path d="M17 28l6 7 2 9"/>'),
    'バーぶら下がり': S('<path d="M10 7h28"/><path d="M19 7l4 11M29 7l-4 11"/>' + head(24, 21) + '<path d="M24 24v10"/><path d="M24 34l-2 8M24 34l2 8"/>'),
    'フォームローラー胸椎そらし': S(GROUND + '<circle cx="26" cy="38" r="4"/>' + dot(26, 38, 1.2) + '<path d="M8 42l8-8"/><path d="M16 34c4-4 8-6 13-4"/>' + head(32, 32) + '<path d="M29 30l7 3"/>'),
  };
  ICONS['ケーブルプレスダウン'] = ICONS['トライセプスプレスダウン'];

  // ===== マシン種目 =====
  // レッグエクステンション（シートに座り膝を伸ばす）
  ICONS['レッグエクステンション'] = S(GROUND + '<path d="M10 27h14M12 27v13M26 27v13"/>' +
    head(16, 15) + '<path d="M16 18v10"/><path d="M16 28l10 1"/><path d="M26 29l9-6"/>' + dot(35, 23, 1.9));
  // シーテッドロー（座って引く）
  ICONS['シーテッドロー（マシン）'] = S(GROUND + '<path d="M12 41h10"/><path d="M16 41v-6"/>' +
    head(18, 17) + '<path d="M18 20l-2 15"/><path d="M18 24l9 1"/><path d="M27 25h8" stroke-dasharray="2.5 2.5"/>' +
    dot(36, 25, 1.5) + '<path d="M16 35l10 0 5 6"/>');
  // ヒップアブダクション（座って脚を開く）
  ICONS['ヒップアブダクション（マシン）'] = S(GROUND + '<path d="M14 27h20M16 27v13M32 27v13"/>' +
    head(24, 14) + '<path d="M24 17v10"/><path d="M24 27l-8 9-1 6M24 27l8 9 1 6"/>');
  // ヒップアダクション（座って脚を閉じる・内向き矢印イメージ）
  ICONS['ヒップアダクション（マシン）'] = S(GROUND + '<path d="M14 27h20M16 27v13M32 27v13"/>' +
    head(24, 14) + '<path d="M24 17v10"/><path d="M24 27l-5 9v6M24 27l5 9v6"/><path d="M13 33l4 2M35 33l-4 2"/>');
  // アブドミナルクランチ（マシンで上体を丸める）
  ICONS['アブドミナルクランチ（マシン）'] = S(GROUND + '<path d="M12 41h12"/><path d="M16 41v-7"/>' +
    head(21, 16) + '<path d="M21 19c1 5-1 9-5 12"/><path d="M21 20l7-2"/>' + dot(28, 18, 1.5) +
    '<path d="M16 31l9 3 4 7"/>');
  // 既存アイコンの流用（動作がほぼ同じもの）
  ICONS['チェストプレス（マシン）'] = ICONS['ベンチプレス'];
  ICONS['スミスマシンベンチプレス'] = ICONS['ベンチプレス'];
  ICONS['ペックフライ（マシン）'] = ICONS['チェストフライ'];
  ICONS['ケーブルクロスオーバー'] = ICONS['ケーブルフライ'];
  ICONS['アシストチンニング（マシン）'] = ICONS['懸垂'];
  ICONS['ストレートアームプルダウン'] = ICONS['ラットプルダウン'];
  ICONS['マシンショルダープレス'] = ICONS['ショルダープレス'];
  ICONS['リアデルトフライ（マシン）'] = ICONS['フェイスプル'];
  ICONS['ケーブルサイドレイズ'] = ICONS['サイドレイズ'];
  ICONS['ハックスクワット'] = ICONS['レッグプレス'];
  ICONS['スミスマシンスクワット'] = ICONS['スクワット'];
  ICONS['ケーブルカール'] = ICONS['ダンベルカール'];
  ICONS['プリーチャーカール（マシン）'] = ICONS['バーベルカール'];
  ICONS['トライセプスエクステンション（マシン）'] = ICONS['トライセプスプレスダウン'];
  ICONS['ロータリートルソー'] = ICONS['ケーブルウッドチョップ'];

  const DEFAULT = S('<path d="M16 24h16"/><path d="M14 18v12M34 18v12"/><path d="M10 21v6M38 21v6"/>');
  // ストレッチ用の汎用（前屈する人）
  const ST_DEFAULT = S(GROUND + '<path d="M13 41h23"/><path d="M36 41l1-5"/>' + head(27, 30) + '<path d="M14 39l10-7"/><path d="M25 33l9 5"/>');

  window.exIcon = (name, kind) => ICONS[name] || (kind === 'stretch' ? ST_DEFAULT : DEFAULT);
})();
