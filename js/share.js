/**
 * 入力状態の永続化・共有まわり
 *  - localStorage への自動保存/復元（端末ごと）
 *  - URLクエリパラメータへのエンコード/デコード（PC/スマホ間の共有用リンク）
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "loanSimulator.state.v1";

  const QUERY_KEY_MAP = {
    propertyPrice: "pr",
    renovationCost: "rf",
    ownFunds: "of",
    annualRate: "ar",
    startMonth: "sm",
    termYears: "ty",
    termMonthsExtra: "tm",
    repaymentType: "rt",
    graceMonths: "gm",
    graceRate: "gr",
    rateChanges: "rc",
    prepayments: "pp",
    scenarioDelta1: "d1",
    scenarioDelta2: "d2",
    monthlyRent: "mr",
  };

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // localStorageが使えない環境（プライベートブラウズ等）は無視する
      console.warn("localStorageへの保存に失敗しました", e);
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function encodeStateToQuery(state) {
    const params = new URLSearchParams();
    for (const [key, shortKey] of Object.entries(QUERY_KEY_MAP)) {
      const value = state[key];
      if (value === undefined || value === null || value === "") continue;
      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        params.set(shortKey, JSON.stringify(value));
      } else {
        params.set(shortKey, String(value));
      }
    }
    return params.toString();
  }

  function decodeStateFromQuery(search) {
    const params = new URLSearchParams(search);

    const reverseMap = {};
    for (const [key, shortKey] of Object.entries(QUERY_KEY_MAP)) reverseMap[shortKey] = key;
    // 旧仕様の共有リンク（la=借入金額, dp=頭金）も読み取れるようにする
    reverseMap.la = "propertyPrice";
    reverseMap.dp = "ownFunds";

    // 認識できるキー（la, ar, rc など）が1つも無ければ、共有リンクではないとみなして無視する
    const hasKnownKey = [...params.keys()].some((k) => !!reverseMap[k]);
    if (!hasKnownKey) return null;

    const state = {};
    for (const [shortKey, rawValue] of params.entries()) {
      const key = reverseMap[shortKey];
      if (!key) continue;
      if (key === "rateChanges" || key === "prepayments") {
        try {
          state[key] = JSON.parse(rawValue);
        } catch (e) {
          state[key] = [];
        }
      } else if (key === "startMonth" || key === "repaymentType") {
        state[key] = rawValue;
      } else {
        const num = Number(rawValue);
        state[key] = Number.isNaN(num) ? rawValue : num;
      }
    }
    return state;
  }

  function buildShareUrl(state) {
    const query = encodeStateToQuery(state);
    const url = new URL(global.location.href);
    url.search = query;
    return url.toString();
  }

  global.LoanShare = {
    saveState,
    loadState,
    encodeStateToQuery,
    decodeStateFromQuery,
    buildShareUrl,
  };
})(window);
