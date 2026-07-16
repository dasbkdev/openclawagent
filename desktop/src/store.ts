// Conversation persistence. Kept in localStorage for now (survives restarts); can move to
// the Tauri store plugin / a file later without touching the UI.

import type { ChatMessage } from "./api";

export type StoredMessage = ChatMessage & { id: number };

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
};

const KEY = "sai.conversations";
const TITLE_CAP = 40;

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Conversation[]) : [];
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage full / disabled — non-fatal
  }
}

export function newConversation(): Conversation {
  const now = Date.now();
  return { id: `c${now}`, title: "Новая беседа", createdAt: now, updatedAt: now, messages: [] };
}

/** Derive a short title from the first user message. */
export function titleFrom(messages: StoredMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "Новая беседа";
  const text = first.content.trim().replace(/\s+/g, " ");
  return text.length > TITLE_CAP ? text.slice(0, TITLE_CAP) + "…" : text || "Новая беседа";
}
