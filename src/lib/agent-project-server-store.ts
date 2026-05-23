import {
  createFallbackAgentProjectStore,
  createSupabaseAgentProjectStoreFromEnv,
  isSupabaseProjectStoreRequired
} from "@/lib/agent-project-db-store";
import { createLocalAgentProjectStore } from "@/lib/agent-workspace-store";

export function createServerAgentProjectStore() {
  const localStore = createLocalAgentProjectStore();
  const dbStore = createSupabaseAgentProjectStoreFromEnv();
  if (!dbStore) return localStore;
  return createFallbackAgentProjectStore(dbStore, localStore, {
    required: isSupabaseProjectStoreRequired()
  });
}
