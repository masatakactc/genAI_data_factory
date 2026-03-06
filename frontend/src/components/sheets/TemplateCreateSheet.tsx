"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { addTemplateHistory, cacheTemplate } from "@/lib/history";
import JsonSchemaEditor, {
  DEFAULT_SCHEMA,
} from "@/components/forms/JsonSchemaEditor";

const GENERATION_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
];

const JUDGE_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
];

interface TemplateCreateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (templateId: string, templateName: string) => void;
  prefillInstruction?: string;
  prefillSchema?: Record<string, unknown>;
}

export default function TemplateCreateSheet({
  open,
  onOpenChange,
  onCreated,
  prefillInstruction,
  prefillSchema,
}: TemplateCreateSheetProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("カスタマーサポート対話データ");
  const [description, setDescription] = useState(
    "多様なトーンでのCS対応データ生成用"
  );
  const [model, setModel] = useState("gemini-2.5-flash");
  const [systemInstruction, setSystemInstruction] = useState(
    "あなたはサポート担当者です。{{issue}}に関する問い合わせに対し、{{tone}}なトーンで回答を作成してください。"
  );
  const [temperature, setTemperature] = useState(0.7);
  const [responseSchema, setResponseSchema] = useState(DEFAULT_SCHEMA);
  const [judgeModel, setJudgeModel] = useState("gemini-2.5-pro");
  const [criteria, setCriteria] = useState(
    "1〜5点で評価してください。1:指定のトーンが守られていない。5:非常に自然で技術的にも正確な回答。"
  );
  const [minPassingScore, setMinPassingScore] = useState(4);

  // Apply prefill values from optimize/chat when dialog opens
  useEffect(() => {
    if (open && prefillInstruction) {
      setSystemInstruction(prefillInstruction);
      setName("");
      setDescription("AI最適化により生成されたテンプレート");
    }
    if (open && prefillSchema) {
      setResponseSchema(JSON.stringify(prefillSchema, null, 2));
    }
  }, [open, prefillInstruction, prefillSchema]);

  const handleSubmit = async () => {
    let parsedSchema;
    try {
      parsedSchema = JSON.parse(responseSchema);
      if (parsedSchema.type !== "OBJECT") {
        toast.error(
          'JSON Schemaのルートは type: "OBJECT" にしてください。'
        );
        return;
      }
    } catch {
      toast.error(
        "JSON Schemaの形式が不正です。正しいJSONを入力してください。"
      );
      return;
    }

    setLoading(true);
    try {
      const res = await apiClient("/templates", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          generation_config: {
            model,
            system_instruction: systemInstruction,
            temperature,
            response_mime_type: "application/json",
            response_schema: parsedSchema,
          },
          evaluation_config: {
            judge_model: judgeModel,
            criteria,
            min_passing_score: minPassingScore,
          },
        }),
      });
      const data = await res.json();
      addTemplateHistory({
        template_id: data.template_id,
        name: name.trim(),
        description: description.trim(),
        created_at: data.created_at ?? new Date().toISOString(),
      });
      // テンプレートのフルデータをローカルキャッシュ (バックエンド消失時のフォールバック)
      cacheTemplate(data.template_id, {
        template_id: data.template_id,
        name: name.trim(),
        description: description.trim(),
        generation_config: {
          model,
          system_instruction: systemInstruction,
          temperature,
          response_mime_type: "application/json",
          response_schema: parsedSchema,
        },
        evaluation_config: {
          judge_model: judgeModel,
          criteria,
          min_passing_score: minPassingScore,
        },
        created_at: data.created_at ?? new Date().toISOString(),
      });
      toast.success("テンプレートを作成しました。");
      onOpenChange(false);
      onCreated?.(data.template_id, name.trim());
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "テンプレートの作成に失敗しました。";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl lg:max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0"
      >
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
          <DialogTitle className="text-xl font-bold text-primary">
            テンプレート作成
          </DialogTitle>
          <DialogDescription className="sr-only">
            データ生成テンプレートの作成
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-6 bg-card">
          <div className="space-y-6">
            {/* 基本情報 */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                基本情報
              </h3>
              <div className="space-y-2">
                <Label htmlFor="sheet-name">テンプレート名</Label>
                <Input
                  id="sheet-name"
                  placeholder="例: カスタマーサポート対話データ"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sheet-description">説明</Label>
                <Input
                  id="sheet-description"
                  placeholder="例: 多様なトーンでのCS対応データ生成用"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </section>

            <Separator />

            {/* 生成設定 */}
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  生成設定
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  AIモデル、プロンプト、出力スキーマを設定します。
                </p>
              </div>

              <div className="space-y-2">
                <Label>生成モデル</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GENERATION_MODELS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sheet-prompt">
                  プロンプト (System Instruction)
                </Label>
                <p className="text-xs text-muted-foreground">
                  動的に変えたい部分は{" "}
                  <code className="bg-muted px-1 rounded">{"{{変数名}}"}</code>{" "}
                  で囲んでください。
                </p>
                <Textarea
                  id="sheet-prompt"
                  rows={5}
                  placeholder="例: あなたはサポート担当者です。{{issue}}に関する問い合わせに対し、{{tone}}なトーンで回答を作成してください。"
                  value={systemInstruction}
                  onChange={(e) => setSystemInstruction(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Temperature: {temperature.toFixed(1)}</Label>
                <Slider
                  min={0}
                  max={2}
                  step={0.1}
                  value={[temperature]}
                  onValueChange={([v]) => setTemperature(v)}
                />
              </div>

              <div className="space-y-2">
                <Label>JSON Schema (1件分のデータ構造)</Label>
                <p className="text-xs text-muted-foreground">
                  ルートは必ず{" "}
                  <code className="bg-muted px-1 rounded">
                    type: &quot;OBJECT&quot;
                  </code>{" "}
                  にしてください。
                </p>
                <JsonSchemaEditor
                  value={responseSchema}
                  onChange={setResponseSchema}
                />
              </div>
            </section>

            <Separator />

            {/* 評価設定 */}
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  評価設定
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  LLM-as-a-Judge による品質評価の基準を設定します。
                </p>
              </div>

              <div className="space-y-2">
                <Label>評価モデル</Label>
                <Select value={judgeModel} onValueChange={setJudgeModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {JUDGE_MODELS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sheet-criteria">評価基準</Label>
                <p className="text-xs text-muted-foreground">
                  1〜5点で評価する際の採点基準を具体的に記載してください。
                </p>
                <Textarea
                  id="sheet-criteria"
                  rows={4}
                  placeholder="例: 1〜5点で評価してください。1:指定のトーンが守られていない。5:非常に自然で技術的にも正確な回答。"
                  value={criteria}
                  onChange={(e) => setCriteria(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>合格スコア (最低点): {minPassingScore}</Label>
                <Slider
                  min={1}
                  max={5}
                  step={1}
                  value={[minPassingScore]}
                  onValueChange={([v]) => setMinPassingScore(v)}
                />
                <p className="text-xs text-muted-foreground">
                  このスコア以上のデータのみが Weave に保存されます。
                </p>
              </div>
            </section>

            <Button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full"
              size="lg"
            >
              {loading ? "作成中..." : "テンプレートを作成"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
