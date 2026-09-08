# Kakekomi

お金のことで一人で抱え込んでいる人に、送客ではなく「伴走」するAIエージェント。
診断はせず、状況整理と優先順位付きの行動指針、そして安心して感情を吐き出せる場を
提供する。G's ACADEMY卒業制作。

設計の一次情報は Claude Code の `kakekomi-counselor` スキル（SKILL.md）。
背景・意思決定の経緯は引き継ぎ資料（`Kakekomi_ClaudeCode引き継ぎ資料.md`）を参照。

## 構成

- `worker/` — Cloudflare Workers（TypeScript）。AIエージェントのコア（緊急性
  チェック→構造化状態の更新→ルールエンジン→システムプロンプト組み立て→
  Anthropic API呼び出し）と D1 まわりを担当
- `frontend/` — Cloudflare Pages で配信する静的フロントエンド（チャットUI）

## 現状の実装スコープ（MVP・第一段階）

- [x] Cloudflareプロジェクトの初期化（wrangler.toml, D1スキーマのひな形）
- [x] AIエージェントのコア（個人/housing・個人/debt・事業簡易版のルールエンジン）
- [x] 緊急性の無条件上書きレイヤー（キーワード検知＋システムプロンプト二重化）
- [x] まとめノート機能（クライアント側で候補アクションから簡易描画）
- [ ] ユーザー登録・ログイン
- [ ] ノートの保存・取得（D1）
- [ ] 管理者ダッシュボード
- [ ] 匿名投稿ティーザー機能
- [ ] 利用ティアのUIモック

匿名利用（ゲスト）時は、会話履歴・構造化状態をブラウザの localStorage のみに
保持し、サーバー（D1）には一切書き込まない。

## セットアップ

### 1. Cloudflareリソースの作成

```bash
cd worker
npm install
npx wrangler d1 create kakekomi-db
```

出力された `database_id` を `worker/wrangler.toml` の
`REPLACE_WITH_D1_DATABASE_ID` に貼り付ける。

```bash
npm run db:migrate:local
```

### 2. Anthropic APIキーの設定

ローカル開発用（`worker/.dev.vars`、gitignore対象）:

```
ANTHROPIC_API_KEY=sk-ant-...
```

本番デプロイ用:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

### 3. ローカル起動

```bash
cd worker
npm run dev
# 別ターミナルで frontend/index.html を任意の静的サーバーで開く
```

### 4. デプロイ

```bash
cd worker
npm run deploy
npm run db:migrate:remote
```

`frontend/` は Cloudflare Pages に接続してデプロイする。`frontend/app.js` の
`API_BASE`（`window.KAKEKOMI_API_BASE`）は、デプロイ後のWorkerのURLに合わせて
設定すること。
