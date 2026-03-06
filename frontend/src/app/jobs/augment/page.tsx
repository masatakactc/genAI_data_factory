"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";

interface SeedRow {
  [key: string]: string;
}

export default function AugmentPage() {
  const router = useRouter();

  const [seedData, setSeedData] = useState<SeedRow[]>([
    { user_query: "", agent_response: "" },
  ]);
  const [schemaKeys, setSchemaKeys] = useState<string[]>([
    "user_query",
    "agent_response",
  ]);
  const [newKey, setNewKey] = useState("");
  const [instruction, setInstruction] = useState("");
  const [numSamples, setNumSamples] = useState(50);
  const [projectName, setProjectName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");

  const addSchemaKey = () => {
    const key = newKey.trim();
    if (!key) return;
    if (schemaKeys.includes(key)) {
      toast.error("同じキーが既に存在します。");
      return;
    }
    setSchemaKeys([...schemaKeys, key]);
    setSeedData(seedData.map((row) => ({ ...row, [key]: "" })));
    setNewKey("");
  };

  const removeSchemaKey = (key: string) => {
    if (schemaKeys.length <= 1) {
      toast.error("最低1つのキーが必要です。");
      return;
    }
    setSchemaKeys(schemaKeys.filter((k) => k !== key));
    setSeedData(
      seedData.map((row) => {
        const newRow = { ...row };
        delete newRow[key];
        return newRow;
      })
    );
  };

  const addSeedRow = () => {
    const emptyRow: SeedRow = {};
    schemaKeys.forEach((key) => (emptyRow[key] = ""));
    setSeedData([...seedData, emptyRow]);
  };

  const removeSeedRow = (idx: number) => {
    if (seedData.length <= 1) {
      toast.error("最低1件のシードデータが必要です。");
      return;
    }
    setSeedData(seedData.filter((_, i) => i !== idx));
  };

  const updateSeedCell = (rowIdx: number, key: string, value: string) => {
    const updated = [...seedData];
    updated[rowIdx] = { ...updated[rowIdx], [key]: value };
    setSeedData(updated);
  };

  const getSeedDataForSubmit = (): SeedRow[] | null => {
    if (jsonMode) {
      try {
        const parsed = JSON.parse(jsonText);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          toast.error("JSON配列を入力してください（1件以上）。");
          return null;
        }
        return parsed;
      } catch {
        toast.error("JSONの形式が不正です。");
        return null;
      }
    }
    const nonEmpty = seedData.filter((row) =>
      Object.values(row).some((v) => v.trim() !== "")
    );
    if (nonEmpty.length === 0) {
      toast.error("シードデータを1件以上入力してください。");
      return null;
    }
    return nonEmpty;
  };

  const handleSubmit = async () => {
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

    if (!instruction.trim()) {
      toast.error("アレンジ指示を入力してください。");
      return;
    }

    const data = getSeedDataForSubmit();
    if (!data) return;

    const keys = jsonMode
      ? Object.keys(data[0])
      : schemaKeys;

    setSubmitting(true);
    try {
      const res = await apiClient("/jobs/augment", {
        method: "POST",
        body: JSON.stringify({
          seed_data: data,
          schema_keys: keys,
          augmentation_instruction: instruction.trim(),
          num_samples: numSamples,
          project_name: projectName.trim(),
        }),
      });
      const result = await res.json();

      // sessionStorage に設定を保存（続けて生成用）
      try {
        sessionStorage.setItem(
          `augment_config_${result.job_id}`,
          JSON.stringify({
            seed_data: data,
            schema_keys: keys,
            augmentation_instruction: instruction.trim(),
            project_name: projectName.trim(),
          })
        );
      } catch {
        // sessionStorage が使えなくても続行
      }

      toast.success("データ増幅ジョブを開始しました。");

      const params = new URLSearchParams();
      if (result.target_dataset_name)
        params.set("dataset", result.target_dataset_name);
      if (result.weave_dataset_url)
        params.set("dataset_url", result.weave_dataset_url);
      params.set("project", projectName.trim());
      router.push(`/jobs/${result.job_id}?${params.toString()}`);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "データ増幅ジョブの開始に失敗しました。";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">データ増幅</h1>
        <p className="text-sm text-muted-foreground mt-1">
          少数の正解データ（シード）をもとに、AIがバリエーションデータを大量に生成します。
        </p>
      </div>

      {/* Schema Keys */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">スキーマキー</CardTitle>
          <CardDescription>
            データに含まれるキー名を定義します。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {schemaKeys.map((key) => (
              <Badge
                key={key}
                variant="secondary"
                className="gap-1 cursor-pointer"
                onClick={() => removeSchemaKey(key)}
              >
                {key}
                <Trash2 className="size-3" />
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="新しいキー名"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSchemaKey();
                }
              }}
            />
            <Button variant="outline" onClick={addSchemaKey} size="sm">
              <Plus className="size-4 mr-1" />
              追加
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Seed Data */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">シードデータ</CardTitle>
              <CardDescription>
                増幅のベースとなる正解データを入力します。
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!jsonMode) {
                  setJsonText(JSON.stringify(seedData, null, 2));
                }
                setJsonMode(!jsonMode);
              }}
            >
              {jsonMode ? "テーブル入力" : "JSON入力"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {jsonMode ? (
            <Textarea
              rows={12}
              className="font-mono text-sm"
              placeholder='[{"user_query": "...", "agent_response": "..."}]'
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
          ) : (
            <div className="space-y-4">
              {seedData.map((row, rowIdx) => (
                <div
                  key={rowIdx}
                  className="border rounded-lg p-4 space-y-3 relative"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      #{rowIdx + 1}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => removeSeedRow(rowIdx)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  {schemaKeys.map((key) => (
                    <div key={key} className="space-y-1">
                      <Label className="text-xs">{key}</Label>
                      <Textarea
                        rows={2}
                        placeholder={`${key} の値を入力`}
                        value={row[key] ?? ""}
                        onChange={(e) =>
                          updateSeedCell(rowIdx, key, e.target.value)
                        }
                      />
                    </div>
                  ))}
                </div>
              ))}
              <Button
                variant="outline"
                onClick={addSeedRow}
                className="w-full"
              >
                <Plus className="size-4 mr-2" />
                シードデータを追加
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Augmentation Instruction */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">アレンジ指示</CardTitle>
          <CardDescription>
            何をどう変えて増幅するかを自然言語で指示してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={4}
            placeholder="例: 入力データ内の『人名』を別のランダムな名前に変更し、『トラブル内容』も別の状況にアレンジしてください。"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </CardContent>
      </Card>

      {/* Execution Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">実行設定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="aug-num-samples">生成件数 (1〜1000)</Label>
            <Input
              id="aug-num-samples"
              type="number"
              min={1}
              max={1000}
              value={numSamples}
              onChange={(e) => setNumSamples(Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="aug-project-name">W&B プロジェクト名</Label>
            <Input
              id="aug-project-name"
              placeholder="例: augmented-cs-data"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              半角英数字とハイフンのみの使用を推奨します。
            </p>
          </div>
        </CardContent>
      </Card>

      <Separator />

      <Button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full"
        size="lg"
      >
        {submitting ? (
          "ジョブ開始中..."
        ) : (
          <>
            <Play className="size-4 mr-2" />
            データ増幅ジョブを開始
          </>
        )}
      </Button>
    </div>
  );
}
