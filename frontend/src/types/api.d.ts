export interface GenerationConfig {
  model: string;
  system_instruction: string;
  temperature: number;
  response_mime_type: string;
  response_schema: Record<string, unknown>;
}

export interface EvaluationConfig {
  judge_model: string;
  criteria: string;
  min_passing_score: number;
}

export interface TemplateCreatePayload {
  name: string;
  description: string;
  generation_config: GenerationConfig;
  evaluation_config: EvaluationConfig;
}

export interface TemplateResponse {
  template_id: string;
  name: string;
  description: string;
  generation_config: GenerationConfig;
  evaluation_config: EvaluationConfig;
  created_at: string;
}

export interface JobCreatePayload {
  template_id: string;
  num_samples: number;
  variables: Record<string, string>;
  project_name: string;
}

export interface JobProgress {
  target_count: number;
  generated_count: number;
  evaluated_count: number;
  passed_count: number;
  failed_count: number;
}

export interface JobStatusResponse {
  job_id: string;
  status: "pending" | "running" | "completed" | "cancelled" | "failed";
  progress: JobProgress;
  started_at: string;
  weave_dashboard_url?: string;
  target_dataset_name?: string;
  weave_dataset_url?: string;
}

export interface JobCreateResponse {
  job_id: string;
  status: string;
  target_dataset_name: string;
  weave_dataset_url: string;
}

// localStorage 履歴用

export interface TemplateHistoryEntry {
  template_id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface JobHistoryEntry {
  job_id: string;
  group_id: string;
  template_id: string;
  template_name: string;
  project_name: string;
  num_samples: number;
  variables: Record<string, string>;
  target_dataset_name: string;
  weave_dataset_url?: string;
  status: JobStatusResponse["status"];
  created_at: string;
}

// テンプレート最適化 (Prompt Optimization)

export interface OptimizeResponse {
  original_template_id: string;
  analysis_report: string;
  optimized_system_instruction: string;
}

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface ChatResponse {
  reply: string;
}

export interface ChatFinalizeResponse {
  optimized_system_instruction: string;
  optimized_response_schema?: Record<string, unknown>;
  summary_of_changes: string;
}

// データ増幅 (Data Augmentation)

export interface AugmentPayload {
  seed_data: Record<string, string>[];
  schema_keys: string[];
  augmentation_instruction: string;
  num_samples: number;
  project_name: string;
}

export interface AugmentResponse {
  job_id: string;
  status: string;
  target_dataset_name: string;
  weave_dataset_url: string;
}

// JSONL エクスポート行

export interface DatasetExportRow {
  user_query: string;
  agent_response: string;
  _evaluation: {
    score: number;
    reason: string;
  };
  [key: string]: unknown;
}
