/**
 * ローン償還シミュレーション計算ロジック（DOM非依存の純粋関数群）
 *
 * 用語:
 *   元利均等返済 (equalPayment)  : 毎回の返済額（元金+利息）を一定にする方式
 *   元金均等返済 (equalPrincipal): 毎回の元金返済額を一定にする方式
 *   据置期間                    : 元金を返済せず利息のみを支払う期間（建築中の事業融資などで利用）
 *   繰り上げ返済 期間短縮型      : 毎回の返済額は変えず、完済時期を早める
 *   繰り上げ返済 返済額軽減型    : 残りの返済回数は変えず、毎回の返済額を下げる
 */

(function (global) {
  "use strict";

  const MIN_BALANCE = 0.5; // これ未満の残高は完済とみなす（丸め誤差対策）
  const SAFETY_CAP_MONTHS = 1200; // 無限ループ防止（100年分）

  /**
   * 元利均等返済の毎回の返済額（PMT）を計算する
   * @param {number} monthlyRate 月利（小数、例: 年1.5% -> 0.00125）
   * @param {number} nper 残り回数
   * @param {number} pv 現在の残高
   */
  function pmt(monthlyRate, nper, pv) {
    if (nper <= 0) return pv;
    if (Math.abs(monthlyRate) < 1e-12) return pv / nper;
    return (monthlyRate * pv) / (1 - Math.pow(1 + monthlyRate, -nper));
  }

  /**
   * 元利均等返済で、一定の返済額(payment)のとき完済までに必要な回数を計算する
   */
  function nper(monthlyRate, payment, pv) {
    if (pv <= 0) return 0;
    if (Math.abs(monthlyRate) < 1e-12) return pv / payment;
    const ratio = 1 - (monthlyRate * pv) / payment;
    if (ratio <= 0) {
      // 返済額が利息分にも満たない異常なケース。安全側に倒して最小1回とする。
      return 1;
    }
    return -Math.log(ratio) / Math.log(1 + monthlyRate);
  }

  /**
   * 金利タイムライン（何ヶ月目からどの年利になるか）を構築する。
   * 「ある月以降ずっとその金利が適用される」セグメントのリストとして表現する。
   *
   * @param {object} opts
   * @param {number} opts.annualRatePercent 基本の年利(%)
   * @param {number} opts.graceMonths 据置月数
   * @param {number|null} opts.graceAnnualRatePercent 据置期間中の年利(%)。nullなら基本金利と同じ
   * @param {Array<{month:number, annualRatePercent:number}>} opts.rateChanges 途中の金利変更イベント
   * @returns {Array<{month:number, rate:number}>} month昇順のセグメント配列
   */
  function buildRateTimeline(opts) {
    const { annualRatePercent, graceMonths = 0, graceAnnualRatePercent = null, rateChanges = [] } = opts;

    const timeline = [];
    const initialRate = graceMonths > 0 && graceAnnualRatePercent != null ? graceAnnualRatePercent : annualRatePercent;
    timeline.push({ month: 1, rate: initialRate });

    if (graceMonths > 0 && graceAnnualRatePercent != null) {
      timeline.push({ month: graceMonths + 1, rate: annualRatePercent });
    }

    for (const rc of rateChanges) {
      if (rc && rc.month >= 1 && typeof rc.annualRatePercent === "number") {
        timeline.push({ month: rc.month, rate: rc.annualRatePercent });
      }
    }

    timeline.sort((a, b) => a.month - b.month);
    return timeline;
  }

  /**
   * 指定した月に適用される年利(%)をタイムラインから求める
   */
  function rateAt(timeline, month) {
    let rate = timeline.length > 0 ? timeline[0].rate : 0;
    for (const seg of timeline) {
      if (seg.month <= month) {
        rate = seg.rate;
      } else {
        break;
      }
    }
    return rate;
  }

  /**
   * 繰り上げ返済の入力配列を「月 -> {amount, type}」のMapにまとめる。
   * 同じ月に複数登録された場合は金額を合算し、種別は最初のものを採用する。
   */
  function buildPrepaymentMap(prepayments) {
    const map = new Map();
    for (const p of prepayments || []) {
      if (!p || !(p.month >= 1) || !(p.amount > 0)) continue;
      const existing = map.get(p.month);
      if (existing) {
        existing.amount += p.amount;
      } else {
        map.set(p.month, { amount: p.amount, type: p.type === "reducePayment" ? "reducePayment" : "shortenTerm" });
      }
    }
    return map;
  }

  /**
   * 償還スケジュール（月次の明細配列）を生成する。
   *
   * @param {object} input
   * @param {number} input.principal 借入金額（物件価格 - 自己資金。呼び出し側で計算して渡す）
   * @param {number} input.annualRatePercent 基本年利(%)
   * @param {number} input.termMonths 返済期間（据置期間を含む総月数）
   * @param {"equalPayment"|"equalPrincipal"} input.repaymentType 返済方式
   * @param {number} [input.graceMonths=0] 元金据置期間（月）
   * @param {number|null} [input.graceAnnualRatePercent=null] 据置期間中の年利(%)
   * @param {Array<{month:number, annualRatePercent:number}>} [input.rateChanges=[]] 金利変更イベント
   * @param {Array<{month:number, amount:number, type:"shortenTerm"|"reducePayment"}>} [input.prepayments=[]] 繰り上げ返済
   * @returns {{rows: Array<object>, summary: object}}
   */
  function generateSchedule(input) {
    const {
      principal,
      annualRatePercent,
      termMonths,
      repaymentType,
      graceMonths = 0,
      graceAnnualRatePercent = null,
      rateChanges = [],
      prepayments = [],
    } = input;

    if (!(principal > 0) || !(termMonths > 0)) {
      return { rows: [], summary: emptySummary() };
    }

    const timeline = buildRateTimeline({ annualRatePercent, graceMonths, graceAnnualRatePercent, rateChanges });
    const prepayMap = buildPrepaymentMap(prepayments);

    const rows = [];
    let balance = principal;
    let remainingMonths = Math.max(termMonths - graceMonths, 0);
    let month = 0;
    let payment = null; // equalPayment用の毎回返済額
    let principalPerMonth = null; // equalPrincipal用の毎回元金返済額

    // --- 据置期間（利息のみ支払い） ---
    for (let g = 0; g < graceMonths && balance > MIN_BALANCE; g++) {
      month++;
      const annualRate = rateAt(timeline, month);
      const monthlyRate = annualRate / 1200;
      const interest = balance * monthlyRate;

      let prepayAmount = 0;
      const prepay = prepayMap.get(month);
      if (prepay) {
        prepayAmount = Math.min(prepay.amount, balance);
        balance -= prepayAmount;
      }

      rows.push({
        month,
        phase: "grace",
        annualRatePercent: annualRate,
        payment: round2(interest + prepayAmount),
        principal: round2(prepayAmount),
        interest: round2(interest),
        prepayment: round2(prepayAmount),
        balance: round2(Math.max(balance, 0)),
      });
    }

    // --- 元利均等/元金均等の初期値を設定 ---
    if (balance > MIN_BALANCE && remainingMonths > 0) {
      const annualRate = rateAt(timeline, month + 1);
      const monthlyRate = annualRate / 1200;
      if (repaymentType === "equalPrincipal") {
        principalPerMonth = balance / remainingMonths;
      } else {
        payment = pmt(monthlyRate, remainingMonths, balance);
      }
    }

    let currentRate = rateAt(timeline, month + 1);

    // --- 通常返済フェーズ ---
    while (balance > MIN_BALANCE && remainingMonths > 0 && month < SAFETY_CAP_MONTHS) {
      month++;
      const annualRate = rateAt(timeline, month);
      const monthlyRate = annualRate / 1200;

      if (annualRate !== currentRate) {
        currentRate = annualRate;
        if (repaymentType === "equalPayment") {
          payment = pmt(monthlyRate, remainingMonths, balance);
        }
        // equalPrincipal は金利変更だけでは元金返済額を変えない（利息のみ変動）
      }

      let principalPaid;
      let payAmount;
      const interest = balance * monthlyRate;

      if (repaymentType === "equalPrincipal") {
        principalPaid = Math.min(principalPerMonth, balance);
        payAmount = principalPaid + interest;
      } else {
        payAmount = payment;
        principalPaid = payAmount - interest;
        if (principalPaid > balance || remainingMonths === 1) {
          principalPaid = balance;
          payAmount = principalPaid + interest;
        }
      }

      balance -= principalPaid;
      remainingMonths--;

      let prepayAmount = 0;
      const prepay = prepayMap.get(month);
      if (prepay && balance > MIN_BALANCE) {
        prepayAmount = Math.min(prepay.amount, balance);
        balance -= prepayAmount;

        if (balance > MIN_BALANCE && remainingMonths > 0) {
          if (prepay.type === "shortenTerm") {
            if (repaymentType === "equalPrincipal") {
              remainingMonths = Math.max(1, Math.round(balance / principalPerMonth));
            } else {
              remainingMonths = Math.max(1, Math.round(nper(monthlyRate, payment, balance)));
            }
          } else {
            // reducePayment: 残り回数は変えず、毎回の返済額/元金を下げる
            if (repaymentType === "equalPrincipal") {
              principalPerMonth = balance / remainingMonths;
            } else {
              payment = pmt(monthlyRate, remainingMonths, balance);
            }
          }
        }
      }

      rows.push({
        month,
        phase: "amortization",
        annualRatePercent: annualRate,
        payment: round2(payAmount + prepayAmount),
        principal: round2(principalPaid + prepayAmount),
        interest: round2(interest),
        prepayment: round2(prepayAmount),
        balance: round2(Math.max(balance, 0)),
      });

      if (balance <= MIN_BALANCE) break;
    }

    return { rows, summary: buildSummary(rows, input) };
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  function emptySummary() {
    return {
      totalPayment: 0,
      totalInterest: 0,
      totalPrincipal: 0,
      payoffMonth: 0,
      firstPayment: 0,
      lastPayment: 0,
      monthCount: 0,
    };
  }

  function buildSummary(rows, input) {
    if (!rows.length) return emptySummary();

    let totalPayment = 0;
    let totalInterest = 0;
    let totalPrincipal = 0;

    for (const r of rows) {
      totalPayment += r.payment;
      totalInterest += r.interest;
      totalPrincipal += r.principal;
    }

    const amortizationRows = rows.filter((r) => r.phase === "amortization");
    const firstPayment = amortizationRows.length ? amortizationRows[0].payment : rows[0].payment;
    const lastPayment = amortizationRows.length
      ? amortizationRows[amortizationRows.length - 1].payment
      : rows[rows.length - 1].payment;

    return {
      totalPayment: round2(totalPayment),
      totalInterest: round2(totalInterest),
      totalPrincipal: round2(totalPrincipal),
      payoffMonth: rows[rows.length - 1].month,
      firstPayment: round2(firstPayment),
      lastPayment: round2(lastPayment),
      monthCount: rows.length,
      repaymentType: input.repaymentType,
    };
  }

  const LoanCalc = {
    pmt,
    nper,
    buildRateTimeline,
    rateAt,
    buildPrepaymentMap,
    generateSchedule,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = LoanCalc;
  } else {
    global.LoanCalc = LoanCalc;
  }
})(typeof window !== "undefined" ? window : globalThis);
