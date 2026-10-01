import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

/** One navigation request between the chat and the Agents panel of a thread. */
export interface AgentNavigationRequest {
  readonly threadKey: string;
  readonly agentId: string;
  /** Distinguishes repeated requests for the same agent. */
  readonly nonce: number;
}

interface AgentNavigationStoreState {
  /** Chat → panel: open this agent's detail. */
  readonly focus: AgentNavigationRequest | null;
  /** Panel → chat: scroll to and highlight the row that spawned this agent. */
  readonly reveal: AgentNavigationRequest | null;
  readonly focusAgent: (ref: ScopedThreadRef, agentId: string) => void;
  readonly revealSpawn: (ref: ScopedThreadRef, agentId: string) => void;
}

let nextNonce = 0;

export const useAgentNavigationStore = create<AgentNavigationStoreState>((set) => ({
  focus: null,
  reveal: null,
  focusAgent: (ref, agentId) =>
    set({ focus: { threadKey: scopedThreadKey(ref), agentId, nonce: ++nextNonce } }),
  revealSpawn: (ref, agentId) =>
    set({ reveal: { threadKey: scopedThreadKey(ref), agentId, nonce: ++nextNonce } }),
}));
