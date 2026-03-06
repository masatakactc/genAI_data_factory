import json
import logging
import os
import time  # スリープ処理用に追加
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from google.api_core.exceptions import ResourceExhausted  # 429エラー検知用
import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig
import weave
import asyncio

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

def parse_json_safely(text: str) -> dict | list:
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return json.loads(text.strip())

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
# Weave Evaluation用のメモリとクラス定義
# ==========================================
# 評価結果を一時保存するためのグローバル変数（ジョブIDごとにスコアを格納）
JOB_EVAL_RESULTS = {}

class QualityScorer(weave.Scorer):
    judge_model_name: str
    criteria: str
    job_id: str  # どのジョブの評価かを識別するため追加

    @retry(
        retry=retry_if_exception_type(ResourceExhausted),
        stop=stop_after_attempt(8), 
        wait=wait_exponential(multiplier=2, min=5, max=65)
    )
    @weave.op()
    def score(self, model_output: dict) -> dict:
        """LLM as a Judge を実行するScorer"""
        model = GenerativeModel(self.judge_model_name)
        
        # LLMに渡すプロンプトからは、内部管理用の _sample_id を除外して綺麗にする
        eval_data = {k: v for k, v in model_output.items() if k != "_sample_id"}
        
        eval_prompt = f"基準: {self.criteria}\nデータ: {json.dumps(eval_data, ensure_ascii=False)}"
        
        schema = {
            "type": "OBJECT",
            "properties": {"score": {"type": "INTEGER"}, "reason": {"type": "STRING"}},
            "required": ["score", "reason"]
        }
        generation_config = GenerationConfig(
            temperature=0.0, response_mime_type="application/json", response_schema=schema
        )
        
        # ProモデルのRPM制限対策
        time.sleep(1.5)
        
        response = model.generate_content(eval_prompt, generation_config=generation_config)
        eval_res = json.loads(response.text)
        
        # 【重要】Weaveが裏で評価を回している間に、そのスコアをメモリに記録する
        sample_id = model_output.get("_sample_id")
        if sample_id is not None and self.job_id in JOB_EVAL_RESULTS:
            JOB_EVAL_RESULTS[self.job_id][sample_id] = eval_res
            
        return eval_res

class GeneratedDataEvaluator(weave.Model):
    @weave.op()
    def predict(self, raw_sample: dict) -> dict:
        return raw_sample

# ==========================================
# 3. パイプライン・オーケストレーション
# ==========================================
def run_generation_pipeline(job_id: str, template: dict, req: dict, wandb_api_key: str, jobs_db: dict):
    os.environ["WANDB_API_KEY"] = wandb_api_key
    
    # 【修正】そのまま req["project_name"] を渡す（例: "my-team/my-project"）
    weave.init(req["project_name"])
    
    gen_config = template["generation_config"]
    eval_config = template["evaluation_config"]
    total_samples = req["num_samples"]
    BATCH_SIZE = 10 
    
    # ------------------------------------------
    # フェーズ1: データ生成（バッチで一気に作る）
    # ------------------------------------------
    all_generated_samples = []
    
    for i in range(0, total_samples, BATCH_SIZE):
        if jobs_db[job_id]["status"] == "cancelled": break
            
        current_batch_size = min(BATCH_SIZE, total_samples - i)
        try:
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
                
            valid_samples = bulk_samples[:current_batch_size]
            all_generated_samples.extend(valid_samples)
            jobs_db[job_id]["progress"]["generated_count"] += len(valid_samples)
            
        except Exception as e:
            logger.error(f"Generation error: {e}")
            jobs_db[job_id]["progress"]["failed_count"] += current_batch_size

    # キャンセル時や生成ゼロ件の場合はここで終了
    if jobs_db[job_id]["status"] == "cancelled" or not all_generated_samples:
        return
        
    # ------------------------------------------
    # フェーズ2: Weave Evaluation の一括実行
    # ------------------------------------------
    # メモリ上にこのジョブ用の保存領域を準備
    JOB_EVAL_RESULTS[job_id] = {}
    
    # 評価後にスコアを紐付けられるように、各データに一時的なID(_sample_id)を振る
    for idx, sample in enumerate(all_generated_samples):
        sample["_sample_id"] = idx
        
    eval_dataset = [{"raw_sample": s} for s in all_generated_samples]
    
    model = GeneratedDataEvaluator()
    scorer = QualityScorer(
        judge_model_name=eval_config["judge_model"], 
        criteria=eval_config["criteria"],
        job_id=job_id # 追加
    )
    
    evaluation = weave.Evaluation(
        name=f"Eval_{job_id}",
        dataset=eval_dataset,
        scorers=[scorer],
    )
    
    async def run_eval_and_filter():
        # 1. Weave Evaluationを実行 (ここで並列評価が走り、W&Bダッシュボードに反映される)
        await evaluation.evaluate(model)
        
        passed = []
        feedbacks = []
        
        # 2. メモリに保存されたスコアを取り出して合否を判定する
        for sample in all_generated_samples:
            sample_id = sample.get("_sample_id")
            eval_res = JOB_EVAL_RESULTS[job_id].get(sample_id, {"score": 0, "reason": "Eval failed"})
            
            score = eval_res.get("score", 0)
            reason = eval_res.get("reason", "")
            
            # _sample_id はもう不要なので消す
            del sample["_sample_id"]
            
            jobs_db[job_id]["progress"]["evaluated_count"] += 1
            
            if score >= eval_config["min_passing_score"]:
                sample["_evaluation"] = eval_res
                passed.append(sample)
                jobs_db[job_id]["progress"]["passed_count"] += 1
            else:
                jobs_db[job_id]["progress"]["failed_count"] += 1
                if len(feedbacks) < 20:
                    feedbacks.append(f"Score {score}: {reason}")
                    
        return passed, feedbacks

    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
    passed_samples, feedbacks = loop.run_until_complete(run_eval_and_filter())
    
    # 使い終わったメモリを掃除する
    if job_id in JOB_EVAL_RESULTS:
        del JOB_EVAL_RESULTS[job_id]

    if "feedbacks" not in jobs_db[job_id]:
        jobs_db[job_id]["feedbacks"] = feedbacks
    else:
        jobs_db[job_id]["feedbacks"].extend(feedbacks)

    # ------------------------------------------
    # フェーズ3: 完了とデータセットのPublish
    # ------------------------------------------
    if jobs_db[job_id]["status"] != "cancelled":
        jobs_db[job_id]["status"] = "completed"
        if passed_samples:
            dataset_name = f"dataset_{req['template_id']}"
            dataset = weave.Dataset(name=dataset_name, rows=passed_samples)
            weave.publish(dataset)
            
# ==========================================
# データ増幅 (Data Augmentation) 用バッチ生成関数
# ==========================================
import random

@retry(retry=retry_if_exception_type(ResourceExhausted), stop=stop_after_attempt(8), wait=wait_exponential(multiplier=2, min=5, max=65))
@weave.op()
def augment_bulk_samples(seed_samples: list, instruction: str, schema_keys: list, batch_size: int) -> list:
    # 返却用のスキーマを動的に組み立てる（req.schema_keysの項目を文字列で返す）
    item_properties = {key: {"type": "STRING"} for key in schema_keys}
    bulk_schema = {
        "type": "ARRAY",
        "items": {"type": "OBJECT", "properties": item_properties, "required": schema_keys}
    }
    
    prompt = f"""
    あなたは優秀なデータ作成エンジニアです。
    ユーザーから「お手本となる数件のシードデータ」が提供されました。
    このデータから推測される利用用途や含まれる文脈、フォーマットを保ちつつ、以下の【変更指示】に従って内容（固有名詞や状況）をアレンジし、
    完全に新しいバリエーションのデータを {batch_size} 件作成してください。
    
    【変更指示（ここで指定された項目をアレンジし、それに応じた正しい出力結果を作成すること）】
    {instruction}
    
    【お手本のシードデータ】
    {json.dumps(seed_samples, ensure_ascii=False, indent=2)}
    
    【出力ルール】
    シードデータと同じキー構造を持つ、独立した多様なデータをシードデータと同様の言語で {batch_size} 件の配列として出力してください。
    """
    
    model = GenerativeModel("gemini-2.5-pro", system_instruction=prompt) # Augmentationは賢さが必要なためProを推奨
    generation_config = GenerationConfig(
        temperature=0.8, # 多様性を出すため高めに設定
        response_mime_type="application/json",
        response_schema=bulk_schema
    )
    
    response = model.generate_content("Generate augmented samples.", generation_config=generation_config)
    return parse_json_safely(response.text)

# ==========================================
# データ増幅用パイプライン・オーケストレーション
# ==========================================
def run_augmentation_pipeline(job_id: str, req: dict, wandb_api_key: str, jobs_db: dict):
    try:
        os.environ["WANDB_API_KEY"] = wandb_api_key

        weave.init(req["project_name"])
        
        passed_samples = []
        total_samples = req["num_samples"]
        BATCH_SIZE = 10 
        seed_data_list = req["seed_data"]
        
        for i in range(0, total_samples, BATCH_SIZE):
            if jobs_db[job_id]["status"] == "cancelled": 
                logger.info(f"Augment job {job_id} was cancelled by user.")
                break
                
            current_batch_size = min(BATCH_SIZE, total_samples - i)
            
            try:
                time.sleep(2)
                # シードデータ全体を渡すとトークンが溢れる可能性があるため、ランダムに最大5件をサンプリングして渡す
                sample_size = min(len(seed_data_list), 5)
                selected_seeds = random.sample(seed_data_list, sample_size)
                
                bulk_samples = augment_bulk_samples(
                    seed_samples=selected_seeds,
                    instruction=req["augmentation_instruction"],
                    schema_keys=req["schema_keys"],
                    batch_size=current_batch_size
                )
                
                if not isinstance(bulk_samples, list): 
                    bulk_samples = [bulk_samples]
                    
                # Augmentation機能では、「評価(Evaluate)」は一旦スキップし、全件を成功とみなして保存する設計
                for sample in bulk_samples[:current_batch_size]:
                    if jobs_db[job_id]["status"] == "cancelled": 
                        break
                    jobs_db[job_id]["progress"]["generated_count"] += 1
                    jobs_db[job_id]["progress"]["evaluated_count"] += 1 # 評価スキップ扱い
                    passed_samples.append(sample)
                    jobs_db[job_id]["progress"]["passed_count"] += 1
                    
            except Exception as e:
                logger.error(f"Error in augment job {job_id}, batch starting at {i}: {e}")
                jobs_db[job_id]["progress"]["failed_count"] += current_batch_size

        if jobs_db[job_id]["status"] != "cancelled":
            jobs_db[job_id]["status"] = "completed"
            if passed_samples:
                dataset_name = jobs_db[job_id]["target_dataset_name"]
                dataset = weave.Dataset(name=dataset_name, rows=passed_samples)
                weave.publish(dataset)
                logger.info(f"Published augmented dataset {dataset_name} to Weave.")
            else:
                logger.warning(f"No samples were generated for augment job {job_id}.")

    except Exception as fatal_error:
        logger.error(f"FATAL ERROR in augment pipeline for job {job_id}: {fatal_error}", exc_info=True)
        if job_id in jobs_db:
            jobs_db[job_id]["status"] = "failed"
            jobs_db[job_id]["error_message"] = str(fatal_error)
