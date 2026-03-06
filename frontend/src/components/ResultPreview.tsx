"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { apiClient, ApiError } from "@/lib/api";
import type { DatasetExportRow } from "@/types/api";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

interface ResultPreviewProps {
  datasetName: string;
  projectName: string;
  /** "template" = スコア・評価理由あり, "augment" = 動的カラム（評価なし） */
  mode?: "template" | "augment";
}

export default function ResultPreview({
  datasetName,
  projectName,
  mode = "template",
}: ResultPreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [retryCount, setRetryCount] = useState(0);
  const abortRef = useRef(false);

  useEffect(() => {
    abortRef.current = false;

    const fetchWithRetry = async (attempt: number) => {
      if (abortRef.current) return;

      try {
        const res = await apiClient(
          `/datasets/${encodeURIComponent(datasetName)}/export?project_name=${encodeURIComponent(projectName)}&format=jsonl`
        );
        const text = await res.text();
        const lines = text.split("\n").filter((line) => line.trim() !== "");
        const parsed = lines
          .slice(0, 5)
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        if (!abortRef.current) {
          setRows(parsed);
          setLoading(false);
        }
      } catch (err) {
        if (abortRef.current) return;
        const is404 = err instanceof ApiError && err.status === 404;
        if (is404 && attempt < MAX_RETRIES) {
          setRetryCount(attempt + 1);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          return fetchWithRetry(attempt + 1);
        }
        setError(
          is404
            ? "データセットがまだ保存されていません。しばらく待ってからページを再読み込みしてください。"
            : err instanceof Error
              ? err.message
              : "結果の取得に失敗しました。"
        );
        setLoading(false);
      }
    };

    fetchWithRetry(0);
    return () => { abortRef.current = true; };
  }, [datasetName, projectName]);

  // augment モード: データから動的にカラム名を抽出 (_で始まる内部キーは除外)
  const augmentColumns = useMemo(() => {
    if (mode !== "augment" || rows.length === 0) return [];
    const keySet = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!key.startsWith("_")) keySet.add(key);
      }
    }
    return Array.from(keySet);
  }, [mode, rows]);

  const getScoreBadgeVariant = (
    score: number
  ): "default" | "secondary" | "destructive" => {
    if (score >= 4) return "default";
    if (score >= 3) return "secondary";
    return "destructive";
  };

  const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "string") {
      return value.length > 200 ? value.slice(0, 200) + "..." : value;
    }
    if (typeof value === "object") {
      const json = JSON.stringify(value, null, 0);
      return json.length > 200 ? json.slice(0, 200) + "..." : json;
    }
    return String(value);
  };

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">生成結果プレビュー</h2>

      {loading && (
        <div className="text-muted-foreground text-center py-4 space-y-2">
          <Loader2 className="size-5 animate-spin mx-auto" />
          <p>
            {retryCount > 0
              ? `データセットの保存を待機中... (${retryCount}/${MAX_RETRIES})`
              : "結果を読み込み中..."}
          </p>
        </div>
      )}
      {error && (
        <p className="text-destructive text-center py-4">
          プレビューの取得に失敗しました: {error}
        </p>
      )}
      {!loading && !error && rows.length === 0 && (
        <p className="text-muted-foreground text-center py-4">
          データがありません。Weave にデータセットが保存されていない可能性があります。
        </p>
      )}
      {rows.length > 0 && (
        <>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              {mode === "template" ? (
                <>
                  <TableHeader>
                    <TableRow className="bg-primary hover:bg-primary border-b-0">
                      <TableHead className="w-10 text-primary-foreground">#</TableHead>
                      <TableHead className="min-w-[180px] text-primary-foreground">ユーザーの質問</TableHead>
                      <TableHead className="min-w-[250px] text-primary-foreground">AIの回答</TableHead>
                      <TableHead className="w-20 text-center text-primary-foreground">スコア</TableHead>
                      <TableHead className="min-w-[180px] text-primary-foreground">評価理由</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(rows as DatasetExportRow[]).map((row, idx) => (
                      <TableRow key={idx} className="bg-card hover:bg-card">
                        <TableCell className="font-medium text-muted-foreground align-top">
                          {idx + 1}
                        </TableCell>
                        <TableCell className="text-sm align-top">
                          {row.user_query}
                        </TableCell>
                        <TableCell className="text-sm align-top whitespace-pre-wrap break-words">
                          {row.agent_response.length > 200
                            ? row.agent_response.slice(0, 200) + "..."
                            : row.agent_response}
                        </TableCell>
                        <TableCell className="text-center align-top">
                          {row._evaluation && (
                            <Badge variant={getScoreBadgeVariant(row._evaluation.score)}>
                              {row._evaluation.score}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground align-top">
                          {row._evaluation?.reason ?? "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </>
              ) : (
                <>
                  <TableHeader>
                    <TableRow className="bg-primary hover:bg-primary border-b-0">
                      <TableHead className="w-10 text-primary-foreground">#</TableHead>
                      {augmentColumns.map((col) => (
                        <TableHead key={col} className="min-w-[150px] text-primary-foreground">
                          {col}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, idx) => (
                      <TableRow key={idx} className="bg-card hover:bg-card">
                        <TableCell className="font-medium text-muted-foreground align-top">
                          {idx + 1}
                        </TableCell>
                        {augmentColumns.map((col) => (
                          <TableCell key={col} className="text-sm align-top whitespace-pre-wrap break-words">
                            {formatCellValue(row[col])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </>
              )}
            </Table>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            最初の {rows.length} 件を表示しています。全件は JSONL
            ダウンロードで確認できます。
          </p>
        </>
      )}
    </div>
  );
}
