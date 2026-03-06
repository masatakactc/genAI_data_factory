from fastapi import FastAPI, BackgroundTasks, HTTPException, Header
from fastapi.responses import StreamingResponse
from typing import Dict, List
import uuid
import os
import json
from datetime import datetime
import requests
from pydantic import BaseModel
import vertexai
import weave
# Firestoreのインポートを追加
from google.cloud import firestore

from models import TemplateCreate, JobCreate
from pipeline import run_generation_pipeline, run_augmentation_pipeline

app = FastAPI(title="GenAI Data Factory API")

# ジョブの進行状況は一時的なものなのでインメモリのままでOK
jobs_db: Dict[str, dict] = {}

# Firestoreクライアントの初期化（起動時に一度だけ実行）
db = firestore.Client()
TEMPLATES_COLLECTION = "genai_templates"

@app.on_event("startup")
def startup_event():
    project_id = os.environ.get("GCP_PROJECT_ID")
    location = os.environ.get("GCP_LOCATION", "asia-northeast1")
    
    if project_id:
        vertexai.init(project=project_id, location=location)
    else:
        vertexai.init(location=location)

# ==========================================
# 1. テンプレート管理 (Firestore連携)
# ==========================================
@app.post("/api/v1/templates", status_code=201)
def create_template(template: TemplateCreate):
    """テンプレートを作成し、Firestoreに保存する"""
    template_id = f"tpl_{uuid.uuid4().hex[:8]}"
    
    # 保存用のデータを作成
    template_data = template.dict()
    template_data["template_id"] = template_id
    template_data["created_at"] = datetime.utcnow().isoformat()
    
    # Firestoreに保存 (ドキュメントIDをtemplate_idにする)
    doc_ref = db.collection(TEMPLATES_COLLECTION).document(template_id)
    doc_ref.set(template_data)
    
    return {"template_id": template_id, "created_at": template_data["created_at"]}

@app.get("/api/v1/templates")
def list_templates() -> List[dict]:
    """Firestoreに保存されているテンプレートの一覧を取得する"""
    try:
        docs = db.collection(TEMPLATES_COLLECTION).order_by("created_at", direction=firestore.Query.DESCENDING).limit(50).stream()
        return [doc.to_dict() for doc in docs]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch templates: {e}")

@app.get("/api/v1/templates/{template_id}")
def get_template(template_id: str):
    """指定されたテンプレートの詳細を取得する"""
    doc_ref = db.collection(TEMPLATES_COLLECTION).document(template_id)
    doc = doc_ref.get()
    
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Template not found")
        
    return doc.to_dict()


# ==========================================
# 2. ジョブ管理
# ==========================================
@app.post("/api/v1/jobs/generate", status_code=202)
def create_job(
    req: JobCreate, 
    background_tasks: BackgroundTasks,
    x_wandb_api_key: str = Header(None, description="User's W&B API Key")
):
    if not x_wandb_api_key:
        raise HTTPException(status_code=401, detail="X-Wandb-Api-Key header is missing")
    
    # Firestoreからテンプレートを取得して存在確認
    doc_ref = db.collection(TEMPLATES_COLLECTION).document(req.template_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Template not found in Firestore")
    template = doc.to_dict()
        
    job_id = f"job_{uuid.uuid4().hex[:8]}"
    
    if "/" in req.project_name:
        parts = req.project_name.split("/", 1)
        entity_name, actual_project_name = parts[0], parts[1]
    else:
        actual_project_name = req.project_name
        try:
            res = requests.post(
                "https://api.wandb.ai/graphql",
                auth=("api", x_wandb_api_key),
                json={"query": "query { viewer { entity } }"},
                timeout=5
            )
            res.raise_for_status()
            entity_name = res.json().get("data", {}).get("viewer", {}).get("entity")
            if not entity_name: raise ValueError("Entity not found")
        except Exception:
            entity_name = "your-entity"

    target_dataset_name = f"dataset_{req.template_id}"
    weave_dashboard_url = f"https://wandb.ai/{entity_name}/{actual_project_name}/weave/traces"
    weave_dataset_url = f"https://wandb.ai/{entity_name}/{actual_project_name}/weave/objects/{target_dataset_name}/versions"
    
    jobs_db[job_id] = {
        "job_id": job_id, "status": "running",
        "progress": {"target_count": req.num_samples, "generated_count": 0, "evaluated_count": 0, "passed_count": 0, "failed_count": 0},
        "started_at": datetime.utcnow().isoformat(),
        "weave_dashboard_url": weave_dashboard_url,
        "target_dataset_name": target_dataset_name,
        "weave_dataset_url": weave_dataset_url
    }
    
    background_tasks.add_task(run_generation_pipeline, job_id, template, req.dict(), x_wandb_api_key, jobs_db)
    
    return {"job_id": job_id, "status": "pending", "target_dataset_name": target_dataset_name, "weave_dataset_url": weave_dataset_url}

@app.get("/api/v1/jobs/{job_id}")
def get_job_status(job_id: str):
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs_db[job_id]

@app.post("/api/v1/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    jobs_db[job_id]["status"] = "cancelled"
    return {"job_id": job_id, "status": "cancelled"}

# ==========================================
# 3. データセット出力
# ==========================================
@app.get("/api/v1/datasets/{dataset_name}/export")
def export_dataset(
    dataset_name: str,
    project_name: str,
    format: str = "jsonl",
    x_wandb_api_key: str = Header(None, description="User's W&B API Key")
):
    """Weaveに保存された高品質データをJSONLとしてダウンロードする"""
    if not x_wandb_api_key:
        raise HTTPException(status_code=401, detail="X-Wandb-Api-Key header is missing")
    
    # ユーザーのAPIキーでWeaveを初期化
    os.environ["WANDB_API_KEY"] = x_wandb_api_key
    weave.init(project_name)
    
    try:
        # Weaveからデータセットの最新バージョンを取得
        dataset = weave.ref(dataset_name).get()
        rows = dataset.rows
        
        if format == "jsonl":
            # JSONL形式のストリーミングレスポンスを生成
            def iter_jsonl():
                for row in rows:
                    yield json.dumps(row, ensure_ascii=False) + "\n"
            
            headers = {
                "Content-Disposition": f"attachment; filename={dataset_name}.jsonl"
            }
            return StreamingResponse(iter_jsonl(), media_type="application/jsonlines", headers=headers)
        
        else:
            # デフォルトは通常のJSON配列として返す
            return {"dataset_name": dataset_name, "count": len(rows), "data": rows}
            
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Dataset not found or access denied. Error: {str(e)}")

# ==========================================
# 4. テンプレート自動最適化 (Prompt Optimization)
# ==========================================
from pydantic import BaseModel

class OptimizeRequest(BaseModel):
    job_id: str # 分析対象とする過去のジョブID

@app.post("/api/v1/templates/{template_id}/optimize")
def optimize_template(template_id: str, req: OptimizeRequest):
    """
    過去のジョブで得られた低評価の理由を分析し、より高スコアを出せる
    新しいプロンプト（システム指示）と分析レポートを提案するAPI。
    """
    # 1. テンプレートとジョブ情報の取得
    doc_ref = db.collection(TEMPLATES_COLLECTION).document(template_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Template not found")
    template = doc.to_dict()
    
    if req.job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found. Only recent jobs in memory can be analyzed.")
        
    job_data = jobs_db[req.job_id]
    feedbacks = job_data.get("feedbacks", [])
    
    if not feedbacks:
        return {"message": "このジョブには低評価のデータがなかったため、最適化の必要はありません。"}

    # 2. Gemini 2.5 Pro（プロンプトエンジニア役）への指示を作成
    optimizer_prompt = f"""
    あなたは優秀なAIプロンプトエンジニアです。
    ユーザーが作成したAIデータ生成用の「元のプロンプト」を使ってデータを生成したところ、
    AI評価者から以下のような「低評価の理由（フィードバック）」が多数寄せられました。
    
    【元のプロンプト】
    {template['generation_config']['system_instruction']}
    
    【評価基準（この基準を満たす必要があった）】
    {template['evaluation_config']['criteria']}
    
    【寄せられた低評価の理由（エラー傾向）】
    {json.dumps(feedbacks, ensure_ascii=False, indent=2)}
    
    上記の失敗傾向を深く分析し、**同じ失敗を繰り返さず、確実に高スコアを獲得できるような「新しいプロンプト（system_instruction）」** を考案してください。
    """
    
    # 3. 構造化出力（JSON）で提案を受け取る
    optimizer_schema = {
        "type": "OBJECT",
        "properties": {
            "analysis_report": {
                "type": "STRING", 
                "description": "なぜ低スコアになったかの原因分析と、それをどう解決したかの論理的な解説"
            },
            "optimized_system_instruction": {
                "type": "STRING", 
                "description": "修正・強化された新しいプロンプトの本文"
            }
        },
        "required": ["analysis_report", "optimized_system_instruction"]
    }
    
    from vertexai.generative_models import GenerativeModel, GenerationConfig
    # 分析・最適化には賢い Pro モデルを使用する
    optimizer_model = GenerativeModel("gemini-2.5-pro")
    
    try:
        response = optimizer_model.generate_content(
            optimizer_prompt,
            generation_config=GenerationConfig(
                temperature=0.4,
                response_mime_type="application/json",
                response_schema=optimizer_schema
            )
        )
        # JSONからマークダウンブロックを除去してパース（pipeline.pyの安全なパース関数を流用可能）
        text = response.text.strip()
        if text.startswith("```json"): text = text[7:]
        if text.endswith("```"): text = text[:-3]
        suggestion = json.loads(text.strip())
        
        return {
            "original_template_id": template_id,
            "analysis_report": suggestion["analysis_report"],
            "optimized_system_instruction": suggestion["optimized_system_instruction"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Optimization failed: {e}")

# ==========================================
# 5. 対話型テンプレート改修 (Chat & Finalize)
# ==========================================
from pydantic import BaseModel
from typing import List, Optional

class ChatMessage(BaseModel):
    role: str # "user" または "model"
    content: str

class TemplateChatRequest(BaseModel):
    messages: List[ChatMessage] # フロントエンドが保持している会話履歴
    job_id: Optional[str] = None # エラー情報を引き継ぐためのジョブID（任意）

@app.post("/api/v1/templates/{template_id}/chat")
def template_chat(template_id: str, req: TemplateChatRequest):
    """
    テンプレートの改善方針について、AIとチャットで対話するAPI。
    """
    doc_ref = db.collection(TEMPLATES_COLLECTION).document(template_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Template not found")
    template = doc.to_dict()

    # システムプロンプト（AIへの役割設定）
    system_instruction = f"""
    あなたは親切で優秀なAIプロンプトエンジニアです。ユーザーと対話しながら、AIデータ生成用のテンプレート（プロンプト）を改善するのが仕事です。
    
    【現在のプロンプト】
    {template['generation_config']['system_instruction']}
    
    【現在のJSONスキーマ】
    {json.dumps(template['generation_config']['response_schema'], ensure_ascii=False)}
    """
    
    # ジョブIDがあり、エラー履歴が存在する場合はコンテキストに追加
    if req.job_id and req.job_id in jobs_db:
        feedbacks = jobs_db[req.job_id].get("feedbacks", [])
        if feedbacks:
            system_instruction += f"\n\n【直近の生成で発生した低評価の理由（参考情報）】\n{json.dumps(feedbacks, ensure_ascii=False)}"

    system_instruction += "\n\nユーザーの要望を聞き出し、「では、プロンプトにこのようなルールを追加しましょうか？」といった形で対話を進めてください。ここではまだ完成したプロンプトを長々と出力する必要はなく、改善方針のすり合わせに徹してください。"

    # 会話履歴の構築
    from vertexai.generative_models import GenerativeModel, Content, Part
    chat_model = GenerativeModel("gemini-2.5-pro", system_instruction=[system_instruction])
    
    history = []
    for msg in req.messages[:-1]: # 最後のメッセージ以外を履歴とする
        role = "user" if msg.role == "user" else "model"
        history.append(Content(role=role, parts=[Part.from_text(msg.content)]))
        
    latest_user_message = req.messages[-1].content
    
    try:
        # Vertex AI のチャットセッションを開始して応答を生成
        chat_session = chat_model.start_chat(history=history)
        response = chat_session.send_message(latest_user_message)
        return {"reply": response.text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


@app.post("/api/v1/templates/{template_id}/chat/finalize")
def finalize_template_from_chat(template_id: str, req: TemplateChatRequest):
    """
    対話が終了し「確定ボタン」が押された際に、会話履歴全体を読み込んで
    最終的な新しいテンプレート構造（JSON）を生成するAPI。
    """
    doc_ref = db.collection(TEMPLATES_COLLECTION).document(template_id)
    template = doc_ref.get().to_dict()

    # 会話履歴を1つのテキストにまとめる
    chat_history_text = ""
    for msg in req.messages:
        role_name = "ユーザー" if msg.role == "user" else "AI(あなた)"
        chat_history_text += f"{role_name}: {msg.content}\n"

    finalize_prompt = f"""
    あなたはプロンプトエンジニアです。ユーザーとの以下の対話履歴を踏まえて、最終的な「新しいプロンプト」と「必要であれば修正したJSONスキーマ」を出力してください。
    
    【元のプロンプト】
    {template['generation_config']['system_instruction']}
    
    【対話履歴】
    {chat_history_text}
    
    上記の対話で決定した方針を漏れなく反映し、以下のJSON形式で出力してください。
    """
    
    schema = {
        "type": "OBJECT",
        "properties": {
            "optimized_system_instruction": {"type": "STRING", "description": "対話内容を反映した新しいプロンプト本文"},
            "optimized_response_schema": {"type": "OBJECT", "description": "対話の中でスキーマの変更が話題になっていれば修正したものを。話題になっていなければ元のスキーマをそのまま出力"},
            "summary_of_changes": {"type": "STRING", "description": "どこをどう変更したかの短い要約"}
        },
        "required": ["optimized_system_instruction", "optimized_response_schema", "summary_of_changes"]
    }
    
    from vertexai.generative_models import GenerativeModel, GenerationConfig
    model = GenerativeModel("gemini-2.5-pro")
    
    try:
        response = model.generate_content(
            finalize_prompt,
            generation_config=GenerationConfig(temperature=0.2, response_mime_type="application/json", response_schema=schema)
        )
        
        text = response.text.strip()
        if text.startswith("```json"): text = text[7:]
        if text.endswith("```"): text = text[:-3]
        result = json.loads(text.strip())
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Finalize failed: {str(e)}")

# ==========================================
# 6. データ増幅 (Data Augmentation) ジョブ
# ==========================================
from pydantic import BaseModel, Field

class AugmentJobCreate(BaseModel):
    # ユーザーが用意した「お手本データ」のリスト（例: [{ "user_query": "田中ですが...", "agent_response": "..." }]）
    seed_data: List[Dict[str, str]]
    
    # どの項目を「入力(input)」とし、どの項目を「出力(output)」とするかの定義
    schema_keys: List[str] # 例: ["user_query", "agent_response"]
    
    # 増幅に関する指示（例: "人名、部署名、金額、エラーの状況を変更してください"）
    augmentation_instruction: str
    
    # 増幅して作りたい総件数
    num_samples: int = Field(gt=0, le=1000)
    
    # Weave保存先のプロジェクト名
    project_name: str

@app.post("/api/v1/jobs/augment", status_code=202)
def create_augment_job(
    req: AugmentJobCreate, 
    background_tasks: BackgroundTasks,
    x_wandb_api_key: str = Header(None, description="User's W&B API Key")
):
    if not x_wandb_api_key:
        raise HTTPException(status_code=401, detail="X-Wandb-Api-Key header is missing")
    if not req.seed_data or len(req.seed_data) == 0:
        raise HTTPException(status_code=400, detail="Seed data is required")
        
    job_id = f"job_aug_{uuid.uuid4().hex[:8]}"
    
    # エンティティ名の取得（generateと同様の処理）
    if "/" in req.project_name:
        parts = req.project_name.split("/", 1)
        entity_name, actual_project_name = parts[0], parts[1]
    else:
        actual_project_name = req.project_name
        try:
            res = requests.post("https://api.wandb.ai/graphql", auth=("api", x_wandb_api_key), json={"query": "query { viewer { entity } }"}, timeout=5)
            entity_name = res.json().get("data", {}).get("viewer", {}).get("entity") or "your-entity"
        except Exception:
            entity_name = "your-entity"

    target_dataset_name = f"augmented_data_{uuid.uuid4().hex[:6]}"
    weave_dashboard_url = f"https://wandb.ai/{entity_name}/{actual_project_name}/weave/traces"
    weave_dataset_url = f"https://wandb.ai/{entity_name}/{actual_project_name}/weave/objects/{target_dataset_name}/versions"
    
    jobs_db[job_id] = {
        "job_id": job_id, "status": "running", "type": "augmentation",
        "progress": {"target_count": req.num_samples, "generated_count": 0, "evaluated_count": 0, "passed_count": 0, "failed_count": 0},
        "started_at": datetime.utcnow().isoformat(),
        "weave_dashboard_url": weave_dashboard_url,
        "target_dataset_name": target_dataset_name,
        "weave_dataset_url": weave_dataset_url
    }
    
    # Augmentation専用のパイプラインをバックグラウンドで起動
    background_tasks.add_task(run_augmentation_pipeline, job_id, req.dict(), x_wandb_api_key, jobs_db)
    
    return {"job_id": job_id, "status": "pending", "target_dataset_name": target_dataset_name, "weave_dataset_url": weave_dataset_url}