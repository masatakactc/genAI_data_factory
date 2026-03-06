"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2, Send, CheckCircle, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import type { ChatMessage, ChatFinalizeResponse } from "@/types/api";

interface ChatOptimizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  jobId: string;
  onFinalize: (
    optimizedInstruction: string,
    optimizedSchema?: Record<string, unknown>
  ) => void;
}

export default function ChatOptimizeDialog({
  open,
  onOpenChange,
  templateId,
  jobId,
  onFinalize,
}: ChatOptimizeDialogProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMessage: ChatMessage = { role: "user", content: text };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setSending(true);

    try {
      const res = await apiClient(
        `/templates/${encodeURIComponent(templateId)}/chat`,
        {
          method: "POST",
          body: JSON.stringify({
            messages: updatedMessages,
            job_id: jobId,
          }),
        }
      );
      const data = await res.json();
      setMessages([
        ...updatedMessages,
        { role: "model", content: data.reply },
      ]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "送信に失敗しました。";
      toast.error(message);
      // Remove the user message on error
      setMessages(messages);
    } finally {
      setSending(false);
    }
  };

  const handleFinalize = async () => {
    if (messages.length === 0) {
      toast.error("まずAIと会話してください。");
      return;
    }

    setFinalizing(true);
    try {
      const res = await apiClient(
        `/templates/${encodeURIComponent(templateId)}/chat/finalize`,
        {
          method: "POST",
          body: JSON.stringify({ messages }),
        }
      );
      const data: ChatFinalizeResponse = await res.json();
      toast.success(data.summary_of_changes || "プロンプトを最適化しました。");
      onFinalize(data.optimized_system_instruction, data.optimized_response_schema);
      onOpenChange(false);
      setMessages([]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "確定に失敗しました。";
      toast.error(message);
    } finally {
      setFinalizing(false);
    }
  };

  const handleClose = (value: boolean) => {
    if (!sending && !finalizing) {
      onOpenChange(value);
      if (!value) {
        setMessages([]);
        setInput("");
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold text-primary">
            <MessageSquare className="size-5" />
            AIチャットで改善
          </DialogTitle>
          <DialogDescription>
            AIと対話しながらプロンプトの改善点を相談できます。
          </DialogDescription>
        </DialogHeader>

        {/* Chat messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">
                改善したい点をAIに伝えてください。
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                例: 「出力される金額が高すぎるので、もっと安い金額になるようにしたいです。」
              </p>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-3 text-sm whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-4 py-3">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t border-border px-6 py-4 space-y-3">
          <div className="flex gap-2">
            <Textarea
              placeholder="改善したい点を入力... (Shift+Enterで改行)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={sending || finalizing}
              className="resize-none"
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || sending || finalizing}
              size="icon"
              className="shrink-0 self-end"
            >
              <Send className="size-4" />
            </Button>
          </div>

          {messages.length >= 2 && (
            <Button
              onClick={handleFinalize}
              disabled={finalizing || sending}
              className="w-full"
              variant="default"
            >
              {finalizing ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  確定中...
                </>
              ) : (
                <>
                  <CheckCircle className="size-4 mr-2" />
                  この内容で確定してテンプレートを作成
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
