// The AI client: asks the core what to send, hands it to the platform to
// send, and gives the reply back to the core to read. Nothing is sent
// anywhere until the learner has set up a connection of their own.

import { aiHttp, aiModels, aiModelsHttp, aiReply, aiRequest, CoreError } from './core';
import type { AiRequest, Deck, Provider } from './core/types';
import { getSecret, http, setSecret } from './platform';
import { data, save } from './store.svelte';

const KEY_NAME = 'ai-key';

export const aiState = $state({ key: '', loaded: false });

export async function loadKey(): Promise<void> {
  aiState.key = await getSecret(KEY_NAME);
  aiState.loaded = true;
}

export async function saveKey(key: string): Promise<boolean> {
  aiState.key = key.trim();
  return setSecret(KEY_NAME, aiState.key);
}

export function provider(): Provider {
  const { baseUrl, fastModel, strongModel } = data.ai;
  return { baseUrl, fastModel, strongModel, key: aiState.key };
}

/** True once there is an address and a model to talk to. */
export function aiReady(): boolean {
  return data.ai.baseUrl.trim() !== '' && data.ai.fastModel.trim() !== '';
}

/** Where requests go, for the privacy notice. */
export function aiHost(): string {
  try {
    return new URL(data.ai.baseUrl).host;
  } catch {
    return data.ai.baseUrl;
  }
}

export function isLocal(): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(aiHost());
}

export function acceptNotice(): void {
  data.ai.noticeSeen = true;
  save();
}

/** The request for a task, without sending it: used to show its size first. */
export function plan(task: string, deck: Deck, args: Record<string, unknown> = {}): AiRequest | null {
  try {
    return aiRequest(task, deck, args);
  } catch {
    return null;
  }
}

function message(e: unknown): string {
  return e instanceof CoreError || e instanceof Error ? e.message : 'Something went wrong.';
}

/** Run one AI task. Throws an Error whose message can be shown to the learner. */
export async function ask<T>(task: string, deck: Deck, args: Record<string, unknown> = {}): Promise<T> {
  try {
    const request = aiRequest(task, deck, args);
    const reply = await http(aiHttp(provider(), request));
    return aiReply<T>(task, reply.status, reply.body, { deck, ...args });
  } catch (e) {
    throw new Error(message(e));
  }
}

export async function listModels(): Promise<string[]> {
  try {
    const reply = await http(aiModelsHttp(provider()));
    return aiModels(reply.status, reply.body);
  } catch (e) {
    throw new Error(message(e));
  }
}
