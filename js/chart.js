/**
 * Chart.js を使ったグラフ描画まわり
 *  - 残高推移（折れ線）
 *  - 年間の元金・利息内訳（積み上げ棒グラフ）
 */
(function (global) {
  "use strict";

  const COLOR_ACCENT = "#B08D57";
  const COLOR_HEADER = "#4A4F52";
  const COLOR_BORDER = "#B8B2A7";
  const COLOR_TEXT = "#1F1F1F";

  let balanceChartInstance = null;
  let breakdownChartInstance = null;

  function groupByYear(rows) {
    const years = [];
    for (let i = 0; i < rows.length; i += 12) {
      years.push(rows.slice(i, i + 12));
    }
    return years;
  }

  function renderBalanceChart(canvasId, rows) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const labels = rows.map((r) => r.month);
    const data = rows.map((r) => r.balance);

    if (balanceChartInstance) {
      balanceChartInstance.destroy();
    }

    balanceChartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "残高（円）",
            data,
            borderColor: COLOR_ACCENT,
            backgroundColor: "rgba(176, 141, 87, 0.12)",
            fill: true,
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => `${items[0].label}回目`,
              label: (item) => `残高: ${formatYen(item.raw)}`,
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "返済回（月）", color: COLOR_TEXT },
            grid: { color: COLOR_BORDER },
            ticks: { maxTicksLimit: 12, color: COLOR_TEXT },
          },
          y: {
            title: { display: true, text: "残高（円）", color: COLOR_TEXT },
            grid: { color: COLOR_BORDER },
            ticks: {
              color: COLOR_TEXT,
              callback: (v) => formatYenShort(v),
            },
          },
        },
      },
    });
  }

  function renderBreakdownChart(canvasId, rows) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const yearGroups = groupByYear(rows);
    const labels = yearGroups.map((_, idx) => `${idx + 1}年目`);
    const principalData = yearGroups.map((g) => g.reduce((sum, r) => sum + r.principal, 0));
    const interestData = yearGroups.map((g) => g.reduce((sum, r) => sum + r.interest, 0));

    if (breakdownChartInstance) {
      breakdownChartInstance.destroy();
    }

    breakdownChartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "元金",
            data: principalData,
            backgroundColor: COLOR_HEADER,
          },
          {
            label: "利息",
            data: interestData,
            backgroundColor: COLOR_ACCENT,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", labels: { color: COLOR_TEXT } },
          tooltip: {
            callbacks: {
              label: (item) => `${item.dataset.label}: ${formatYen(item.raw)}`,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: COLOR_TEXT },
          },
          y: {
            stacked: true,
            grid: { color: COLOR_BORDER },
            ticks: {
              color: COLOR_TEXT,
              callback: (v) => formatYenShort(v),
            },
          },
        },
      },
    });
  }

  function formatYen(v) {
    return `${Math.round(v).toLocaleString("ja-JP")}円`;
  }

  function formatYenShort(v) {
    if (Math.abs(v) >= 10000) return `${Math.round(v / 10000).toLocaleString("ja-JP")}万`;
    return `${Math.round(v).toLocaleString("ja-JP")}`;
  }

  global.LoanChart = {
    renderBalanceChart,
    renderBreakdownChart,
    groupByYear,
  };
})(window);
