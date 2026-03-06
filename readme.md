# バックエンドAPI (Cloud Run) デプロイ手順書

本ドキュメントは、Vertex AI と W&B Weave を連携させた「データ生成・評価パイプライン API (FastAPI)」を Google Cloud Run にデプロイするための手順書です。

## 前提条件
* Google Cloud CLI (`gcloud`) がインストール済であり、ログイン済であること。
* デプロイ先の GCP プロジェクトに対するオーナー（Owner）または編集者（Editor）権限を持っていること。
* カレントディレクトリに以下の5つのファイルが存在していること。
  * `Dockerfile`
  * `main.py`
  * `models.py`
  * `pipeline.py`
  * `requirements.txt`

---

## Step 1: GCPプロジェクトのセットアップとAPI有効化

ターミナルを開き、対象のプロジェクトを設定して必要な Google Cloud API を有効化します。

```bash
# プロジェクトIDを変数に設定（ご自身のプロジェクトIDに書き換えてください）
export PROJECT_ID="YOUR_PROJECT_ID"

# デフォルトプロジェクトとして設定
gcloud config set project $PROJECT_ID

gcloud auth login

gcloud auth application-default login

# 必要なAPIの有効化
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  aiplatform.googleapis.com \
  artifactregistry.googleapis.com
```

## Step 2: サービスアカウントの作成と権限付与

Cloud Run 上のアプリケーションが **Vertex AI (Gemini)** に安全にアクセスできるよう、専用のサービスアカウントを作成し、権限を付与します。

```bash
# 1. Cloud Run用のサービスアカウントを作成
gcloud iam service-accounts create genai-api-sa \
  --display-name="Service Account for GenAI API on Cloud Run"

# 2. サービスアカウントのメールアドレスを変数に格納
export SA_EMAIL="genai-api-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# 3. Vertex AIを利用するための権限（Vertex AI ユーザー）を付与
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/aiplatform.user"
```

## Step 3: Cloud Run へのデプロイ

ソースコードがあるディレクトリ（`Dockerfile` と同じ階層）で以下のデプロイコマンドを実行します。

> **⚠️ 重要なポイント**
> 今回のAPIはバックグラウンドタスク（FastAPI `BackgroundTasks`）を使用して数分〜数十分の処理を行います。デフォルトのCloud Runはレスポンス返却後にCPUを停止（スロットリング）してしまうため、必ず `--no-cpu-throttling` (常にCPUを割り当てる) オプションを指定してください。

```bash
gcloud run deploy genai-data-factory-api \
  --source ./backend \
  --region asia-northeast1 \
  --service-account ${SA_EMAIL} \
  --allow-unauthenticated \
  --no-cpu-throttling \
  --min-instances 0 \
  --max-instances 10 \
  --timeout 3600 \
  --port 8080
```

デプロイが完了すると、コンソールに **Service URL** が表示されます。
（例： `https://genai-data-factory-api-xxxxxxxx-an.a.run.app`）

---

## Step 4: 動作確認（テストリクエスト）

デプロイされたAPIに対して、ターミナルから `curl` コマンドでテストを行います。
`${API_URL}` にデプロイ完了時に表示されたURLを、`${WANDB_API_KEY}` にご自身の W&B API Key を設定してください。

```bash
export API_URL="https://your-cloud-run-url.a.run.app"
export WANDB_API_KEY="your-wandb-api-key"
```

### 1. テンプレートの作成
生成・評価のルール（JSON Schema含む）を登録します。

```bash
curl -s -X POST "${API_URL}/api/v1/templates" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "テスト生成テンプレート",
    "description": "Vertex AIの疎通確認用",
    "generation_config": {
      "model": "gemini-2.5-flash",
      "system_instruction": "あなたは挨拶botです。{{tone}}なトーンで挨拶を生成してください。",
      "temperature": 0.7,
      "response_mime_type": "application/json",
      "response_schema": {
        "type": "OBJECT",
        "properties": {
          "greeting": {"type": "STRING"}
        },
        "required": ["greeting"]
      }
    },
    "evaluation_config": {
      "judge_model": "gemini-2.5-pro",
      "criteria": "指定されたトーンで挨拶できているか（1〜5で評価）",
      "min_passing_score": 4
    }
  }'
```
> レスポンスの `"template_id"`（例：`tpl_1234abcd`）をメモしてください。

### 2. データ生成ジョブの実行（Weave連携）
取得した `template_id` を用いて、非同期の生成ジョブを開始します。

```bash
export TEMPLATE_ID="tpl_1234abcd" # 先ほど取得したIDに変更

curl -s -X POST "${API_URL}/api/v1/jobs/generate" \
  -H "Content-Type: application/json" \
  -H "X-Wandb-Api-Key: ${WANDB_API_KEY}" \
  -d '{
    "template_id": "'${TEMPLATE_ID}'",
    "num_samples": 5,
    "variables": {
      "tone": "非常に丁寧"
    },
    "project_name": "test-genai-data"
  }'
```
> レスポンスの `"job_id"`（例：`job_5678efgh`）をメモしてください。即座にステータス `pending` が返ります。

### 3. ジョブの進捗確認
ジョブの実行状況と、WeaveダッシュボードのURLを確認します。

```bash
export JOB_ID="job_5678efgh" # 先ほど取得したIDに変更

curl -s -X GET "${API_URL}/api/v1/jobs/${JOB_ID}"
```
正常に動作していれば `"status": "running"` または `"completed"` となり、レスポンス内の `weave_dashboard_url` にアクセスすると、W&B Weave 上で生成データ・プロンプト・評価スコアがリアルタイムに確認できます。

# フロントエンド デプロイ手順
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
cd frontend

npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
