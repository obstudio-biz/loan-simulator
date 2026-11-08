# バナローン

事業融資の返済プランを試算するための、サーバー不要の静的Webアプリです。
スマホ・PCどちらのブラウザからでも同じURLで開けます。

## 主な機能

- 元利均等返済 / 元金均等返済
- 元金据置期間（利息のみ支払う期間。建築中の事業融資などを想定）
- 繰り上げ返済（期間短縮型・返済額軽減型、複数回登録可）
- 金利変更イベント（「〇ヶ月目から金利が変わる」を複数登録し、金利上昇時の影響を確認）
- 金利上昇シナリオ比較（現在の金利 / +α% / +β% を並べて比較）
- リフォーム費用を加えた取得費用（物件）から借入金額を算出
- 月額家賃収入を入力すると、現在金利と金利上昇シナリオの返済比率を比較表示
- 残高推移・元金利息内訳グラフ（Chart.js）
- 償還表のPDF出力（ブラウザ内で完結。サーバー不要）
- 入力内容のブラウザ自動保存（localStorage）と、共有用リンクによる端末間の受け渡し

## ローカルでの動作確認方法

ビルドは不要です。`index.html` を静的に配信できればどんな方法でも構いません。

```bash
cd loan_simulator
python3 -m http.server 8000
# ブラウザで http://localhost:8000/index.html を開く
```

## デプロイ方法（GitHub Pages を利用する場合）

このフォルダは、経費精算・査定書などの機密データを含む `realestate-tool` リポジトリとは
切り離した、**専用の新規リポジトリ**として公開することを推奨します。

1. `loan_simulator/` フォルダの中身だけをコピーして、新しいフォルダ（例: `~/Projects/loan-simulator`）を作る
2. そのフォルダで以下を実行する

   ```bash
   cd ~/Projects/loan-simulator
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   ```

3. GitHub上で新しいリポジトリを作成する（<https://github.com/new>）。Public/Privateどちらでも可
   （Privateの場合もGitHub PagesのURLは知っている人なら誰でも閲覧できる点に注意）
4. リモートを紐付けてpushする

   ```bash
   git remote add origin https://github.com/<あなたのアカウント>/loan-simulator.git
   git push -u origin main
   ```

5. GitHubのリポジトリ画面で `Settings` → `Pages` を開き、Source を
   `Deploy from a branch`、Branch を `main` / `/(root)` に設定して保存する
6. 数分後、`https://<あなたのアカウント>.github.io/loan-simulator/` でアクセスできるようになる
7. そのURLをスマホのホーム画面に追加（Safariなら共有 → ホーム画面に追加）しておくと、
   アプリのように起動できて便利

## デプロイ方法（Netlifyを使う場合・もっと簡単）

GitHubアカウントの操作が不要な、ドラッグ&ドロップだけの方法です。

1. <https://app.netlify.com/drop> を開く
2. `loan_simulator` フォルダをブラウザにドラッグ&ドロップする
3. 発行されたURLをスマホ・PCで開く

## ファイル構成

```
loan_simulator/
  index.html          画面本体（入力フォーム・結果表示エリア）
  assets/bana-loan-logo.png  バナローンのロゴ
  css/style.css        OfficeBananaカラーのレスポンシブスタイル
  js/calc.js           元利均等・元金均等・据置・繰り上げ返済・金利変更の計算ロジック（純粋関数）
  js/calc.test.manual.js  calc.jsの手動検証スクリプト（Node.jsがあれば `node js/calc.test.manual.js` で実行可）
  js/format.js         数値・日付のフォーマット共通処理
  js/chart.js          Chart.js描画まわり
  js/pdf.js            償還表PDF生成（html2canvas + jsPDF）
  js/share.js          localStorage保存・共有用URLのエンコード/デコード
  js/app.js            UIイベントの配線
```

## 実装上の注意（PDF出力について）

jsPDF単体では日本語フォントを内蔵していないため、そのまま文字を描画すると文字化けします。
そのため本ツールでは、OfficeBananaカラーで組んだHTMLを `html2canvas` で画像化し、
`jsPDF` でページに貼り付ける方式を採用しています。サーバー不要で日本語も正しく表示され、
スマホのブラウザでもそのままPDFとして保存できます。

## 免責事項

本ツールの試算結果は概算です。実際の金融機関の計算方法・手数料・保証料・契約条件とは
異なる場合があります。重要な意思決定の際は、必ず金融機関へ確認してください。
