/**
 * Upsert pre-computed party totals directly
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";

const PARTIES = [
  { id: "ndc", name: "Nigeria Democratic Congress", abbr: "NDC", color: "#1B5E20" },
  { id: "apc", name: "All Progressives Congress", abbr: "APC", color: "#00A859" },
  { id: "pdp", name: "Peoples Democratic Party", abbr: "PDP", color: "#000080" },
  { id: "lp", name: "Labour Party", abbr: "LP", color: "#FF0000" },
  { id: "nnpp", name: "New Nigeria Peoples Party", abbr: "NNPP", color: "#E53935" },
  { id: "apga", name: "All Progressives Grand Alliance", abbr: "APGA", color: "#FFD600" },
  { id: "sdp", name: "Social Democratic Party", abbr: "SDP", color: "#1565C0" },
  { id: "ypp", name: "Young Progressives Party", abbr: "YPP", color: "#6A1B9A" },
  { id: "adc", name: "African Democratic Congress", abbr: "ADC", color: "#00838F" },
];

export const upsertPartyTotals = mutation({
  args: {
    totals: v.array(
      v.object({
        abbr: v.string(),
        votes: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const grandTotal = args.totals.reduce((s, t) => s + t.votes, 0);

    for (const total of args.totals) {
      const party = PARTIES.find((p) => p.abbr === total.abbr);
      if (!party) continue;

      const existing = await ctx.db
        .query("party_totals")
        .withIndex("by_abbreviation", (q) => q.eq("party_abbreviation", party.abbr))
        .first();

      const data = {
        party_id: party.id,
        party_name: party.name,
        party_abbreviation: party.abbr,
        party_color: party.color,
        total_votes: total.votes,
        percentage: grandTotal > 0 ? Number(((total.votes / grandTotal) * 100).toFixed(1)) : 0,
        updated_at: Date.now(),
      };

      if (existing) await ctx.db.patch(existing._id, data);
      else await ctx.db.insert("party_totals", data);
    }

    return { success: true, grandTotal, count: args.totals.length };
  },
});
