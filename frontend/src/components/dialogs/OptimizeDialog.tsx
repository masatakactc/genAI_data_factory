"use client";

import { useState } from "react";
import { Loader2, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import type { OptimizeResponse } from "@/types/api";

interface OptimizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  jobId: string;
  onApply: (optimizedInstruction: string) => void;
}

export default function OptimizeDialog({
  open,
  onOpenChange,
  templateId,
  jobId,
  onApply,
}: OptimizeDialogProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOptimize = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient(
        `/templates/${encodeURIComponent(templateId)}/optimize`,
        {
          method: "POST",
          body: JSON.stringify({ job_id: jobId }),
        }
      );
      const data: OptimizeResponse = await res.json();
      setResult(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "最適化に失敗しました。";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (result) {
      onApply(result.optimized_system_instruction);
      onOpenChange(false);
      setResult(null);
    }
  };

  const handleClose = (value: boolean) => {
    if (!loading) {
      onOpenChange(value);
      if (!value) {
        setResult(null);
        setError(null);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold text-primary">
            <Sparkles className="size-5" />
            AI 自動最適化
          </DialogTitle>
          <DialogDescription>
            AIがエラー傾向を分析し、改善されたプロンプトを提案します。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!result && !loading && !error && (
            <div className="text-center py-8 space-y-4">
              <p className="text-sm text-muted-foreground">
                AIが失敗したデータのパターンを分析し、プロンプトを自動的に改善します。
              </p>
              <Button onClick={handleOptimize} size="lg">
                <Sparkles className="size-4 mr-2" />
                分析を開始
              </Button>
            </div>
          )}

          {loading && (
            <div className="text-center py-12 space-y-3">
              <Loader2 className="size-8 animate-spin mx-auto text-primary" />
              <p className="text-sm text-muted-foreground">
                AIが分析中...
              </p>
            </div>
          )}

          {error && (
            <div className="text-center py-8 space-y-4">
              <p className="text-sm text-destructive">{error}</p>
              <Button onClick={handleOptimize} variant="outline">
                再試行
              </Button>
            </div>
          )}

          {result && (
            <div className="space-y-5">
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  分析レポート
                </h3>
                <div className="bg-muted p-4 rounded-lg text-sm whitespace-pre-wrap">
                  {result.analysis_report}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  改善されたプロンプト
                </h3>
                <div className="bg-muted p-4 rounded-lg text-sm font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {result.optimized_system_instruction}
                </div>
              </section>
            </div>
          )}
        </div>

        {result && (
          <DialogFooter className="px-6 py-4 border-t border-border">
            <Button variant="outline" onClick={() => handleClose(false)}>
              閉じる
            </Button>
            <Button onClick={handleApply}>
              <ArrowRight className="size-4 mr-2" />
              この内容でテンプレートを作成
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
