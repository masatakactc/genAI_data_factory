import json
import logging
import os
import math
from tenacity import retry, stop_after_attempt, wait_exponential
import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig
import weave

logger = logging.getLogger(__name__)

# ==========================================
# 1. バッチ生成関数 (1リクエストで複数件生成)
# ==========================================
@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, min=2, max=10))
@weave.op()
def generate_bulk_samples(model_name: str, system_instruction: str, temperature: float, 
                          single_schema: dict, variables: dict, batch_size: int) -> list:
    
    # プロンプトの変数を置換
    prompt = system_instruction
    for k, v in variables.items():
        prompt = prompt.replace(f"{{{{{k}}}}}", v)
    
    # バッチ処理用の強力な指示を自動追記する
    prompt += f"\n\n【重要指示】上記の条件とスキーマに従い、互いに独立した多様なバリエーションのデータを {batch_size} 件作成し、JSON配列（Array）として出力してください。"
    
    model = GenerativeModel(model_name, system_instruction=[prompt])
    
    # 受け取った「1件分のスキーマ」を、Vertex AI用に「配列スキーマ」でラップする
    bulk_schema = {
        "type": "ARRAY",
        "items": single_schema
    }
    
    generation_config = GenerationConfig(
        temperature=temperature,
        response_mime_type="application/json",
        response_schema=bulk_schema
    )
    
    # Geminiに配列データ生成をリクエスト
    response = model.generate_content(f"Generate {batch_size} samples.", generation_config=generation_config)
    return json.loads(response.text)


# ==========================================
# 2. 個別評価関数 (1件ずつ丁寧に評価)
# ==========================================
@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, min=2, max=10))
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
    # 1リクエストで生成する件数（安全のため最大10件に固定）
    BATCH_SIZE = 50
    
    # バッチサイズごとにループを回す (例: 25件なら 10 -> 10 -> 5)
    for i in range(0, total_samples, BATCH_SIZE):
        if jobs_db[job_id]["status"] == "cancelled":
            logger.info(f"Job {job_id} was cancelled by user.")
            break
            
        # 今回のループで生成する件数（端数対応）
        current_batch_size = min(BATCH_SIZE, total_samples - i)
        
        try:
            # 1. まとめて生成 (例: 1リクエストで10件のリストを取得)
            bulk_samples = generate_bulk_samples(
                model_name=gen_config["model"],
                system_instruction=gen_config["system_instruction"],
                temperature=gen_config["temperature"],
                single_schema=gen_config["response_schema"],
                variables=req["variables"],
                batch_size=current_batch_size
            )
            
            # 安全策: もしLLMが配列ではなく1件の辞書を返してきた場合はリスト化
            if not isinstance(bulk_samples, list):
                bulk_samples = [bulk_samples]
                
            # 2. 生成されたデータを1件ずつ分解して評価
            for sample in bulk_samples[:current_batch_size]:
                if jobs_db[job_id]["status"] == "cancelled":
                    break
                    
                jobs_db[job_id]["progress"]["generated_count"] += 1
                
                # 個別評価をリクエスト
                eval_result = evaluate_sample(
                    judge_model_name=eval_config["judge_model"],
                    criteria=eval_config["criteria"],
                    sample_data=sample
                )
                jobs_db[job_id]["progress"]["evaluated_count"] += 1
                
                # スコア判定
                if eval_result.get("score", 0) >= eval_config["min_passing_score"]:
                    sample["_evaluation"] = eval_result
                    passed_samples.append(sample)
                    jobs_db[job_id]["progress"]["passed_count"] += 1
                else:
                    jobs_db[job_id]["progress"]["failed_count"] += 1
                    
        except Exception as e:
            logger.error(f"Error in job {job_id}, batch starting at {i}: {e}")
            # バッチ生成全体が失敗した場合は、その件数分をエラーとしてカウント
            jobs_db[job_id]["progress"]["failed_count"] += current_batch_size

    # キャンセルされていなければ完了処理（Weaveへのデータセット保存）
    if jobs_db[job_id]["status"] != "cancelled":
        jobs_db[job_id]["status"] = "completed"
        
        if passed_samples:
            dataset_name = f"dataset_{req['template_id']}"
            dataset = weave.Dataset(name=dataset_name, rows=passed_samples)
            weave.publish(dataset)
            logger.info(f"Published dataset {dataset_name} to Weave.")