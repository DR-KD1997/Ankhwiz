// The Rust core, carried inside the app as WebAssembly (see bridge.ts).

import { coreModule, startCore } from './bridge';
import { CORE_WASM_BASE64 } from './wasm.generated';

export * from './bridge';

function bytesOf(base64: string): Uint8Array {
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function initCore(): Promise<void> {
  if (coreModule()) return;
  const module = await WebAssembly.compile(bytesOf(CORE_WASM_BASE64) as BufferSource);
  await startCore(module);
}
