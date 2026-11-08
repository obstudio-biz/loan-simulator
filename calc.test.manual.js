/**
 * 手動検証用スクリプト（node loan_simulator/js/calc.test.manual.js で実行）
 * 正式な自動テストではなく、ロジックの妥当性を目視確認するための一時スクリプト。
 */
const LoanCalc = require("./calc.js");

function assertClose(actual, expected, tolerance, label) {
  const ok = Math.abs(actual - expected) <= tolerance;
  console.log(`${ok ? "OK  " : "NG !!"} ${label}: actual=${actual} expected~=${expected}`);
  if (!ok) process.exitCode = 1;
}

// 1) 元利均等: 借入3000万円, 年利1.5%, 30年(360回), 据置なし、繰り上げなし
{
  const { rows, summary } = LoanCalc.generateSchedule({
    principal: 30000000,
    annualRatePercent: 1.5,
    termMonths: 360,
    repaymentType: "equalPayment",
  });
  console.log("\n[Test1] equalPayment 30,000,000 / 1.5% / 360m");
  console.log("rows.length =", rows.length, "first payment=", rows[0].payment, "last balance=", rows[rows.length - 1].balance);
  // 標準的な元利均等の毎月返済額（電卓による概算）は約 103,536円程度のはず
  assertClose(rows[0].payment, 103536, 50, "毎月返済額(概算)");
  assertClose(rows[rows.length - 1].balance, 0, 1, "完済時残高");
  assertClose(rows.length, 360, 0, "返済回数");
  assertClose(summary.totalPrincipal, 30000000, 1, "元金合計");
}

// 2) 元金均等: 同条件
{
  const { rows, summary } = LoanCalc.generateSchedule({
    principal: 30000000,
    annualRatePercent: 1.5,
    termMonths: 360,
    repaymentType: "equalPrincipal",
  });
  console.log("\n[Test2] equalPrincipal 30,000,000 / 1.5% / 360m");
  console.log("first payment=", rows[0].payment, "last payment=", rows[rows.length - 1].payment);
  // 元金均等の毎月元金 = 30,000,000/360 = 83,333.33
  assertClose(rows[0].principal, 83333.33, 1, "毎月元金");
  assertClose(rows[rows.length - 1].balance, 0, 1, "完済時残高");
  assertClose(summary.totalPrincipal, 30000000, 1, "元金合計");
}

// 3) 据置期間: 12ヶ月据置(利息のみ) + 残り348回 元利均等
{
  const { rows } = LoanCalc.generateSchedule({
    principal: 30000000,
    annualRatePercent: 1.5,
    termMonths: 360,
    graceMonths: 12,
    repaymentType: "equalPayment",
  });
  console.log("\n[Test3] grace 12m + equalPayment");
  const graceRows = rows.filter((r) => r.phase === "grace");
  console.log("grace rows:", graceRows.length, "first grace payment=", graceRows[0].payment, "principal=", graceRows[0].principal);
  assertClose(graceRows.length, 12, 0, "据置回数");
  assertClose(graceRows[0].principal, 0, 0.01, "据置中の元金返済額");
  assertClose(graceRows[0].payment, 30000000 * (1.5 / 1200), 0.01, "据置中の利息のみ支払い");
  assertClose(rows[rows.length - 1].balance, 0, 1, "完済時残高");
  assertClose(rows.length, 360, 0, "総回数(据置含む)");
}

// 4) 繰り上げ返済: 期間短縮型（returnsで完済が早まる）
{
  const base = LoanCalc.generateSchedule({
    principal: 30000000,
    annualRatePercent: 1.5,
    termMonths: 360,
    repaymentType: "equalPayment",
  });
  const withPrepay = LoanCalc.generateSchedule({
    principal: 30000000,
    annualRatePercent: 1.5,
    termMonths: 360,
    repaymentType: "equalPayment",
    prepayments: [{ month: 24, amount: 3000000, type: "shortenTerm" }],
  });
  console.log("\n[Test4] shortenTerm prepayment");
  console.log("base months=", base.rows.length, "with prepay months=", withPrepay.rows.length);
  console.log("payment before/after prepay month:", withPrepay.rows[22].payment, withPrepay.rows[24].payment);
  if (withPrepay.rows.length >= base.rows.length) {
    console.log("NG !! 期間短縮型なのに期間が短くなっていない");
    process.exitCode = 1;
  } else {
    console.log("OK   期間が短縮された");
  }
  // 返済額はほぼ変わらないはず（期間短縮型）
  assertClose(withPrepay.rows[24].payment, withPrepay.rows[22].payment, 1, "期間短縮型は返済額を維持");
}

// 5) 繰り上げ返済: 返済額軽減型（回数は変わらず、返済額が下がる）
{
  const base = LoanCalc.generateSchedule({
    principal: 30000000,
    annualRatePercent: 1.5,
    termMonths: 360,
    repaymentType: "equalPayment",
  });
  const withPrepay = LoanCalc.generateSchedule({
    principal: 30000000,
    annualRatePercent: 1.5,
    termMonths: 360,
    repaymentType: "equalPayment",
    prepayments: [{ month: 24, amount: 3000000, type: "reducePayment" }],
  });
  console.log("\n[Test5] reducePayment prepayment");
  console.log("base months=", base.rows.length, "with prepay months=", withPrepay.rows.length);
  console.log("payment before/after prepay month:", withPrepay.rows[22].payment, withPrepay.rows[24].payment);
  assertClose(withPrepay.rows.length, base.rows.length, 0, "返済額軽減型は回数を維持");
  if (withPrepay.rows[24].payment >= withPrepay.rows[22].payment) {
    console.log("NG !! 返済額軽減型なのに返済額が下がっていない");
    process.exitCode = 1;
  } else {
    console.log("OK   返済額が軽減された");
  }
}

// 6) 金利変更イベント: 24ヶ月目から金利が3%に上昇 -> 返済額が増えるはず
{
  const { rows } = LoanCalc.generateSchedule({
    principal: 30000000,
    annualRatePercent: 1.5,
    termMonths: 360,
    repaymentType: "equalPayment",
    rateChanges: [{ month: 24, annualRatePercent: 3.0 }],
  });
  console.log("\n[Test6] rate change at month 24 (1.5% -> 3.0%)");
  console.log("payment before/after rate change:", rows[22].payment, rows[24].payment);
  if (rows[24].payment <= rows[22].payment) {
    console.log("NG !! 金利上昇後に返済額が増えていない");
    process.exitCode = 1;
  } else {
    console.log("OK   金利上昇後に返済額が増加");
  }
  assertClose(rows[rows.length - 1].balance, 0, 1, "完済時残高");
}

console.log("\n全テスト実行完了。上記に NG が無ければOK。");
