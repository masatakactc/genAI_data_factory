import json
import logging
import os
import time  # スリープ処理用に追加
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from google.api_core.exceptions import ResourceExhausted  # 429エラー検知用
import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig
import weave

logger = logging.getLogger(__name__)

# ==========================================
# 1. バッチ生成関数
# ==========================================
# 429エラー(ResourceExhausted)が出た場合、最大1分(65秒)以上待てるように強化
@retry(
    retry=retry_if_exception_type(ResourceExhausted),
    stop=stop_after_attempt(8), 
    wait=wait_exponential(multiplier=2, min=5, max=65)
)
@weave.op()
def generate_bulk_samples(model_name: str, system_instruction: str, temperature: float, 
                          single_schema: dict, variables: dict, batch_size: int) -> list:
    
    prompt = system_instruction
    for k, v in variables.items():
        prompt = prompt.replace(f"{{{{{k}}}}}", v)
    
    prompt += f"\n\n【重要指示】上記の条件とスキーマに従い、互いに独立した多様なバリエーションのデータを {batch_size} 件作成し、JSON配列（Array）として出力してください。"
    
    model = GenerativeModel(model_name, system_instruction=[prompt])
    
    bulk_schema = {
        "type": "ARRAY",
        "items": single_schema
    }
    
    generation_config = GenerationConfig(
        temperature=temperature,
        response_mime_type="application/json",
        response_schema=bulk_schema
    )
    
    response = model.generate_content(f"Generate {batch_size} samples.", generation_config=generation_config)
    return json.loads(response.text)


# ==========================================
# 2. 個別評価関数
# ==========================================
# Proモデルの厳しいRPMを考慮し、こちらも最大65秒のリトライ待機を設定
@retry(
    retry=retry_if_exception_type(ResourceExhausted),
    stop=stop_after_attempt(8), 
    wait=wait_exponential(multiplier=2, min=5, max=65)
)
@weave.op()
def evaluate_sample(judge_model_name: str, criteria: str, sample_data: dict) -> dict:
    model = GenerativeModel(judge_model_name)
    eval_prompt = f"基準: {criteria}\nデータ: {json.dumps(sample_data, ensure_ascii=False)}"
    
    schema = {
        "type": "OBJECT",
        "properties": {"score": {"type": "INTEGER"}, "reason": {"type": "STRING"}},
        "required": ["score", "reason"]
    }
    generation_config = GenerationConfig(
        temperature=0.0, response_mime_type="application/json", response_schema=schema
    )
    
    response = model.generate_content(eval_prompt, generation_config=generation_config)
    return json.loads(response.text)


# ==========================================
# 3. パイプライン・オーケストレーション
# ==========================================
def run_generation_pipeline(job_id: str, template: dict, req: dict, wandb_api_key: str, jobs_db: dict):
    
    os.environ["WANDB_API_KEY"] = wandb_api_key
    weave.init(req["project_name"])
    
    gen_config = template["generation_config"]
    eval_config = template["evaluation_config"]
    passed_samples = []
    
    total_samples = req["num_samples"]
    BATCH_SIZE = 10 
    
    for i in range(0, total_samples, BATCH_SIZE):
        if jobs_db[job_id]["status"] == "cancelled":
            break
            
        current_batch_size = min(BATCH_SIZE, total_samples - i)
        
        try:
            # バッチ生成前に少し待機（APIのQPSスパイクを防ぐ）
            time.sleep(2)
            
            bulk_samples = generate_bulk_samples(
                model_name=gen_config["model"],
                system_instruction=gen_config["system_instruction"],
                temperature=gen_config["temperature"],
                single_schema=gen_config["response_schema"],
                variables=req["variables"],
                batch_size=current_batch_size
            )
            
            if not isinstance(bulk_samples, list):
                bulk_samples = [bulk_samples]
                
            for sample in bulk_samples[:current_batch_size]:
                if jobs_db[job_id]["status"] == "cancelled":
                    break
                    
                jobs_db[job_id]["progress"]["generated_count"] += 1
                
                # 【重要】評価API（Proモデル）を叩く前に意図的に1.5秒待つ（RPMを40程度に物理制限する）
                time.sleep(1.5)
                
                eval_result = evaluate_sample(
                    judge_model_name=eval_config["judge_model"],
                    criteria=eval_config["criteria"],
                    sample_data=sample
                )
                jobs_db[job_id]["progress"]["evaluated_count"] += 1
                
                if eval_result.get("score", 0) >= eval_config["min_passing_score"]:
                    sample["_evaluation"] = eval_result
                    passed_samples.append(sample)
                    jobs_db[job_id]["progress"]["passed_count"] += 1
                else:
                    jobs_db[job_id]["progress"]["failed_count"] += 1
                    
        except Exception as e:
            logger.error(f"Error in job {job_id}, batch starting at {i}: {e}")
            jobs_db[job_id]["progress"]["failed_count"] += current_batch_size

    if jobs_db[job_id]["status"] != "cancelled":
        jobs_db[job_id]["status"] = "completed"
        
        if passed_samples:
            dataset_name = f"dataset_{req['template_id']}"
            dataset = weave.Dataset(name=dataset_name, rows=passed_samples)
            weave.publish(dataset)