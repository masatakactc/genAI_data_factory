from fastapi import FastAPI, BackgroundTasks, HTTPException, Header
from fastapi.responses import StreamingResponse
from typing import Dict, List
import uuid
import os
import json
from datetime import datetime
import requests

import vertexai
import weave
# Firestoreのインポートを追加
from google.cloud import firestore

from models import TemplateCreate, JobCreate
from pipeline import run_generation_pipeline

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