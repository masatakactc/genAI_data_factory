"use client";

import { use, useState, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Sparkles, MessageSquare, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api";
import { useJobPolling } from "@/hooks/useJobPolling";
import { updateJobHistoryStatus, getJobHistory } from "@/lib/history";
import ResultPreview from "@/components/ResultPreview";
import OptimizeDialog from "@/components/dialogs/OptimizeDialog";
import ChatOptimizeDialog from "@/components/dialogs/ChatOptimizeDialog";
import TemplateCreateSheet from "@/components/sheets/TemplateCreateSheet";
import JobCreateSheet from "@/components/sheets/JobCreateSheet";
import type { JobStatusResponse } from "@/types/api";

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Pending", variant: "secondary" },
  running: { label: "Running", variant: "default" },
  completed: { label: "Completed", variant: "outline" },
  cancelled: { label: "Cancelled", variant: "destructive" },
  failed: { label: "Failed", variant: "destructive" },
};

function JobDetailContent({ job_id }: { job_id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { job, isFromCache, error } = useJobPolling(job_id);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Optimize / Chat state
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [templateSheetOpen, setTemplateSheetOpen] = useState(false);
  const [prefillInstruction, setPrefillInstruction] = useState<string | null>(null);
  const [prefillSchema, setPrefillSchema] = useState<Record<string, unknown> | undefined>(undefined);
  const [jobSheetOpen, setJobSheetOpen] = useState(false);
  const [newTemplateId, setNewTemplateId] = useState<string | null>(null);

  // 続けて生成 (augment) state
  const [continueNumSamples, setContinueNumSamples] = useState(50);
  const [continueSubmitting, setContinueSubmitting] = useState(false);

  // API もキャッシュもない場合、localStorage の JobHistoryEntry からフォールバック
  const historyFallback = useMemo<JobStatusResponse | null>(() => {
    if (job) return null; // API or cache available
    const entry = getJobHistory().find((h) => h.job_id === job_id);
    if (!entry) return null;
    return {
      job_id: entry.job_id,
      status: entry.status,
      progress: {
        target_count: entry.num_samples,
        generated_count: 0,
        evaluated_count: 0,
        passed_count: 0,
        failed_count: 0,
      },
      started_at: entry.created_at,
      target_dataset_name: entry.target_dataset_name,
      weave_dataset_url: entry.weave_dataset_url,
    };
  }, [job, job_id]);

  const displayJob = job ?? historyFallback;
  const isFallback = isFromCache || (!job && !!historyFallback);

  useEffect(() => {
    if (displayJob && ["completed", "cancelled", "failed"].includes(displayJob.status)) {
      updateJobHistoryStatus(job_id, displayJob.status);
    }
  }, [displayJob?.status, job_id]);

  const extractProjectFromDashboardUrl = (url?: string) => {
    if (!url) return null;
    const match = url.match(/wandb\.ai\/[^/]+\/([^/]+)\/weave/);
    return match ? match[1] : null;
  };

  const templateId = searchParams.get("template_id");
  const datasetName =
    displayJob?.target_dataset_name ??
    searchParams.get("dataset") ??
    (templateId ? `dataset_${templateId}` : null);
  const datasetUrl =
    displayJob?.weave_dataset_url ?? searchParams.get("dataset_url") ?? null;
  const projectName =
    searchParams.get("project") ??
    extractProjectFromDashboardUrl(displayJob?.weave_dashboard_url) ??
    null;

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await apiClient(`/jobs/${job_id}/cancel`, { method: "POST" });
      toast.success("ジョブをキャンセルしました。");
      setCancelDialogOpen(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "キャンセルに失敗しました。";
      toast.error(message);
    } finally {
      setCancelling(false);
    }
  };

  const handleDownload = async () => {
    if (!datasetName) {
      toast.error("データセット名が不明です。ジョブ実行画面から再度実行してください。");
      return;
    }
    const dataset = datasetName;
    const project = projectName;

    if (!project) {
      toast.error("プロジェクト名が不明です。ジョブ実行画面から再度実行してください。");
      return;
    }

    try {
      const res = await apiClient(
        `/datasets/${dataset}/export?project_name=${encodeURIComponent(
          project
        )}&format=jsonl`
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${dataset}.jsonl`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("ダウンロードを開始しました。");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        toast.error(
          "データセットがまだ保存されていません。しばらく待ってから再度お試しください。"
        );
      } else {
        const message =
          err instanceof Error ? err.message : "ダウンロードに失敗しました。";
        toast.error(message);
      }
    }
  };

  // 続けて生成 (augment): sessionStorage から設定を取得して再実行
  const augmentConfig = useMemo(() => {
    if (templateId) return null; // テンプレートジョブなら不要
    try {
      const raw = sessionStorage.getItem(`augment_config_${job_id}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [templateId, job_id]);

  const handleContinueAugment = async () => {
    if (!augmentConfig) return;
    setContinueSubmitting(true);
    try {
      const res = await apiClient("/jobs/augment", {
        method: "POST",
        body: JSON.stringify({
          ...augmentConfig,
          num_samples: continueNumSamples,
        }),
      });
      const result = await res.json();

      // 新ジョブにも設定を引き継ぐ
      try {
        sessionStorage.setItem(
          `augment_config_${result.job_id}`,
          JSON.stringify(augmentConfig)
        );
      } catch { /* ignore */ }

      toast.success("追加の増幅ジョブを開始しました。");
      const params = new URLSearchParams();
      if (result.target_dataset_name) params.set("dataset", result.target_dataset_name);
      if (result.weave_dataset_url) params.set("dataset_url", result.weave_dataset_url);
      params.set("project", augmentConfig.project_name);
      router.push(`/jobs/${result.job_id}?${params.toString()}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "ジョブの開始に失敗しました。";
      toast.error(message);
    } finally {
      setContinueSubmitting(false);
    }
  };

  const handleOptimizeApply = (optimizedInstruction: string) => {
    setPrefillInstruction(optimizedInstruction);
    setPrefillSchema(undefined);
    setTemplateSheetOpen(true);
  };

  const handleChatFinalize = (
    optimizedInstruction: string,
    optimizedSchema?: Record<string, unknown>
  ) => {
    setPrefillInstruction(optimizedInstruction);
    setPrefillSchema(optimizedSchema);
    setTemplateSheetOpen(true);
  };

  const handleTemplateCreated = (templateId: string) => {
    // テンプレート作成後、ジョブ作成シートを開く
    setTimeout(() => {
      setNewTemplateId(templateId);
      setJobSheetOpen(true);
    }, 300);
  };

  const handleJobCreated = (
    jobId: string,
    meta: {
      datasetName: string;
      datasetUrl?: string;
      projectName: string;
      templateId: string;
    }
  ) => {
    const params = new URLSearchParams();
    if (meta.datasetName) params.set("dataset", meta.datasetName);
    if (meta.datasetUrl) params.set("dataset_url", meta.datasetUrl);
    params.set("project", meta.projectName);
    params.set("template_id", meta.templateId);
    router.push(`/jobs/${jobId}?${params.toString()}`);
  };

  // API エラー & キャッシュもフォールバックもない
  if (error && !displayJob) {
    return (
      <div className="py-12 text-center">
        <p className="text-destructive">
          ジョブ情報の取得に失敗しました: {error.message}
        </p>
      </div>
    );
  }

  if (!displayJob) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">読み込み中...</p>
      </div>
    );
  }

  const progress = displayJob.progress;
  const progressPercent =
    progress.target_count > 0
      ? Math.round((progress.generated_count / progress.target_count) * 100)
      : 0;

  const statusConfig = STATUS_CONFIG[displayJob.status] ?? STATUS_CONFIG.pending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ジョブ監視</h1>
        <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
      </div>

      {/* キャッシュ / フォールバック表示中の警告 */}
      {isFallback && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            バックエンドとの接続が切れたため、ローカルに保存されたデータを表示しています。
            進捗は最後に取得した時点のものです。
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>ジョブ ID: {displayJob.job_id}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* プログレスバー */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>生成進捗</span>
              <span>
                {progress.generated_count} / {progress.target_count} ({progressPercent}%)
              </span>
            </div>
            <Progress value={progressPercent} />
          </div>

          {/* 内訳 (テンプレートジョブのみ: 評価あり) */}
          {templateId && (
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{progress.evaluated_count}</div>
                <div className="text-xs text-muted-foreground">評価済み</div>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {progress.passed_count}
                </div>
                <div className="text-xs text-muted-foreground">合格</div>
              </div>
              <div className="text-center p-3 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">
                  {progress.failed_count}
                </div>
                <div className="text-xs text-muted-foreground">不合格</div>
              </div>
            </div>
          )}

          {/* 開始時刻 */}
          {displayJob.started_at && (
            <div className="text-sm text-muted-foreground">
              開始: {new Date(displayJob.started_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* アクションボタン */}
      <div className="flex gap-3 flex-wrap">
        {/* Weave ダッシュボード */}
        {displayJob.weave_dashboard_url && (
          <a
            href={`${displayJob.weave_dashboard_url}${displayJob.weave_dashboard_url.includes('?') ? '&' : '?'}view=traces_default`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline">Weave ダッシュボードを開く</Button>
          </a>
        )}

        {/* Weave データセット */}
        {datasetUrl && (
          <a
            href={datasetUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline">Weave データセットを見る</Button>
          </a>
        )}

        {/* キャンセル (running のみ, ライブ接続時のみ) */}
        {!isFallback && (displayJob.status === "running" || displayJob.status === "pending") && (
          <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive">ジョブをキャンセル</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>ジョブをキャンセルしますか？</DialogTitle>
                <DialogDescription>
                  実行中のデータ生成を中断します。この操作は取り消せません。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCancelDialogOpen(false)}
                >
                  戻る
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleCancel}
                  disabled={cancelling}
                >
                  {cancelling ? "キャンセル中..." : "キャンセルする"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* JSONL ダウンロード (completed かつ生成データあり) */}
        {displayJob.status === "completed" && progress.generated_count > 0 && (
          <Button onClick={handleDownload}>JSONL 形式でダウンロード</Button>
        )}
      </div>

      {/* プロンプト最適化ボタン (completed かつ failed_count >= 1 かつ template_id あり) */}
      {displayJob.status === "completed" &&
        progress.failed_count >= 1 &&
        templateId && (
          <Card>
            <CardContent className="py-5">
              <p className="text-sm text-muted-foreground mb-3">
                不合格データが {progress.failed_count} 件あります。AIによるプロンプト改善を試してみましょう。
              </p>
              <div className="flex gap-3 flex-wrap">
                <Button
                  variant="outline"
                  onClick={() => setOptimizeOpen(true)}
                >
                  <Sparkles className="size-4 mr-2" />
                  AIに自動でプロンプトを修正させる
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setChatOpen(true)}
                >
                  <MessageSquare className="size-4 mr-2" />
                  AIとチャットで改善点を相談する
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

      {/* 続けて生成 (増幅ジョブ完了時, 設定が残っている場合) */}
      {displayJob.status === "completed" && augmentConfig && (
        <Card>
          <CardContent className="py-5">
            <p className="text-sm text-muted-foreground mb-3">
              同じ条件で追加のデータを生成できます。
            </p>
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="continue-num" className="text-xs">生成件数</Label>
                <Input
                  id="continue-num"
                  type="number"
                  min={1}
                  max={1000}
                  value={continueNumSamples}
                  onChange={(e) => setContinueNumSamples(Number(e.target.value))}
                  className="w-32"
                />
              </div>
              <Button
                onClick={handleContinueAugment}
                disabled={continueSubmitting}
              >
                <Play className="size-4 mr-2" />
                {continueSubmitting ? "開始中..." : "続けて生成"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 結果プレビュー (completed かつ生成データあり) */}
      {displayJob.status === "completed" && progress.generated_count > 0 && datasetName && projectName && (
        <ResultPreview
          datasetName={datasetName}
          projectName={projectName}
          mode={templateId ? "template" : "augment"}
        />
      )}

      {/* Optimize / Chat / TemplateCreate Dialogs */}
      {templateId && (
        <>
          <OptimizeDialog
            open={optimizeOpen}
            onOpenChange={setOptimizeOpen}
            templateId={templateId}
            jobId={job_id}
            onApply={handleOptimizeApply}
          />
          <ChatOptimizeDialog
            open={chatOpen}
            onOpenChange={setChatOpen}
            templateId={templateId}
            jobId={job_id}
            onFinalize={handleChatFinalize}
          />
        </>
      )}
      <TemplateCreateSheet
        open={templateSheetOpen}
        onOpenChange={setTemplateSheetOpen}
        prefillInstruction={prefillInstruction ?? undefined}
        prefillSchema={prefillSchema}
        onCreated={handleTemplateCreated}
      />
      <JobCreateSheet
        open={jobSheetOpen}
        onOpenChange={setJobSheetOpen}
        templateId={newTemplateId}
        onCreated={handleJobCreated}
      />
    </div>
  );
}

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ job_id: string }>;
}) {
  const { job_id } = use(params);
  return (
    <Suspense
      fallback={
        <div className="py-12 text-center">
          <p className="text-muted-foreground">読み込み中...</p>
        </div>
      }
    >
      <JobDetailContent job_id={job_id} />
    </Suspense>
  );
}
