/**
 * 償還表PDF出力
 *
 * jsPDF単体では日本語フォントを標準搭載していないため文字化けする。
 * そのため html2canvas でOfficeBananaカラーのHTMLをスナップショットし、
 * 画像としてjsPDFのページに配置する方式を採用している（サーバー不要・日本語も正しく表示される）。
 */
(function (global) {
  "use strict";

  const ROWS_PER_PAGE = 42;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function buildConditionHtml(input) {
    const F = global.LoanFormat;
    const rows = [
      ["物件価格", F.formatYen(input.propertyPrice)],
      ["自己資金", F.formatYen(input.ownFunds)],
      ["借入金額", F.formatYen(input.principal)],
      ["年利", F.formatPercent(input.annualRate)],
      ["返済期間", F.formatMonthsToYM(input.termMonths)],
      ["返済方式", input.repaymentTypeLabel],
    ];
    if (input.graceMonths > 0) {
      rows.push(["元金据置期間", `${input.graceMonths}ヶ月${input.graceRateLabel ? "（据置金利 " + input.graceRateLabel + "）" : ""}`]);
    }
    if (input.rateChangeLabels && input.rateChangeLabels.length) {
      rows.push(["金利変更", input.rateChangeLabels.join(" / ")]);
    }
    if (input.prepaymentLabels && input.prepaymentLabels.length) {
      rows.push(["繰り上げ返済", input.prepaymentLabels.join(" / ")]);
    }

    const trs = rows
      .map(([label, value]) => `<tr><td class="label">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`)
      .join("");
    return `<table class="pdf-condition-table"><tbody>${trs}</tbody></table>`;
  }

  function buildSummaryGridHtml(summary) {
    const F = global.LoanFormat;
    const items = [
      ["毎月の返済額（初回）", F.formatYen(summary.firstPayment)],
      ["最終回の返済額", F.formatYen(summary.lastPayment)],
      ["総返済額", F.formatYen(summary.totalPayment)],
      ["総利息", F.formatYen(summary.totalInterest)],
    ];
    const cells = items
      .map(([label, value]) => `<div class="pdf-summary-item"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`)
      .join("");
    return `<div class="pdf-summary-grid">${cells}</div>`;
  }

  function buildFirstPageHtml(input, summary) {
    const today = new Date();
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 作成`;
    return `
      <div class="pdf-doc">
        <div class="pdf-doc__title">ローン償還シミュレーション</div>
        <div class="pdf-doc__subtitle">${escapeHtml(dateStr)}</div>

        <div class="pdf-doc__section-title">借入条件</div>
        ${buildConditionHtml(input)}

        <div class="pdf-doc__section-title">試算サマリー</div>
        ${buildSummaryGridHtml(summary)}

        <div class="pdf-doc__footer">本試算は概算です。実際の金融機関の計算・契約条件とは異なる場合があります。</div>
      </div>
    `;
  }

  function buildScheduleChunkHtml(chunk, pageLabel, startMonth) {
    const F = global.LoanFormat;
    const showDate = !!startMonth;
    const header = `
      <tr>
        <th>回</th>
        ${showDate ? "<th>年月</th>" : ""}
        <th>返済額</th>
        <th>元金</th>
        <th>利息</th>
        <th>残高</th>
      </tr>
    `;
    const body = chunk
      .map((r) => {
        const cls = r.prepayment > 0 ? "row--prepay" : r.phase === "grace" ? "row--grace" : "";
        const dateCell = showDate ? `<td>${escapeHtml(F.formatCalendarMonth(startMonth, r.month) || "-")}</td>` : "";
        return `<tr class="${cls}"><td>${r.month}</td>${dateCell}<td>${F.formatYen(r.payment)}</td><td>${F.formatYen(r.principal)}</td><td>${F.formatYen(r.interest)}</td><td>${F.formatYen(r.balance)}</td></tr>`;
      })
      .join("");
    return `
      <div class="pdf-doc">
        <div class="pdf-doc__section-title">償還表（${escapeHtml(pageLabel)}）</div>
        <table class="pdf-schedule-table">
          <thead>${header}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  }

  function addCanvasAsPage(doc, canvas, margin, pageWidth, pageHeight, isFirst) {
    if (!isFirst) doc.addPage();
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;
    const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
    const imgWidth = canvas.width * scale;
    const imgHeight = canvas.height * scale;
    const x = margin + (maxWidth - imgWidth) / 2;
    const y = margin;
    doc.addImage(canvas.toDataURL("image/png"), "PNG", x, y, imgWidth, imgHeight);
  }

  async function exportSchedulePdf({ rows, summary, input }) {
    if (!global.jspdf || !global.html2canvas) {
      alert("PDF出力に必要なライブラリの読み込みに失敗しました。インターネット接続をご確認のうえ、再読み込みしてください。");
      return;
    }

    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 24;

    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-99999px";
    container.style.top = "0";
    container.style.width = "760px";
    container.style.background = "#ffffff";
    document.body.appendChild(container);

    try {
      container.innerHTML = buildFirstPageHtml(input, summary);
      const firstCanvas = await global.html2canvas(container, { scale: 2, backgroundColor: "#ffffff" });
      addCanvasAsPage(doc, firstCanvas, margin, pageWidth, pageHeight, true);

      const totalPages = Math.ceil(rows.length / ROWS_PER_PAGE);
      for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
        const chunk = rows.slice(i, i + ROWS_PER_PAGE);
        const pageNo = Math.floor(i / ROWS_PER_PAGE) + 1;
        container.innerHTML = buildScheduleChunkHtml(chunk, `${pageNo}/${totalPages}ページ`, input.startMonth);
        const canvas = await global.html2canvas(container, { scale: 2, backgroundColor: "#ffffff" });
        addCanvasAsPage(doc, canvas, margin, pageWidth, pageHeight, false);
      }

      doc.save("償還表.pdf");
    } finally {
      document.body.removeChild(container);
    }
  }

  global.LoanPdf = { exportSchedulePdf };
})(window);
