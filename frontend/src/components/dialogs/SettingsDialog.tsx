"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsDialog({
  open,
  onOpenChange,
}: SettingsDialogProps) {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      const stored = localStorage.getItem("wandb_api_key");
      if (stored) {
        setApiKey(stored);
        setSaved(true);
      } else {
        setApiKey("");
        setSaved(false);
      }
    }
  }, [open]);

  const handleSave = () => {
    if (!apiKey.trim()) {
      toast.error("API Key を入力してください。");
      return;
    }
    localStorage.setItem("wandb_api_key", apiKey.trim());
    setSaved(true);
    toast.success("W&B API Key を保存しました。");
  };

  const handleRemove = () => {
    localStorage.removeItem("wandb_api_key");
    setApiKey("");
    setSaved(false);
    toast.success("W&B API Key を削除しました。");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-primary">
            W&B API Key 設定
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="settings-api-key">API Key</Label>
            <Input
              id="settings-api-key"
              type="password"
              placeholder="W&B API Key を入力..."
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <a
            href="https://wandb.ai/authorize"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline block"
          >
            W&B で API Key を取得する
          </a>
          <div className="flex gap-2">
            <Button onClick={handleSave} className="flex-1">
              {saved ? "保存済み" : "保存"}
            </Button>
            {saved && (
              <Button variant="outline" onClick={handleRemove}>
                削除
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
