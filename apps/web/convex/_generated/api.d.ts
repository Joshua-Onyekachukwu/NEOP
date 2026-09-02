/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as clearData from "../clearData.js";
import type * as finalize from "../finalize.js";
import type * as http from "../http.js";
import type * as httpHandler from "../httpHandler.js";
import type * as runSimulation from "../runSimulation.js";
import type * as seed_parties from "../seed_parties.js";
import type * as simulation from "../simulation.js";
import type * as stats from "../stats.js";
import type * as sync_from_supabase from "../sync_from_supabase.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  clearData: typeof clearData;
  finalize: typeof finalize;
  http: typeof http;
  httpHandler: typeof httpHandler;
  runSimulation: typeof runSimulation;
  seed_parties: typeof seed_parties;
  simulation: typeof simulation;
  stats: typeof stats;
  sync_from_supabase: typeof sync_from_supabase;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
