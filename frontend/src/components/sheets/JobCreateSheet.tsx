"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api";
import { addJobHistory, cacheTemplate, getCachedTemplate } from "@/lib/history";
import DynamicVariablesForm from "@/components/forms/DynamicVariablesForm";
import type { TemplateResponse } from "@/types/api";

export interface RerunConfig {
  groupId: string;
  numSamples: number;
  projectName: string;
  variables: Record<string, string>;
}

interface JobCreateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string | null;
  rerunConfig?: RerunConfig;
  onCreated?: (
    jobId: string,
    meta: {
      datasetName: string;
      datasetUrl?: string;
      projectName: string;
      templateId: string;
    }
  ) => void;
}

export default function JobCreateSheet({
  open,
  onOpenChange,
  templateId,
  rerunConfig,
  onCreated,
}: JobCreateSheetProps) {
  const isRerun = !!rerunConfig;

  const [template, setTemplate] = useState<TemplateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [numSamples, setNumSamples] = useState(
    rerunConfig?.numSamples ?? 50
  );
  const [projectName, setProjectName] = useState(
    rerunConfig?.projectName ?? ""
  );
  const [variables, setVariables] = useState<Record<string, string>>(
    rerunConfig?.variables ?? {}
  );

  // Reset state when dialog opens with new props
  useEffect(() => {
    if (open && templateId) {
      setNumSamples(rerunConfig?.numSamples ?? 50);
      setProjectName(rerunConfig?.projectName ?? "");
      setVariables(rerunConfig?.variables ?? {});
      setTemplate(null);
      setLoading(true);

      apiClient(`/templates/${templateId}`)
        .then((res) => res.json())
        .then((data) => {
          cacheTemplate(templateId, data);
          setTemplate(data);
        })
        .catch(() => {
          // API 404 → ローカルキャッシュにフォールバック
          const cached = getCachedTemplate(templateId);
          if (cached) {
            setTemplate(cached);
          } else {
            toast.error("テンプレートの取得に失敗しました。");
          }
        })
        .finally(() => setLoading(false));
    }
  }, [open, templateId, rerunConfig]);

  const handleSubmit = async () => {
    if (!templateId) return;

    if (!projectName.trim()) {
      toast.error("W&B プロジェクト名を入力してください。");
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(projectName.trim())) {
      toast.error(
        "プロジェクト名は半角英数字・ハイフン・アンダースコアのみ使用してください。"
      );
      return;
    }

    if (numSamples < 1 || numSamples > 1000) {
      toast.error("生成件数は 1〜1000 の範囲で入力してください。");
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiClient("/jobs/generate", {
        method: "POST",
        body: JSON.stringify({
          template_id: templateId,
          num_samples: numSamples,
          variables,
          project_name: projectName.trim(),
        }),
      });
      const data = await res.json();

      const groupId = rerunConfig?.groupId ?? crypto.randomUUID();

      addJobHistory({
        job_id: data.job_id,
        group_id: groupId,
        template_id: templateId,
        template_name: template?.name ?? "",
        project_name: projectName.trim(),
        num_samples: numSamples,
        variables,
        target_dataset_name: data.target_dataset_name,
        weave_dataset_url: data.weave_dataset_url,
        status: data.status ?? "pending",
        created_at: new Date().toISOString(),
      });

      toast.success("ジョブを開始しました。");
      onOpenChange(false);
      onCreated?.(data.job_id, {
        datasetName: data.target_dataset_name,
        datasetUrl: data.weave_dataset_url,
        projectName: projectName.trim(),
        templateId,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        toast.error(
          "バックエンドが再起動されたためテンプレートが消失しています。同じ設定で新規テンプレートを作成してから再実行してください。"
        );
      } else {
        const message =
          err instanceof Error ? err.message : "ジョブの開始に失敗しました。";
        toast.error(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg max-h-[85vh] flex flex-col gap-0 p-0"
      >
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-xl font-bold text-primary">
              {isRerun ? "ジョブ再実行" : "ジョブ実行設定"}
            </DialogTitle>
            {isRerun && <Badge variant="secondary">再実行</Badge>}
          </div>
          <DialogDescription className="sr-only">
            データ生成ジョブの実行設定
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-6 bg-card">
          <div className="space-y-6">
            {loading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                テンプレートを読み込み中...
              </p>
            ) : !template ? (
              <p className="text-sm text-destructive py-8 text-center">
                テンプレートが見つかりませんでした。
              </p>
            ) : (
              <>
                {/* テンプレート情報 */}
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    テンプレート
                  </h3>
                  <div>
                    <p className="font-medium">{template.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {template.description}
                    </p>
                  </div>
                  <div className="bg-muted p-3 rounded-md text-sm font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {template.generation_config.system_instruction}
                  </div>
                </section>

                <Separator />

                {/* 変数設定 */}
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    変数設定
                  </h3>
                  {isRerun ? (
                    <div className="space-y-2">
                      {Object.entries(variables).map(([key, value]) => (
                        <div key={key} className="space-y-1">
                          <Label>
                            <code className="bg-muted px-1 rounded">{`{{${key}}}`}</code>
                          </Label>
                          <div className="bg-muted p-2 rounded-md text-sm">
                            {value}
                          </div>
                        </div>
                      ))}
                      {Object.keys(variables).length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          変数はありません。
                        </p>
                      )}
                    </div>
                  ) : (
                    <DynamicVariablesForm
                      systemInstruction={
                        template.generation_config.system_instruction
                      }
                      variables={variables}
                      onChange={setVariables}
                    />
                  )}
                </section>

                <Separator />

                {/* 実行設定 */}
                <section className="space-y-4">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    実行設定
                  </h3>
                  <div className="space-y-2">
                    <Label htmlFor="sheet-num-samples">
                      生成件数 (1〜1000)
                    </Label>
                    <Input
                      id="sheet-num-samples"
                      type="number"
                      min={1}
                      max={1000}
                      value={numSamples}
                      onChange={(e) => setNumSamples(Number(e.target.value))}
                      disabled={isRerun}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sheet-project-name">
                      W&B プロジェクト名
                    </Label>
                    <Input
                      id="sheet-project-name"
                      placeholder="例: cs-training-data"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      disabled={isRerun}
                    />
                    <p className="text-xs text-muted-foreground">
                      {isRerun
                        ? "再実行のため前回と同じ設定で実行します。"
                        : "半角英数字とハイフンのみの使用を推奨します。"}
                    </p>
                  </div>
                </section>

                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full"
                  size="lg"
                >
                  {submitting
                    ? "ジョブ開始中..."
                    : isRerun
                      ? "同じ設定で再実行"
                      : "データ生成ジョブを開始"}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
