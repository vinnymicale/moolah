"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, Send, Bot, Loader2, TriangleAlert, RotateCcw } from "lucide-react";
import type { ChatMessage } from "@/app/api/chat/route";

const WELCOME = `Hi! I'm your finance assistant. I can answer questions about your spending, balances, and budgets — or help you log transactions and set up recurring rules.

Try asking things like:
- "How much did I spend on dining out last month?"
- "What's my current net worth?"
- "Add a $15.99/month Netflix expense starting today"
- "Set a $500 budget for groceries this month"`;

export function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      const data = (await res.json()) as { reply?: string; error?: string };

      if (!res.ok || data.error) {
        setError(data.error ?? "Something went wrong.");
      } else if (data.reply) {
        setMessages([...nextMessages, { role: "assistant", content: data.reply }]);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop (mobile) */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-md md:hidden"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <aside className="fixed bottom-0 right-0 top-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-overlay md:w-96">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-brand-fg">
            <Bot size={16} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">Finance Assistant</p>
            <p className="text-xs text-muted">Ask anything about your finances</p>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={() => { setMessages([]); setError(null); }}
                className="btn-ghost h-8 w-8 !p-0"
                title="Clear conversation"
              >
                <RotateCcw size={14} />
              </button>
            )}
            <button onClick={onClose} className="btn-ghost h-8 w-8 !p-0" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Welcome message */}
          {messages.length === 0 && (
            <div className="rounded-xl bg-surface2 px-4 py-3">
              <p className="text-sm text-muted whitespace-pre-line">{WELCOME}</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              {msg.role === "assistant" && (
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg">
                  <Bot size={12} />
                </div>
              )}
              <div
                className={`max-w-[82%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-brand text-brand-fg"
                    : "bg-surface2 text-text"
                }`}
              >
                <MessageContent content={msg.content} />
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-2">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg">
                <Bot size={12} />
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-surface2 px-3.5 py-2.5">
                <Loader2 size={14} className="animate-spin text-muted" />
                <span className="text-sm text-muted">Thinking…</span>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-expense/30 bg-expense/10 px-3.5 py-2.5 text-sm text-expense">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-line p-3">
          <div className="flex items-end gap-2 rounded-xl border border-line bg-surface px-3 py-2 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about your finances…"
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-text placeholder:text-muted outline-none max-h-32"
              style={{ minHeight: "1.5rem" }}
            />
            <button
              onClick={() => void send()}
              disabled={!input.trim() || loading}
              className="btn-primary h-7 w-7 shrink-0 !p-0 disabled:opacity-40"
              aria-label="Send"
            >
              <Send size={13} />
            </button>
          </div>
          <p className="mt-1.5 text-center text-xs text-muted">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </aside>
    </>
  );
}

// Render message content with basic markdown-like formatting (**bold**,
// `code`). Built as React nodes - model output is never injected as HTML.
function MessageContent({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {formatLine(line)}
        </span>
      ))}
    </>
  );
}

function formatLine(line: string): ReactNode[] {
  return line.split(/(\*\*.*?\*\*|`.*?`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-black/10 dark:bg-white/10 px-1 py-0.5 font-mono text-xs">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
