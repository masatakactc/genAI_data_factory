from fastapi import FastAPI, BackgroundTasks, HTTPException, Header
from fastapi.responses import StreamingResponse
from typing import Dict
import uuid
import vertexai
from datetime import datetime
import os
import json
import weave

from models import TemplateCreate, JobCreate
from pipeline import run_generation_pipeline

app = FastAPI(title="GenAI Data Factory API (Full Version)")

# インメモリDB (デモ・動作確認用)
templates_db: Dict[str, dict] = {}
jobs_db: Dict[str, dict] = {}

@app.on_event("startup")
def startup_event():
    # Cloud Run環境のデフォルト権限でVertex AIを初期化
    vertexai.init()


# ==========================================
# 1. テンプレート管理 (Templates)
# ==========================================

@app.post("/api/v1/templates", status_code=201)
def create_template(template: TemplateCreate):
    """データ生成・評価のルール（テンプレート）を登録する"""
    template_id = f"tpl_{uuid.uuid4().hex[:8]}"
    templates_db[template_id] = template.dict()
    return {"template_id": template_id, "created_at": datetime.utcnow().isoformat()}

@app.get("/api/v1/templates/{template_id}")
def get_template(template_id: str):
    """登録済みのテンプレート情報を取得する"""
    if template_id not in templates_db:
        raise HTTPException(status_code=404, detail="Template not found")
    return templates_db[template_id]


# ==========================================
# 2. ジョブ管理 (Jobs)
# ==========================================

@app.post("/api/v1/jobs/generate", status_code=202)
def create_job(
    req: JobCreate, 
    background_tasks: BackgroundTasks,
    x_wandb_api_key: str = Header(None, description="User's W&B API Key")
):
    """非同期でデータ生成・評価ジョブを開始する"""
    if not x_wandb_api_key:
        raise HTTPException(status_code=401, detail="X-Wandb-Api-Key header is missing")
    if req.template_id not in templates_db:
        raise HTTPException(status_code=404, detail="Template not found")
        
    job_id = f"job_{uuid.uuid4().hex[:8]}"
    
    # ジョブステータスの初期化
    jobs_db[job_id] = {
        "job_id": job_id,
        "status": "running",
        "progress": {
            "target_count": req.num_samples, 
            "generated_count": 0, 
            "evaluated_count": 0, 
            "passed_count": 0, 
            "failed_count": 0
        },
        "started_at": datetime.utcnow().isoformat(),
        "weave_dashboard_url": f"https://wandb.ai/home/{req.project_name}/weave/traces"
    }
    
    template = templates_db[req.template_id]
    
    # バックグラウンドで生成・評価パイプラインを実行
    background_tasks.add_task(run_generation_pipeline, job_id, template, req.dict(), x_wandb_api_key, jobs_db)
    
    return {"job_id": job_id, "status": "pending"}

@app.get("/api/v1/jobs/{job_id}")
def get_job_status(job_id: str):
    """実行中のジョブの進捗を取得する（フロントエンドのポーリング用）"""
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs_db[job_id]

@app.post("/api/v1/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    """実行中のジョブを強制停止する"""
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    if jobs_db[job_id]["status"] in ["completed", "failed"]:
        raise HTTPException(status_code=400, detail="Job is already finished")
        
    jobs_db[job_id]["status"] = "cancelled"
    return {"job_id": job_id, "status": "cancelled", "message": "Job cancellation requested."}


# ==========================================
# 3. データセット出力 (Datasets)
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