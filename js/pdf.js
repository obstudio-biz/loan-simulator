/**
 * 償還表PDF出力（A4縦・2ページ）
 *
 * jsPDF単体では日本語フォントを標準搭載していないため文字化けする。
 * そのため html2canvas でOfficeBananaカラーのHTMLをスナップショットし、
 * 画像としてjsPDFのページに配置する方式を採用している（サーバー不要・日本語も正しく表示される）。
 *
 * 1ページ目: 結果サマリー（取得条件・借入条件・試算カード・金利上昇シナリオ比較・残高推移グラフ）
 * 2ページ目: 年次償還表（月次360行は1枚に収まらないため年次集計）
 */
(function (global) {
  "use strict";

  const DISCLAIMER = "本試算は概算です。実際の金融機関の計算・契約条件とは異なる場合があります。";
  const PDF_WIDTH_PX = 720;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function todayLabel() {
    const today = new Date();
    return `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 作成`;
  }

  function logoSrc() {
    return new URL("assets/bana-loan-logo.jpg", global.location.href).href;
  }

  function conditionTable(rows) {
    const trs = rows
      .map(([label, value]) => `<tr><td class="label">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`)
      .join("");
    return `<table class="pdf-condition-table"><tbody>${trs}</tbody></table>`;
  }

  function buildAcquisitionRows(input) {
    const F = global.LoanFormat;
    return [
      ["物件価格", F.formatYen(input.propertyPrice)],
      ["リフォーム費用", F.formatYen(input.renovationCost || 0)],
      ["取得費用（物件）", F.formatYen(input.acquisitionCost)],
      ["自己資金", F.formatYen(input.ownFunds)],
      ["借入金額", F.formatYen(input.principal)],
    ];
  }

  function buildTermRows(input) {
    const F = global.LoanFormat;
    const rows = [
      ["年利", F.formatPercent(input.annualRate)],
      ["返済期間", F.formatMonthsToYM(input.termMonths)],
      ["返済方式", input.repaymentTypeLabel],
    ];
    if (input.graceMonths > 0) {
      rows.push([
        "元金据置期間",
        `${input.graceMonths}ヶ月${input.graceRateLabel ? "（据置金利 " + input.graceRateLabel + "）" : ""}`,
      ]);
    }
    if (input.rateChangeLabels && input.rateChangeLabels.length) {
      rows.push(["金利変更", input.rateChangeLabels.join(" / ")]);
    }
    if (input.prepaymentLabels && input.prepaymentLabels.length) {
      rows.push(["繰り上げ返済", input.prepaymentLabels.join(" / ")]);
    }
    if (input.monthlyRent > 0) {
      rows.push(["月額家賃収入", F.formatYen(input.monthlyRent)]);
    }
    return rows;
  }

  function payoffLabel(summary, input) {
    const F = global.LoanFormat;
    const duration = F.formatMonthsToYM(summary.payoffMonth);
    if (input.startMonth) {
      const cal = F.formatCalendarMonth(input.startMonth, summary.payoffMonth || 0);
      return cal ? `${duration}（${cal}）` : duration;
    }
    return duration;
  }

  function monthlyPaymentLabel(input) {
    const isEqualPayment = input.repaymentType !== "equalPrincipal";
    if (!isEqualPayment || input.hasPaymentVariability) return "毎月の返済額（初回）";
    return "毎月の返済額";
  }

  function buildSummaryGridHtml(summary, input) {
    const F = global.LoanFormat;
    const items = [
      [monthlyPaymentLabel(input), F.formatYen(summary.firstPayment)],
      ["総返済額", F.formatYen(summary.totalPayment)],
      ["総利息", F.formatYen(summary.totalInterest)],
      ["完済", payoffLabel(summary, input)],
    ];
    if (input && input.repaymentRatio != null) {
      items.push(["返済比率", F.formatRatio(input.repaymentRatio)]);
    }
    const cols = items.length >= 5 ? "pdf-summary-grid pdf-summary-grid--cols-5" : "pdf-summary-grid";
    const cells = items
      .map(([label, value]) => `<div class="pdf-summary-item"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`)
      .join("");
    return `<div class="${cols}">${cells}</div>`;
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

  function buildScenarioCalcInput(input, delta) {
    const grace = input.graceAnnualRatePercent;
    return {
      principal: input.principal,
      annualRatePercent: input.annualRate + delta,
      termMonths: input.termMonths,
      repaymentType: input.repaymentType || "equalPayment",
      graceMonths: input.graceMonths || 0,
      graceAnnualRatePercent: grace == null ? null : grace + delta,
      rateChanges: (input.rateChanges || []).map((r) => ({
        month: r.month,
        annualRatePercent: r.annualRatePercent + delta,
      })),
      prepayments: input.prepayments || [],
    };
  }

  function buildScenarioRows(input) {
    const d1 = Number(input.scenarioDelta1);
    const d2 = Number(input.scenarioDelta2);
    const scenarios = [
      { label: "現在の金利", delta: 0 },
      { label: `+${(Number.isFinite(d1) ? d1 : 0).toFixed(2)}%上昇`, delta: Number.isFinite(d1) ? d1 : 0 },
      { label: `+${(Number.isFinite(d2) ? d2 : 0).toFixed(2)}%上昇`, delta: Number.isFinite(d2) ? d2 : 0 },
    ];
    return scenarios.map((s) => {
      const { summary } = global.LoanCalc.generateSchedule(buildScenarioCalcInput(input, s.delta));
      return {
        label: s.label,
        rate: input.annualRate + s.delta,
        monthly: summary.firstPayment,
        annual: annualPaymentFromSummary(summary),
        ratio: repaymentRatio(summary, input.monthlyRent),
        totalPayment: summary.totalPayment,
        totalInterest: summary.totalInterest,
      };
    });
  }

  function buildScenarioTableHtml(input) {
    const F = global.LoanFormat;
    const showRatio = input.monthlyRent > 0;
    const rows = buildScenarioRows(input);
    const head = `
      <tr>
        <th>シナリオ</th>
        <th>金利</th>
        <th>月額返済額</th>
        <th>年間返済額</th>
        ${showRatio ? "<th>返済比率</th>" : ""}
        <th>総返済額</th>
        <th>総利息</th>
      </tr>
    `;
    const body = rows
      .map((r) => {
        return `<tr>
          <td>${escapeHtml(r.label)}</td>
          <td>${escapeHtml(F.formatPercent(r.rate))}</td>
          <td>${escapeHtml(F.formatYen(r.monthly))}</td>
          <td>${escapeHtml(F.formatYen(r.annual))}</td>
          ${showRatio ? `<td>${escapeHtml(r.ratio == null ? "-" : F.formatRatio(r.ratio))}</td>` : ""}
          <td>${escapeHtml(F.formatYen(r.totalPayment))}</td>
          <td>${escapeHtml(F.formatYen(r.totalInterest))}</td>
        </tr>`;
      })
      .join("");
    return `<table class="pdf-scenario-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  function footerHtml() {
    return `<div class="pdf-doc__footer">${escapeHtml(DISCLAIMER)}</div>`;
  }

  function isUsableDataUrl(url) {
    return typeof url === "string" && url.startsWith("data:image") && url.length > 500;
  }

  function formatYenShort(v) {
    if (Math.abs(v) >= 10000) return `${Math.round(v / 10000).toLocaleString("ja-JP")}万`;
    return `${Math.round(v).toLocaleString("ja-JP")}`;
  }

  function captureScreenChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 16 || canvas.height < 16) return "";
    try {
      const url = canvas.toDataURL("image/png");
      return isUsableDataUrl(url) ? url : "";
    } catch (e) {
      return "";
    }
  }

  function renderOffscreenChart(width, height, config) {
    if (!global.Chart) return "";
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const holder = document.createElement("div");
    holder.style.position = "absolute";
    holder.style.left = "-99999px";
    holder.style.top = "0";
    holder.appendChild(canvas);
    document.body.appendChild(holder);

    try {
      const chart = new global.Chart(canvas, config);
      const url = canvas.toDataURL("image/png");
      chart.destroy();
      return isUsableDataUrl(url) ? url : "";
    } catch (e) {
      return "";
    } finally {
      document.body.removeChild(holder);
    }
  }

  function renderFallbackBalanceChart(rows) {
    if (!rows || !rows.length) return "";
    return renderOffscreenChart(680, 400, {
      type: "line",
      data: {
        labels: rows.map((r) => r.month),
        datasets: [
          {
            label: "残高（円）",
            data: rows.map((r) => r.balance),
            borderColor: "#B08D57",
            backgroundColor: "rgba(176, 141, 87, 0.12)",
            fill: true,
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.1,
          },
        ],
      },
      options: {
        animation: false,
        responsive: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            title: { display: true, text: "返済回（月）", color: "#1F1F1F", font: { size: 10 } },
            grid: { color: "#B8B2A7" },
            ticks: { maxTicksLimit: 12, color: "#1F1F1F", font: { size: 9 } },
          },
          y: {
            title: { display: true, text: "残高（円）", color: "#1F1F1F", font: { size: 10 } },
            grid: { color: "#B8B2A7" },
            ticks: {
              color: "#1F1F1F",
              font: { size: 9 },
              callback: (v) => formatYenShort(v),
            },
          },
        },
      },
    });
  }

  function renderFallbackBreakdownChart(rows) {
    if (!rows || !rows.length) return "";
    const yearGroups = groupByYear(rows);
    return renderOffscreenChart(680, 400, {
      type: "bar",
      data: {
        labels: yearGroups.map((_, idx) => `${idx + 1}年目`),
        datasets: [
          { label: "元金", data: yearGroups.map((g) => g.reduce((s, r) => s + r.principal, 0)), backgroundColor: "#4A4F52" },
          { label: "利息", data: yearGroups.map((g) => g.reduce((s, r) => s + r.interest, 0)), backgroundColor: "#B08D57" },
        ],
      },
      options: {
        animation: false,
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", labels: { color: "#1F1F1F", font: { size: 10 }, boxWidth: 10 } },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: "#1F1F1F", font: { size: 8 }, maxTicksLimit: 8 },
          },
          y: {
            stacked: true,
            grid: { color: "#B8B2A7" },
            ticks: {
              color: "#1F1F1F",
              font: { size: 9 },
              callback: (v) => formatYenShort(v),
            },
          },
        },
      },
    });
  }

  function captureChartImage(canvasId, fallbackFn, rows) {
    const canvas = document.getElementById(canvasId);
    // 画面チャートは横長のため、2カラム枠にそのまま縮小すると日本語軸が欠ける。
    // アスペクトが枠に近いときだけ toDataURL を使い、それ以外はコンパクト再描画する。
    if (canvas instanceof HTMLCanvasElement && canvas.width >= 16 && canvas.height >= 16) {
      const aspect = canvas.width / canvas.height;
      if (aspect <= 2.4) {
        const fromScreen = captureScreenChart(canvasId);
        if (fromScreen) return fromScreen;
      }
    }
    return fallbackFn(rows);
  }

  function chartColumnHtml(title, dataUrl, alt) {
    if (!dataUrl) return "";
    return `
      <div class="pdf-chart-col">
        <div class="pdf-doc__section-title">${escapeHtml(title)}</div>
        <div class="pdf-chart-wrap">
          <img class="pdf-chart" src="${dataUrl}" alt="${escapeHtml(alt)}" />
        </div>
      </div>
    `;
  }

  function buildChartsHtml(balanceUrl, breakdownUrl) {
    const cols = chartColumnHtml("残高推移", balanceUrl, "残高推移グラフ") + chartColumnHtml("年間の元金・利息内訳", breakdownUrl, "年間の元金・利息内訳グラフ");
    if (!cols.trim()) return "";
    return `<div class="pdf-charts">${cols}</div>`;
  }

  function buildFirstPageHtml(input, summary, charts) {
    const balanceUrl = charts && charts.balanceUrl;
    const breakdownUrl = charts && charts.breakdownUrl;
    return `
      <div class="pdf-doc pdf-doc--page1">
        <img class="pdf-doc__logo" src="${escapeHtml(logoSrc())}" alt="バナローン" />
        <div class="pdf-doc__title">バナローン 試算結果サマリー</div>
        <div class="pdf-doc__subtitle">${escapeHtml(todayLabel())}</div>

        <div class="pdf-conditions">
          <div>
            <div class="pdf-doc__section-title">取得条件</div>
            ${conditionTable(buildAcquisitionRows(input))}
          </div>
          <div>
            <div class="pdf-doc__section-title">借入条件</div>
            ${conditionTable(buildTermRows(input))}
          </div>
        </div>

        <div class="pdf-doc__section-title">試算サマリー</div>
        ${buildSummaryGridHtml(summary, input)}

        <div class="pdf-doc__section-title">金利上昇シナリオ比較</div>
        ${buildScenarioTableHtml(input)}

        ${buildChartsHtml(balanceUrl, breakdownUrl)}

        ${footerHtml()}
      </div>
    `;
  }

  function groupByYear(rows) {
    if (global.LoanChart && typeof global.LoanChart.groupByYear === "function") {
      return global.LoanChart.groupByYear(rows);
    }
    const years = [];
    for (let i = 0; i < rows.length; i += 12) {
      years.push(rows.slice(i, i + 12));
    }
    return years;
  }

  function buildYearlyRows(rows) {
    return groupByYear(rows).map((yearRows, idx) => ({
      yearIndex: idx + 1,
      startMonthNo: yearRows[0].month,
      endMonthNo: yearRows[yearRows.length - 1].month,
      payment: yearRows.reduce((s, r) => s + r.payment, 0),
      principal: yearRows.reduce((s, r) => s + r.principal, 0),
      interest: yearRows.reduce((s, r) => s + r.interest, 0),
      balance: yearRows[yearRows.length - 1].balance,
      hasGrace: yearRows.some((r) => r.phase === "grace"),
      hasPrepay: yearRows.some((r) => r.prepayment > 0),
    }));
  }

  function yearLabel(yearRow, startMonth) {
    const F = global.LoanFormat;
    if (!startMonth) return `${yearRow.yearIndex}年目`;
    const from = F.formatCalendarMonth(startMonth, yearRow.startMonthNo);
    const to = F.formatCalendarMonth(startMonth, yearRow.endMonthNo);
    if (from && to) return `${yearRow.yearIndex}年目（${from}〜${to}）`;
    return `${yearRow.yearIndex}年目`;
  }

  function yearMark(yearRow) {
    const marks = [];
    if (yearRow.hasGrace) marks.push("据置");
    if (yearRow.hasPrepay) marks.push("繰上");
    return marks.length ? ` ${marks.join("・")}` : "";
  }

  function yearlyTableHtml(yearRows, startMonth, compact) {
    const F = global.LoanFormat;
    const cls = compact ? "pdf-schedule-table pdf-yearly-table pdf-yearly-table--compact" : "pdf-schedule-table pdf-yearly-table";
    const head = `
      <tr>
        <th>年</th>
        <th>返済額合計</th>
        <th>元金</th>
        <th>利息</th>
        <th>期末残高</th>
      </tr>
    `;
    const body = yearRows
      .map((y) => {
        const rowCls = y.hasPrepay ? "row--prepay" : y.hasGrace ? "row--grace" : "";
        const label = `${yearLabel(y, startMonth)}${yearMark(y)}`;
        return `<tr class="${rowCls}">
          <td class="year-cell">${escapeHtml(label)}</td>
          <td>${escapeHtml(F.formatYen(y.payment))}</td>
          <td>${escapeHtml(F.formatYen(y.principal))}</td>
          <td>${escapeHtml(F.formatYen(y.interest))}</td>
          <td>${escapeHtml(F.formatYen(y.balance))}</td>
        </tr>`;
      })
      .join("");
    return `<table class="${cls}"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  function splitYearColumns(years) {
    if (years.length <= 35) return [years];
    const mid = Math.ceil(years.length / 2);
    return [years.slice(0, mid), years.slice(mid)];
  }

  function buildYearlyPageHtml(rows, input) {
    const years = buildYearlyRows(rows);
    const compact = years.length > 18;
    const columns = splitYearColumns(years);
    const tables =
      columns.length === 1
        ? yearlyTableHtml(columns[0], input.startMonth, compact)
        : `<div class="pdf-yearly-columns">${columns
            .map((col) => yearlyTableHtml(col, input.startMonth, true))
            .join("")}</div>`;

    return `
      <div class="pdf-doc pdf-doc--page2">
        <img class="pdf-doc__logo pdf-doc__logo--small" src="${escapeHtml(logoSrc())}" alt="バナローン" />
        <div class="pdf-doc__title">バナローン 償還表（年次）</div>
        <div class="pdf-doc__subtitle">${escapeHtml(todayLabel())}</div>
        <div class="pdf-doc__section-title">年次償還表</div>
        ${tables}
        ${footerHtml()}
      </div>
    `;
  }

  function addCanvasAsPage(doc, canvas, margin, pageWidth, pageHeight, isFirst) {
    if (!isFirst) doc.addPage();
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;
    const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height, 1);
    const imgWidth = canvas.width * scale;
    const imgHeight = canvas.height * scale;
    const x = margin + (maxWidth - imgWidth) / 2;
    const y = margin;
    doc.addImage(canvas.toDataURL("image/png"), "PNG", x, y, imgWidth, imgHeight);
  }

  function waitForImages(root) {
    const imgs = [...root.querySelectorAll("img")];
    return Promise.all(
      imgs.map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
      })
    );
  }

  async function renderHtmlToCanvas(container, html) {
    container.innerHTML = html;
    await waitForImages(container);
    const target = container.firstElementChild || container;
    return global.html2canvas(target, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });
  }

  async function createSchedulePdf({ rows, summary, input }) {
    if (!global.jspdf || !global.html2canvas) {
      throw new Error("PDF libraries missing");
    }

    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 18;

    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-99999px";
    container.style.top = "0";
    container.style.width = `${PDF_WIDTH_PX}px`;
    container.style.background = "#ffffff";
    document.body.appendChild(container);

    try {
      const charts = {
        balanceUrl: captureChartImage("balanceChart", renderFallbackBalanceChart, rows),
        breakdownUrl: captureChartImage("breakdownChart", renderFallbackBreakdownChart, rows),
      };
      const firstCanvas = await renderHtmlToCanvas(container, buildFirstPageHtml(input, summary, charts));
      addCanvasAsPage(doc, firstCanvas, margin, pageWidth, pageHeight, true);

      const secondCanvas = await renderHtmlToCanvas(container, buildYearlyPageHtml(rows, input));
      addCanvasAsPage(doc, secondCanvas, margin, pageWidth, pageHeight, false);

      return {
        doc,
        pageCount: doc.internal.getNumberOfPages(),
        canvases: [firstCanvas, secondCanvas],
      };
    } finally {
      document.body.removeChild(container);
    }
  }

  function formatManYenForFilename(amount) {
    const yen = Math.round(Number(amount) || 0);
    const man = yen / 10000;
    const display = Number.isInteger(man) ? man : Math.round(man * 10) / 10;
    return `${display.toLocaleString("ja-JP")}万`;
  }

  function formatRateForFilename(rate) {
    const n = Number(rate);
    if (Number.isNaN(n)) return "-";
    const trimmed = String(n).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    return `${trimmed}%`;
  }

  function buildPdfFilename(input) {
    const F = global.LoanFormat;
    const amount = formatManYenForFilename(input && input.principal);
    const term = F.formatMonthsToYM(Number(input && input.termMonths) || 0);
    const rate = formatRateForFilename(input && input.annualRate);
    const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, "-");
    return `バナローン_${safe(amount)}_${safe(term)}_${safe(rate)}.pdf`;
  }

  async function exportSchedulePdf(args) {
    if (!global.jspdf || !global.html2canvas) {
      alert("PDF出力に必要なライブラリの読み込みに失敗しました。インターネット接続をご確認のうえ、再読み込みしてください。");
      return;
    }
    const { doc } = await createSchedulePdf(args);
    doc.save(buildPdfFilename(args && args.input));
  }

  global.LoanPdf = {
    exportSchedulePdf,
    createSchedulePdf,
    buildFirstPageHtml,
    buildYearlyPageHtml,
  };
})(window);
