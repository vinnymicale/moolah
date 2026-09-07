"use client";

import { useState, useTransition } from "react";
import { Check, Trash2 } from "lucide-react";
import { updateAiConfigAction, clearAiConfigAction } from "@/actions/settings";
import { MODEL_SUGGESTIONS, defaultModel, isAiProvider } from "@/lib/ai-models";

export function AiConfigForm({
  currentProvider,
  currentModel,
  hasKey,
}: {
  currentProvider: string | null;
  currentModel: string | null;
  hasKey: boolean;
}) {
  const [provider, setProvider] = useState(currentProvider ?? "anthropic");
  const [model, setModel] = useState(currentModel ?? "");
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      await updateAiConfigAction(provider, apiKey, model);
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });

  const clear = () =>
    start(async () => {
      await clearAiConfigAction();
      setProvider("anthropic");
      setModel("");
      setApiKey("");
    });

  const PROVIDERS = [
    { value: "anthropic", label: "Anthropic (Claude)" },
    { value: "openai", label: "OpenAI (ChatGPT)" },
    { value: "gemini", label: "Google Gemini" },
  ];

  const suggestions = isAiProvider(provider) ? MODEL_SUGGESTIONS[provider] : [];
  const placeholderModel = isAiProvider(provider) ? defaultModel(provider) : "";

  const keyPlaceholder =
    provider === "anthropic"
      ? "sk-ant-…"
      : provider === "openai"
      ? "sk-…"
      : "AIza…";

  return (
    <div className="space-y-3">
      <div>
        <label className="label">AI provider</label>
        <select
          className="input"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setModel("");
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">
          API key{hasKey && <span className="ml-2 text-xs text-income">Key saved — enter a new one to replace it</span>}
        </label>
        <input
          className="input font-mono text-sm"
          type="password"
          placeholder={keyPlaceholder}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div>
        <label className="label">Model</label>
        <input
          className="input font-mono text-sm"
          list="ai-model-suggestions"
          placeholder={placeholderModel}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <datalist id="ai-model-suggestions">
          {suggestions.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </datalist>
        <p className="mt-1 text-xs text-muted">
          Leave blank to use the default ({placeholderModel}). Any model name your key can access works here.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending || (!apiKey.trim() && !currentProvider)}
          className="btn-primary"
        >
          {saved ? <Check size={16} /> : null}
          {pending ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
        {(currentProvider || hasKey) && (
          <button onClick={clear} disabled={pending} className="btn-ghost text-expense">
            <Trash2 size={14} /> Remove key
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        Your key is stored only in your own database and never sent to the browser. It is used solely to call the AI provider on your behalf when you use the assistant.
      </p>
    </div>
  );
}
