import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";

const seriesSchema = z.object({
  label: z.string(),
  data: z
    .array(
      z.object({
        x: z.union([z.string(), z.number()]),
        y: z.number(),
      })
    )
    .min(1),
  color: z
    .string()
    .optional()
    .describe("Tailwind color name or hex. Defaults to theme palette."),
  style: z.enum(["solid", "dashed", "area"]).default("solid"),
});

const parameters = z.object({
  type: z
    .enum(["line", "bar", "area", "table"])
    .describe(
      "Chart type: line (time series), bar (categorical), area (filled), table (rows)."
    ),
  title: z.string().describe("Short chart title shown above the visualization."),
  series: z
    .array(seriesSchema)
    .min(1)
    .describe("Data series to plot."),
  xLabel: z.string().optional().describe("X-axis label."),
  yLabel: z.string().optional().describe("Y-axis label."),
  annotations: z
    .array(
      z.object({
        x: z.union([z.string(), z.number()]),
        label: z.string(),
        color: z.string().optional(),
      })
    )
    .optional()
    .describe("Vertical markers (e.g., race day, today)."),
});

export type ChartSpec = z.infer<typeof parameters>;

async function execute(
  args: z.infer<typeof parameters>,
  _ctx: ToolContext
): Promise<{ artifact: true; chartId: string; spec: ChartSpec }> {
  return {
    artifact: true,
    chartId: crypto.randomUUID(),
    spec: args,
  };
}

export const renderChart: ToolDefinition<typeof parameters> = {
  name: "render_chart",
  description:
    "Render an inline chart or table in the conversation. The athlete sees a " +
    "visual preview that expands on click. Use for trends, comparisons, and " +
    "structured data — anything better shown than described.",
  parameters,
  execute,
};
