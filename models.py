from pydantic import BaseModel, Field
from typing import Dict, Any, Optional

class GenerationConfigBase(BaseModel):
    model: str = "gemini-1.5-flash-002"
    system_instruction: str
    temperature: float = 0.7
    response_mime_type: str = "application/json"
    response_schema: Dict[str, Any]

class EvaluationConfigBase(BaseModel):
    judge_model: str = "gemini-1.5-pro-002"
    criteria: str
    min_passing_score: int = 4

class TemplateCreate(BaseModel):
    name: str
    description: str
    generation_config: GenerationConfigBase
    evaluation_config: EvaluationConfigBase

class JobCreate(BaseModel):
    template_id: str
    num_samples: int = Field(gt=0, le=1000)
    variables: Dict[str, str] = {}
    project_name: str