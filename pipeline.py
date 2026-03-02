import json
import logging
import os
from tenacity import retry, stop_after_attempt, wait_exponential
import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig
import weave

logger = logging.getLogger(__name__)

# Vertex AIの呼び出し（リトライ付き）
@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, min=2, max=10))
@weave.op()
def generate_single_sample(model_name: str, system_instruction: str, temperature: float, 
                           schema: dict, variables: dict) -> dict:
    prompt = system_instruction
    for k, v in variables.items():
        prompt = prompt.replace(f"{{{{{k}}}}}", v)
    
    model = GenerativeModel(model_name, system_instruction=[prompt])
    generation_config = GenerationConfig(
        temperature=temperature,
        response_mime_type="application/json",
        response_schema=schema
    )
    
    response = model.generate_content("Generate a sample.", generation_config=generation_config)
    return json.loads(response.text)

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

def run_generation_pipeline(job_id: str, template: dict, req: dict, wandb_api_key: str, jobs_db: dict):
    # W&B認証をユーザーのAPIキーで初期化
    os.environ["WANDB_API_KEY"] = wandb_api_key
    weave.init(req["project_name"])
    
    gen_config = template["generation_config"]
    eval_config = template["evaluation_config"]
    passed_samples = []
    
    for i in range(req["num_samples"]):
        if jobs_db[job_id]["status"] == "cancelled":
            break
            
        try:
            sample = generate_single_sample(
                model_name=gen_config["model"],
                system_instruction=gen_config["system_instruction"],
                temperature=gen_config["temperature"],
                schema=gen_config["response_schema"],
                variables=req["variables"]
            )
            jobs_db[job_id]["progress"]["generated_count"] += 1
            
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
            logger.error(f"Error in job {job_id}, sample {i}: {e}")
            jobs_db[job_id]["progress"]["failed_count"] += 1

    if jobs_db[job_id]["status"] != "cancelled":
        jobs_db[job_id]["status"] = "completed"
        if passed_samples:
            dataset_name = f"{template['name']}_dataset"
            dataset = weave.Dataset(name=dataset_name, rows=passed_samples)
            weave.publish(dataset)