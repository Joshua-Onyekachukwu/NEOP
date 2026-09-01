/**
 * Convex HTTP Router — exposes simulation trigger as an HTTP action
 *
 * Called by the admin dashboard's /api/admin/simulate/trigger endpoint.
 */

import { httpRouter } from "convex/server";
import { triggerSimulation } from "./httpHandler";

const http = httpRouter();

http.route({
  path: "/trigger-simulation",
  method: "POST",
  handler: triggerSimulation,
});

export default http;
