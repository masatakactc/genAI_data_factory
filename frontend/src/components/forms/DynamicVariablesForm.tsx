"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DynamicVariablesFormProps {
  systemInstruction: string;
  variables: Record<string, string>;
  onChange: (variables: Record<string, string>) => void;
}

export function extractVariables(systemInstruction: string): string[] {
  const matches = systemInstruction.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, "").trim()))];
}

export default function DynamicVariablesForm({
  systemInstruction,
  variables,
  onChange,
}: DynamicVariablesFormProps) {
  const variableNames = extractVariables(systemInstruction);

  if (variableNames.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        プロンプトに動的変数（{"{{変数名}}"}）が含まれていません。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {variableNames.map((name) => (
        <div key={name} className="space-y-1">
          <Label htmlFor={`var-${name}`}>
            <code className="bg-muted px-1 rounded text-sm">{`{{${name}}}`}</code>
          </Label>
          <Input
            id={`var-${name}`}
            placeholder={`${name} の値を入力...`}
            value={variables[name] ?? ""}
            onChange={(e) =>
              onChange({ ...variables, [name]: e.target.value })
            }
          />
        </div>
      ))}
    </div>
  );
}
