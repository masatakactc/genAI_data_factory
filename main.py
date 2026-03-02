from fastapi import FastAPI, BackgroundTasks, HTTPException, Header
from typing import Dict
import uuid
import vertexai
from datetime import datetime

from models import TemplateCreate, JobCreate
from pipeline import run_generation_pipeline

app = FastAPI(title="GenAI Data Factory API (User W&B Auth)")

templates_db: Dict[str, dict] = {}
jobs_db: Dict[str, dict] = {}

@app.on_event("startup")
def startup_event():
    # Cloud Run環境のデフォルト権限でVertex AIを初期化
    vertexai.init()

@app.post("/api/v1/templates", status_code=201)
def create_template(template: TemplateCreate):
    template_id = f"tpl_{uuid.uuid4().hex[:8]}"
    templates_db[template_id] = template.dict()
    return {"template_id": template_id, "created_at": datetime.utcnow().isoformat()}

@app.post("/api/v1/jobs/generate", status_code=202)
def create_job(
    req: JobCreate, 
    background_tasks: BackgroundTasks,
    x_wandb_api_key: str = Header(None, description="User's W&B API Key")
):
    if not x_wandb_api_key:
        raise HTTPException(status_code=401, detail="X-Wandb-Api-Key header is missing")
    if req.template_id not in templates_db:
        raise HTTPException(status_code=404, detail="Template not found")
        
    job_id = f"job_{uuid.uuid4().hex[:8]}"
    jobs_db[job_id] = {
        "job_id": job_id,
        "status": "running",
        "progress": {"target_count": req.num_samples, "generated_count": 0, "evaluated_count": 0, "passed_count": 0, "failed_count": 0},
        "started_at": datetime.utcnow().isoformat(),
        "weave_dashboard_url": f"https://wandb.ai/home/{req.project_name}/weave/traces"
    }
    
    template = templates_db[req.template_id]
    # W&Bキーをパイプラインに渡す
    background_tasks.add_task(run_generation_pipeline, job_id, template, req.dict(), x_wandb_api_key, jobs_db)
    
    return {"job_id": job_id, "status": "pending"}

@app.get("/api/v1/jobs/{job_id}")
def get_job_status(job_id: str):
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs_db[job_id]