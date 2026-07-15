"use client";

import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

export interface TagOption {
  id: string;
  name: string;
  color: string;
}

interface TagInputProps {
  /** Current tag names, display-cased. */
  value: string[];
  onChange: (next: string[]) => void;
  /** All existing tags, for autocomplete and chip colors. */
  options: TagOption[];
  placeholder?: string;
}

export function TagInput({ value, onChange, options, placeholder = "Add tags…" }: TagInputProps) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const chosen = useMemo(() => new Set(value.map((v) => v.toLowerCase())), [value]);
  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase();
    return options
      .filter((o) => !chosen.has(o.name.toLowerCase()))
      .filter((o) => !q || o.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [options, chosen, text]);

  const colorFor = (name: string) =>
    options.find((o) => o.name.toLowerCase() === name.toLowerCase())?.color ?? "#64748b";

  const add = (raw: string) => {
    const name = raw.trim().replace(/\s+/g, " ").slice(0, 40);
    setText("");
    if (!name || chosen.has(name.toLowerCase())) return;
    onChange([...value, name]);
  };

  const remove = (name: string) => onChange(value.filter((v) => v !== name));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(text);
    } else if (e.key === "Backspace" && text === "" && value.length > 0) {
      remove(value[value.length - 1]);
    }
  };

  return (
    <div className="relative">
      <div
        className="input flex h-auto min-h-10 flex-wrap items-center gap-1.5 py-1.5"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs"
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorFor(name) }} />
            {name}
            <button type="button" onClick={() => remove(name)} aria-label={`Remove tag ${name}`}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none"
          value={text}
          placeholder={value.length === 0 ? placeholder : ""}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
        />
      </div>
      {focused && suggestions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg">
          {suggestions.map((o) => (
            <button
              key={o.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface2"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(o.name)}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: o.color }} />
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
