import type { JobHistoryEntry, JobStatusResponse, TemplateHistoryEntry, TemplateResponse } from "@/types/api";

const TEMPLATE_HISTORY_KEY = "template_history";
const TEMPLATE_CACHE_KEY = "template_cache";
const JOB_HISTORY_KEY = "job_history";
const JOB_STATUS_CACHE_KEY = "job_status_cache";
const MAX_ENTRIES = 100;

// --- テンプレート履歴 ---

export function getTemplateHistory(): TemplateHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(TEMPLATE_HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

export function addTemplateHistory(entry: TemplateHistoryEntry): void {
  const history = getTemplateHistory();
  const filtered = history.filter((h) => h.template_id !== entry.template_id);
  const updated = [entry, ...filtered].slice(0, MAX_ENTRIES);
  localStorage.setItem(TEMPLATE_HISTORY_KEY, JSON.stringify(updated));
}

// --- テンプレートキャッシュ (API レスポンスのローカル保持) ---

function getTemplateCacheAll(): Record<string, TemplateResponse> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(TEMPLATE_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function cacheTemplate(templateId: string, data: TemplateResponse): void {
  const cache = getTemplateCacheAll();
  cache[templateId] = data;
  localStorage.setItem(TEMPLATE_CACHE_KEY, JSON.stringify(cache));
}

export function getCachedTemplate(templateId: string): TemplateResponse | null {
  return getTemplateCacheAll()[templateId] ?? null;
}

// --- ジョブ履歴 ---

export function getJobHistory(): JobHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(JOB_HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

export function addJobHistory(entry: JobHistoryEntry): void {
  const history = getJobHistory();
  const filtered = history.filter((h) => h.job_id !== entry.job_id);
  const updated = [entry, ...filtered].slice(0, MAX_ENTRIES);
  localStorage.setItem(JOB_HISTORY_KEY, JSON.stringify(updated));
}

export function updateJobHistoryStatus(
  jobId: string,
  status: JobHistoryEntry["status"]
): void {
  const history = getJobHistory();
  const idx = history.findIndex((h) => h.job_id === jobId);
  if (idx !== -1) {
    history[idx].status = status;
    localStorage.setItem(JOB_HISTORY_KEY, JSON.stringify(history));
  }
}

// --- ジョブステータスキャッシュ (API レスポンスのローカル保持) ---

function getJobStatusCacheAll(): Record<string, JobStatusResponse> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(JOB_STATUS_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function cacheJobStatus(jobId: string, data: JobStatusResponse): void {
  const cache = getJobStatusCacheAll();
  cache[jobId] = data;
  localStorage.setItem(JOB_STATUS_CACHE_KEY, JSON.stringify(cache));
}

export function getCachedJobStatus(jobId: string): JobStatusResponse | null {
  return getJobStatusCacheAll()[jobId] ?? null;
}
