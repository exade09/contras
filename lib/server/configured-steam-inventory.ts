import {
  createResilientSteamInventoryFetch,
  createSteamInventoryLoader,
} from "./steam-inventory";
import { runtimeEnv } from "./storage";

/**
 * Shared production loader for every route that reads or verifies Steam assets.
 * Steam Community remains the primary source; SteamApis is used only when the
 * primary endpoint rate-limits the request.
 */
export const configuredSteamInventoryLoader = createSteamInventoryLoader({
  fetchImpl: createResilientSteamInventoryFetch(runtimeEnv().STEAMAPIS_API_KEY),
  timeoutMs: 30_000,
});
