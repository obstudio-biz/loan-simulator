/**
 * UIの配線: フォーム入力 -> calc.js呼び出し -> 画面描画（サマリー・グラフ・償還表）
 */
(function () {
  "use strict";

  const F = window.LoanFormat;

  // ---------------- 動的リストの内部状態 ----------------
  let rateChangeRows = []; // [{id, month, rate}]
  let prepaymentRows = []; // [{id, month, amount, type}]
  let rowIdSeq = 1;

  let latestResult = { rows: [], summary: null };
  let latestInput = null;

  // ---------------- DOM取得ヘルパー ----------------
  const el = (id) => document.getElementById(id);

  function debounce(fn, wait) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  // ---------------- フォーム <-> state ----------------
  function readFormState() {
    const repaymentType = document.querySelector('input[name="repaymentType"]:checked').value;
    return {
      propertyPrice: Number(el("propertyPrice").value) || 0,
      renovationCost: Number(el("renovationCost").value) || 0,
      ownFunds: Number(el("ownFunds").value) || 0,
      annualRate: Number(el("annualRate").value) || 0,
      startMonth: el("startMonth").value || "",
      termYears: Number(el("termYears").value) || 0,
      termMonthsExtra: Number(el("termMonthsExtra").value) || 0,
      repaymentType,
      graceMonths: Number(el("graceMonths").value) || 0,
      graceRate: el("graceRate").value === "" ? null : Number(el("graceRate").value),
      rateChanges: rateChangeRows.map((r) => ({ month: Number(r.month) || 1, annualRatePercent: Number(r.rate) || 0 })),
      prepayments: prepaymentRows.map((r) => ({ month: Number(r.month) || 1, amount: Number(r.amount) || 0, type: r.type })),
      scenarioDelta1: Number(el("scenarioDelta1").value) || 0,
      scenarioDelta2: Number(el("scenarioDelta2").value) || 0,
      monthlyRent: Number(el("monthlyRent").value) || 0,
    };
  }

  function migrateLegacyState(state) {
    if (!state) return state;
    // 旧仕様（借入金額・頭金）で保存されたデータは、物件価格＝当時の借入金額、自己資金＝当時の頭金として読み替える
    if (state.propertyPrice == null && state.loanAmount != null) state.propertyPrice = state.loanAmount;
    if (state.ownFunds == null && state.downPayment != null) state.ownFunds = state.downPayment;
    return state;
  }

  function applyStateToForm(state) {
    if (!state) return;
    state = migrateLegacyState(state);
    if (state.propertyPrice != null) el("propertyPrice").value = state.propertyPrice;
    el("renovationCost").value = state.renovationCost ? state.renovationCost : "";
    if (state.ownFunds != null) el("ownFunds").value = state.ownFunds;
    if (state.annualRate != null) el("annualRate").value = state.annualRate;
    if (state.startMonth != null) el("startMonth").value = state.startMonth;
    if (state.termYears != null) el("termYears").value = state.termYears;
    if (state.termMonthsExtra != null) el("termMonthsExtra").value = state.termMonthsExtra;
    if (state.repaymentType) {
      const radio = document.querySelector(`input[name="repaymentType"][value="${state.repaymentType}"]`);
      if (radio) radio.checked = true;
    }
    if (state.graceMonths != null) el("graceMonths").value = state.graceMonths;
    el("graceRate").value = state.graceRate == null ? "" : state.graceRate;
    if (state.scenarioDelta1 != null) el("scenarioDelta1").value = state.scenarioDelta1;
    if (state.scenarioDelta2 != null) el("scenarioDelta2").value = state.scenarioDelta2;
    el("monthlyRent").value = state.monthlyRent ? state.monthlyRent : "";

    rateChangeRows = (state.rateChanges || []).map((r) => ({ id: rowIdSeq++, month: r.month, rate: r.annualRatePercent }));
    prepaymentRows = (state.prepayments || []).map((p) => ({ id: rowIdSeq++, month: p.month, amount: p.amount, type: p.type }));
    renderRateChangeList();
    renderPrepaymentList();
  }

  // ---------------- 動的リスト: 金利変更 ----------------
  function renderRateChangeList() {
    const container = el("rateChangeList");
    if (rateChangeRows.length === 0) {
      container.innerHTML = '<p class="empty-hint">登録されている金利変更はありません。</p>';
      return;
    }
    container.innerHTML = "";
    for (const row of rateChangeRows) {
      const div = document.createElement("div");
      div.className = "dynamic-row";
      div.innerHTML = `
        <label class="field">
          <span class="field__label">何ヶ月目から</span>
          <input type="number" inputmode="numeric" min="1" step="1" value="${row.month ?? ""}" data-role="month" />
        </label>
        <label class="field">
          <span class="field__label">変更後の年利 <span class="field__unit">%</span></span>
          <input type="number" inputmode="decimal" min="0" step="0.01" value="${row.rate ?? ""}" data-role="rate" />
        </label>
        <button type="button" class="btn btn--danger" data-role="remove">削除</button>
      `;
      div.querySelector('[data-role="month"]').addEventListener("input", (e) => {
        row.month = e.target.value;
        scheduleRecalc();
      });
      div.querySelector('[data-role="rate"]').addEventListener("input", (e) => {
        row.rate = e.target.value;
        scheduleRecalc();
      });
      div.querySelector('[data-role="remove"]').addEventListener("click", () => {
        rateChangeRows = rateChangeRows.filter((r) => r.id !== row.id);
        renderRateChangeList();
        scheduleRecalc();
      });
      container.appendChild(div);
    }
  }

  function addRateChangeRow() {
    rateChangeRows.push({ id: rowIdSeq++, month: 12, rate: (Number(el("annualRate").value) || 0) + 1 });
    renderRateChangeList();
    scheduleRecalc();
  }

  // ---------------- 動的リスト: 繰り上げ返済 ----------------
  function renderPrepaymentList() {
    const container = el("prepaymentList");
    if (prepaymentRows.length === 0) {
      container.innerHTML = '<p class="empty-hint">登録されている繰り上げ返済はありません。</p>';
      return;
    }
    container.innerHTML = "";
    for (const row of prepaymentRows) {
      const div = document.createElement("div");
      div.className = "dynamic-row dynamic-row--triple";
      div.innerHTML = `
        <label class="field">
          <span class="field__label">実行月（何ヶ月目）</span>
          <input type="number" inputmode="numeric" min="1" step="1" value="${row.month ?? ""}" data-role="month" />
        </label>
        <label class="field">
          <span class="field__label">繰上げ額 <span class="field__unit">円</span></span>
          <input type="number" inputmode="numeric" min="0" step="10000" value="${row.amount ?? ""}" data-role="amount" />
        </label>
        <label class="field">
          <span class="field__label">種別</span>
          <select data-role="type">
            <option value="shortenTerm" ${row.type === "shortenTerm" ? "selected" : ""}>期間短縮型</option>
            <option value="reducePayment" ${row.type === "reducePayment" ? "selected" : ""}>返済額軽減型</option>
          </select>
        </label>
        <button type="button" class="btn btn--danger" data-role="remove">削除</button>
      `;
      div.querySelector('[data-role="month"]').addEventListener("input", (e) => {
        row.month = e.target.value;
        scheduleRecalc();
      });
      div.querySelector('[data-role="amount"]').addEventListener("input", (e) => {
        row.amount = e.target.value;
        scheduleRecalc();
      });
      div.querySelector('[data-role="type"]').addEventListener("change", (e) => {
        row.type = e.target.value;
        scheduleRecalc();
      });
      div.querySelector('[data-role="remove"]').addEventListener("click", () => {
        prepaymentRows = prepaymentRows.filter((r) => r.id !== row.id);
        renderPrepaymentList();
        scheduleRecalc();
      });
      container.appendChild(div);
    }
  }

  function addPrepaymentRow() {
    prepaymentRows.push({ id: rowIdSeq++, month: 24, amount: 1000000, type: "shortenTerm" });
    renderPrepaymentList();
    scheduleRecalc();
  }

  // ---------------- 計算入力の組み立て ----------------
  function acquisitionCostFrom(state) {
    return (Number(state.propertyPrice) || 0) + (Number(state.renovationCost) || 0);
  }

  function buildCalcInput(state, rateOverridePercent) {
    const acquisitionCost = acquisitionCostFrom(state);
    const principal = Math.max(acquisitionCost - (Number(state.ownFunds) || 0), 0);
    const termMonths = state.termYears * 12 + state.termMonthsExtra;
    const delta = rateOverridePercent || 0;

    return {
      acquisitionCost,
      principal,
      annualRatePercent: state.annualRate + delta,
      termMonths,
      repaymentType: state.repaymentType,
      graceMonths: state.graceMonths,
      graceAnnualRatePercent: state.graceRate == null ? null : state.graceRate + delta,
      rateChanges: state.rateChanges
        .filter((r) => r.month >= 1)
        .map((r) => ({ month: r.month, annualRatePercent: r.annualRatePercent + delta })),
      prepayments: state.prepayments.filter((p) => p.month >= 1 && p.amount > 0),
    };
  }

  function annualPaymentFromSummary(summary) {
    return summary.firstPayment * 12;
  }

  function repaymentRatio(summary, monthlyRent) {
    if (!(monthlyRent > 0)) return null;
    const annualRent = monthlyRent * 12;
    if (!(annualRent > 0)) return null;
    return (annualPaymentFromSummary(summary) / annualRent) * 100;
  }

  // ---------------- 描画 ----------------
  function renderSummary(state, calcInput, result) {
    const { summary } = result;
    const isEqualPayment = state.repaymentType === "equalPayment";
    // 金利変更イベントや繰り上げ返済があると、元利均等でも返済額が途中で変わるため「初回」を明示する
    const hasVariability = calcInput.rateChanges.length > 0 || calcInput.prepayments.some((p) => p.type === "reducePayment");
    const payoffLabel = state.startMonth
      ? F.formatCalendarMonth(state.startMonth, summary.payoffMonth || 0) || "-"
      : summary.payoffMonth
      ? `${summary.payoffMonth}回目`
      : "-";

    const cards = [
      { label: "借入金額", value: F.formatYen(calcInput.principal) },
      { label: isEqualPayment && !hasVariability ? "毎月の返済額" : "毎月の返済額（初回）", value: F.formatYen(summary.firstPayment) },
      { label: "総返済額", value: F.formatYen(summary.totalPayment) },
      { label: "総利息", value: F.formatYen(summary.totalInterest) },
      { label: "完済までの期間", value: F.formatMonthsToYM(summary.payoffMonth) },
      { label: "完済予定", value: payoffLabel },
    ];
    if (!isEqualPayment || hasVariability) {
      cards.splice(2, 0, { label: "毎月の返済額（最終回）", value: F.formatYen(summary.lastPayment) });
    }
    const ratio = repaymentRatio(summary, state.monthlyRent);
    if (ratio != null) {
      cards.push({ label: "返済比率", value: F.formatRatio(ratio) });
    }

    const html = cards
      .map(
        (c) => `
        <div class="summary-card">
          <div class="summary-card__label">${c.label}</div>
          <div class="summary-card__value">${c.value}</div>
        </div>
      `
      )
      .join("");
    el("summaryGrid").innerHTML = html;
    el("summaryGridMobile").innerHTML = html;
  }

  function renderScenarioTable(state) {
    const scenarios = [
      { label: "現在の金利", delta: 0 },
      { label: `+${state.scenarioDelta1.toFixed(2)}%上昇`, delta: state.scenarioDelta1 },
      { label: `+${state.scenarioDelta2.toFixed(2)}%上昇`, delta: state.scenarioDelta2 },
    ];
    const showRatio = state.monthlyRent > 0;
    const table = el("scenarioTable");
    table.classList.toggle("hide-ratio", !showRatio);

    const tbody = table.querySelector("tbody");
    tbody.innerHTML = scenarios
      .map((s) => {
        const input = buildCalcInput(state, s.delta);
        const { summary } = window.LoanCalc.generateSchedule(input);
        const annualPay = annualPaymentFromSummary(summary);
        const ratio = repaymentRatio(summary, state.monthlyRent);
        return `
          <tr>
            <td>${s.label}</td>
            <td>${F.formatPercent(state.annualRate + s.delta)}</td>
            <td>${F.formatYen(summary.firstPayment)}</td>
            <td>${F.formatYen(annualPay)}</td>
            <td class="col-ratio">${ratio == null ? "-" : F.formatRatio(ratio)}</td>
            <td>${F.formatYen(summary.totalPayment)}</td>
            <td>${F.formatYen(summary.totalInterest)}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderScheduleTable(rows, startMonth) {
    const wrap = el("scheduleTable");
    if (!rows.length) {
      wrap.innerHTML = '<p class="empty-hint">条件を入力すると償還表が表示されます。</p>';
      return;
    }

    const showDate = !!startMonth;
    const years = window.LoanChart.groupByYear(rows);

    const html = years
      .map((yearRows, idx) => {
        const yearNo = idx + 1;
        const startM = yearRows[0].month;
        const endM = yearRows[yearRows.length - 1].month;
        const yearInterest = yearRows.reduce((s, r) => s + r.interest, 0);
        const yearPrincipal = yearRows.reduce((s, r) => s + r.principal, 0);

        const bodyRows = yearRows
          .map((r) => {
            const cls = r.prepayment > 0 ? "row--prepay" : r.phase === "grace" ? "row--grace" : "";
            const dateCell = showDate ? `<td>${F.formatCalendarMonth(startMonth, r.month) || "-"}</td>` : "";
            return `<tr class="${cls}"><td>${r.month}</td>${dateCell}<td>${F.formatYen(r.payment)}</td><td>${F.formatYen(r.principal)}</td><td>${F.formatYen(r.interest)}</td><td>${F.formatYen(r.balance)}</td></tr>`;
          })
          .join("");

        return `
          <details class="year-group">
            <summary>
              <span>${yearNo}年目（${startM}〜${endM}回）</span>
              <span class="year-group__sub">元金 ${F.formatYen(yearPrincipal)} / 利息 ${F.formatYen(yearInterest)}</span>
            </summary>
            <div class="table-scroll">
              <table class="schedule-table">
                <thead>
                  <tr>
                    <th>回</th>
                    ${showDate ? "<th>年月</th>" : ""}
                    <th>返済額</th>
                    <th>元金</th>
                    <th>利息</th>
                    <th>残高</th>
                  </tr>
                </thead>
                <tbody>${bodyRows}</tbody>
              </table>
            </div>
          </details>
        `;
      })
      .join("");

    wrap.innerHTML = html;
  }

  function buildPdfInputSnapshot(state, calcInput) {
    const repaymentTypeLabel = state.repaymentType === "equalPayment" ? "元利均等返済" : "元金均等返済";
    const rateChangeLabels = state.rateChanges
      .filter((r) => r.month >= 1)
      .map((r) => `${r.month}ヶ月目〜 ${F.formatPercent(r.annualRatePercent)}`);
    const prepaymentLabels = state.prepayments
      .filter((p) => p.month >= 1 && p.amount > 0)
      .map((p) => `${p.month}ヶ月目 ${F.formatYen(p.amount)}（${p.type === "shortenTerm" ? "期間短縮型" : "返済額軽減型"}）`);

    return {
      propertyPrice: state.propertyPrice,
      renovationCost: state.renovationCost,
      acquisitionCost: calcInput.acquisitionCost,
      ownFunds: state.ownFunds,
      principal: calcInput.principal,
      annualRate: state.annualRate,
      termMonths: calcInput.termMonths,
      repaymentType: state.repaymentType,
      repaymentTypeLabel,
      graceMonths: state.graceMonths,
      graceAnnualRatePercent: state.graceRate,
      graceRateLabel: state.graceRate == null ? "" : F.formatPercent(state.graceRate),
      rateChanges: calcInput.rateChanges,
      prepayments: calcInput.prepayments,
      rateChangeLabels,
      prepaymentLabels,
      startMonth: state.startMonth,
      monthlyRent: state.monthlyRent,
      repaymentRatio: repaymentRatio(latestResult.summary, state.monthlyRent),
      scenarioDelta1: state.scenarioDelta1,
      scenarioDelta2: state.scenarioDelta2,
      hasPaymentVariability: calcInput.rateChanges.length > 0 || calcInput.prepayments.some((p) => p.type === "reducePayment"),
    };
  }

  function renderLoanAmountReadout(state, calcInput) {
    el("acquisitionCostReadoutValue").textContent = F.formatYen(calcInput.acquisitionCost);
    el("loanAmountReadoutValue").textContent = F.formatYen(calcInput.principal);
    const warning = el("loanAmountWarning");
    const exceeds = state.ownFunds > calcInput.acquisitionCost && calcInput.acquisitionCost >= 0;
    warning.hidden = !exceeds;
  }

  // ---------------- メイン再計算 ----------------
  function recalcAndRender() {
    const state = readFormState();
    const calcInput = buildCalcInput(state, 0);
    const result = window.LoanCalc.generateSchedule(calcInput);

    renderLoanAmountReadout(state, calcInput);

    latestResult = result;
    latestInput = { state, calcInput };

    renderSummary(state, calcInput, result);
    renderScenarioTable(state);
    window.LoanChart.renderBalanceChart("balanceChart", result.rows);
    window.LoanChart.renderBreakdownChart("breakdownChart", result.rows);
    renderScheduleTable(result.rows, state.startMonth);

    window.LoanShare.saveState(state);
  }

  const scheduleRecalc = debounce(recalcAndRender, 200);

  // ---------------- イベント配線 ----------------
  function wireEvents() {
    const inputIds = [
      "propertyPrice",
      "renovationCost",
      "ownFunds",
      "annualRate",
      "startMonth",
      "termYears",
      "termMonthsExtra",
      "graceMonths",
      "graceRate",
      "scenarioDelta1",
      "scenarioDelta2",
      "monthlyRent",
    ];
    inputIds.forEach((id) => el(id).addEventListener("input", scheduleRecalc));
    document.querySelectorAll('input[name="repaymentType"]').forEach((r) => r.addEventListener("change", scheduleRecalc));

    el("addRateChange").addEventListener("click", addRateChangeRow);
    el("addPrepayment").addEventListener("click", addPrepaymentRow);

    el("toggleAllYears").addEventListener("click", () => {
      const groups = document.querySelectorAll(".year-group");
      const shouldOpen = el("toggleAllYears").textContent === "すべて展開";
      groups.forEach((g) => (g.open = shouldOpen));
      el("toggleAllYears").textContent = shouldOpen ? "すべて折りたたむ" : "すべて展開";
    });

    el("copyShareLink").addEventListener("click", async () => {
      const state = readFormState();
      const url = window.LoanShare.buildShareUrl(state);
      try {
        await navigator.clipboard.writeText(url);
        showStatus("共有用リンクをコピーしました。");
      } catch (e) {
        showStatus(url, true);
      }
    });

    el("exportPdf").addEventListener("click", async () => {
      const btn = el("exportPdf");
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "PDFを作成中...";
      try {
        const snapshot = buildPdfInputSnapshot(latestInput.state, latestInput.calcInput);
        await window.LoanPdf.exportSchedulePdf({ rows: latestResult.rows, summary: latestResult.summary, input: snapshot });
      } catch (e) {
        console.error(e);
        alert("PDFの作成に失敗しました。もう一度お試しください。");
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  }

  function showStatus(text) {
    const status = el("shareStatus");
    status.textContent = text;
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(() => {
      status.textContent = "";
    }, 4000);
  }

  // ---------------- 初期化 ----------------
  function init() {
    const fromQuery = window.LoanShare.decodeStateFromQuery(window.location.search);
    const fromStorage = window.LoanShare.loadState();
    const initial = fromQuery || fromStorage;
    if (initial) applyStateToForm(initial);
    else {
      renderRateChangeList();
      renderPrepaymentList();
    }

    wireEvents();
    recalcAndRender();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
