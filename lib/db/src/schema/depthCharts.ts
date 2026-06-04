import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const nflDepthChartSnapshotsTable = pgTable("nfl_depth_chart_snapshots", {
  id: serial("id").primaryKey(),
  season: integer("season").notNull(),
  teamAbbr: text("team_abbr").notNull(),
  teamName: text("team_name").notNull(),
  source: text("source").notNull().default("ESPN"),
  sourceUrl: text("source_url").notNull(),
  normalized: jsonb("normalized").notNull(),
  raw: jsonb("raw"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDepthChartSchema = createInsertSchema(nflDepthChartSnapshotsTable).omit({
  id: true,
});
export type InsertDepthChart = z.infer<typeof insertDepthChartSchema>;
export type DepthChartSnapshot = typeof nflDepthChartSnapshotsTable.$inferSelect;
