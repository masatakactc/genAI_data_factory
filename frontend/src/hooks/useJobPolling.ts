"use client";

import useSWR from "swr";
import { apiClient, ApiError } from "@/lib/api";
import { cacheJobStatus, getCachedJobStatus } from "@/lib/history";
import type { JobStatusResponse } from "@/types/api";

interface JobPollingData {
  job: JobStatusResponse;
  fromCache: boolean;
}

export const useJobPolling = (jobId: string | null) => {
  const { data, error, mutate } = useSWR<JobPollingData>(
    jobId ? `/jobs/${jobId}` : null,
    async (url: string) => {
      try {
        const res = await apiClient(url);
        const job: JobStatusResponse = await res.json();
        if (jobId) cacheJobStatus(jobId, job);
        return { job, fromCache: false };
      } catch (err) {
        // API 404 → ローカルキャッシュにフォールバック
        if (jobId && err instanceof ApiError && err.status === 404) {
          const cached = getCachedJobStatus(jobId);
          if (cached) return { job: cached, fromCache: true };
        }
        throw err;
      }
    },
    {
      refreshInterval: (latest: JobPollingData | undefined) => {
        // キャッシュ表示中はポーリング停止
        if (!latest || latest.fromCache) return 0;
        return latest.job.status === "running" || latest.job.status === "pending"
          ? 3000
          : 0;
      },
    }
  );

  return {
    job: data?.job ?? null,
    isFromCache: data?.fromCache ?? false,
    error,
    mutate,
  };
};
