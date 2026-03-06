"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { apiClient } from "@/lib/api";
import TemplateCreateSheet from "@/components/sheets/TemplateCreateSheet";
import JobCreateSheet from "@/components/sheets/JobCreateSheet";
import type { TemplateResponse } from "@/types/api";

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateResponse[]>([]);

  // Sheet state
  const [templateSheetOpen, setTemplateSheetOpen] = useState(false);
  const [jobSheetOpen, setJobSheetOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null
  );

  const loadTemplates = async () => {
    try {
      const res = await apiClient("/templates");
      const data: TemplateResponse[] = await res.json();
      setTemplates(data);
    } catch {
      // API失敗時は空のまま
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const handleTemplateCreated = (templateId: string) => {
    loadTemplates();
    // テンプレート作成後、ジョブ作成Sheetを開く
    setTimeout(() => {
      setSelectedTemplateId(templateId);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">テンプレート</h1>
        <Button onClick={() => setTemplateSheetOpen(true)}>
          <Plus className="size-4 mr-2" />
          新規作成
        </Button>
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">
              テンプレートがありません。
            </p>
            <Button
              variant="outline"
              onClick={() => setTemplateSheetOpen(true)}
            >
              テンプレートを作成する
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {templates.map((t) => (
            <Card key={t.template_id}>
              <CardHeader>
                <CardTitle>{t.name}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* 設定サマリー */}
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {t.generation_config.model}
                  </Badge>
                  <Badge variant="outline">
                    Temperature: {t.generation_config.temperature}
                  </Badge>
                  <Badge variant="secondary">
                    評価: {t.evaluation_config.judge_model}
                  </Badge>
                  <Badge variant="secondary">
                    合格点: {t.evaluation_config.min_passing_score}
                  </Badge>
                </div>

                {/* プロンプトプレビュー */}
                <div className="bg-muted p-3 rounded-md text-xs font-mono text-muted-foreground whitespace-pre-wrap line-clamp-3">
                  {t.generation_config.system_instruction}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {new Date(t.created_at).toLocaleString("ja-JP")}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => {
                      setSelectedTemplateId(t.template_id);
                      setJobSheetOpen(true);
                    }}
                  >
                    ジョブを作成
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Sheets */}
      <TemplateCreateSheet
        open={templateSheetOpen}
        onOpenChange={setTemplateSheetOpen}
        onCreated={handleTemplateCreated}
      />
      <JobCreateSheet
        open={jobSheetOpen}
        onOpenChange={setJobSheetOpen}
        templateId={selectedTemplateId}
        onCreated={handleJobCreated}
      />
    </div>
  );
}
