/**
 * 数値・日付のフォーマット共通ユーティリティ
 */
(function (global) {
  "use strict";

  function formatYen(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return "-";
    return `${Math.round(v).toLocaleString("ja-JP")}円`;
  }

  function formatPercent(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return "-";
    return `${Number(v).toFixed(2)}%`;
  }

  function formatRatio(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return "-";
    return `${Number(v).toFixed(1)}%`;
  }

  function formatMonthsToYM(months) {
    if (!(months >= 0)) return "-";
    const y = Math.floor(months / 12);
    const m = months % 12;
    if (y === 0) return `${m}ヶ月`;
    if (m === 0) return `${y}年`;
    return `${y}年${m}ヶ月`;
  }

  /**
   * startMonth: "YYYY-MM" 形式（<input type="month">の値）。offsetMonths: 借入開始月を1回目とした経過月数(1始まり)。
   * 戻り値: "YYYY年M月" 形式の文字列。startMonthが無ければ null。
   */
  function formatCalendarMonth(startMonth, offsetMonths) {
    if (!startMonth) return null;
    const [y, m] = startMonth.split("-").map(Number);
    if (!y || !m) return null;
    const total = (y * 12 + (m - 1)) + (offsetMonths - 1);
    const outYear = Math.floor(total / 12);
    const outMonth = (total % 12) + 1;
    return `${outYear}年${outMonth}月`;
  }

  global.LoanFormat = {
    formatYen,
    formatPercent,
    formatRatio,
    formatMonthsToYM,
    formatCalendarMonth,
  };
})(window);
