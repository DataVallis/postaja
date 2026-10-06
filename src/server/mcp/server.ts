// Postaja's MCP server (TASK-010, ADR-038): one McpServer per request, built for the verified user and organization.
// Tools return JSON (structuredContent) plus the same JSON as text; failures come back as tool errors Claude can
// read and explain, never as stack traces.
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { BrandError } from "../brands/service";
import { CgpImportError, FileError } from "../brands/files";
import type { Db } from "../db/client";
import type { Storage } from "../files/storage";
import type { OrgContext } from "../tenancy/context";
import { addMaterialInput, addTextMaterial, logToolCall, McpError, mcpGetBrand, mcpListBrands, proposeCgp, proposeCgpInput } from "./service";

export type McpDeps = { db: Db; storage: Storage; appUrl: string; ctx: OrgContext; clientId: string };

const FILE_MESSAGES: Partial<Record<FileError["code"], string>> = {
  DUPLICATE: "This exact material is already uploaded for the brand.",
  LIMIT_REACHED: "The brand has the maximum number of materials.",
  TOO_LARGE: "The material is too large (max 50 MB).",
  ARCHIVED: "The brand is archived.",
  FORBIDDEN: "Only the organization owner can add materials.",
};

function message(e: unknown): string | null {
  if (e instanceof McpError) return e.message;
  if (e instanceof FileError) return FILE_MESSAGES[e.code] ?? `The material was refused (${e.code}).`;
  if (e instanceof BrandError || e instanceof CgpImportError) return `Refused: ${e.code}.`;
  if (e instanceof z.ZodError) return `Invalid input: ${e.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
  return null;
}

export function buildMcpServer(d: McpDeps): McpServer {
  const server = new McpServer(
    { name: "postaja", version: "1.0.0" },
    {
      // ADR-039: posts are written in Postaja; Claude fills the brand's knowledge base.
      instructions:
        "Postaja writes and schedules the social posts itself. Use these tools only to fill a brand's knowledge base: send the owner's CGP for review (propose_cgp) and add facts as materials (add_material: price lists, products, dates, FAQs, past posts). Do not write posts here; tell the owner to create them in Postaja.",
    },
  );

  async function run(tool: string, fn: () => Promise<unknown>) {
    try {
      const out = (await fn()) as Record<string, unknown>;
      await logToolCall(d.db, { orgId: d.ctx.orgId, userId: d.ctx.userId, clientId: d.clientId, tool });
      return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }], structuredContent: out };
    } catch (e) {
      const msg = message(e);
      await logToolCall(d.db, { orgId: d.ctx.orgId, userId: d.ctx.userId, clientId: d.clientId, tool, error: msg ? (e as { code?: string }).code ?? "INVALID" : "INTERNAL" });
      if (!msg) throw e;
      return { content: [{ type: "text" as const, text: msg }], isError: true };
    }
  }

  server.registerTool(
    "list_brands",
    {
      title: "List brands",
      description: `Lists the brands (projects) of the organization "${d.ctx.orgName}" in Postaja with their channels and languages.`,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => run("list_brands", async () => ({ organization: d.ctx.orgName, role: d.ctx.role, brands: await mcpListBrands(d.db, d.ctx) })),
  );

  server.registerTool(
    "get_brand",
    {
      title: "Get a brand's CGP and setup",
      description: "Returns a brand's current CGP (the instructions Postaja writes every post from), rules, content pillars, channels and the list of uploaded materials.",
      inputSchema: z.object({ brand: z.string().describe("Brand id or slug, e.g. \"inzenirji\"") }),
      annotations: { readOnlyHint: true },
    },
    async ({ brand }) => run("get_brand", () => mcpGetBrand(d.db, d.ctx, brand)),
  );

  server.registerTool(
    "propose_cgp",
    {
      title: "Send a CGP to Postaja for review",
      description:
        "Sends a CGP (Markdown) for a brand to Postaja as a draft. It does not change the active CGP: the owner reviews it on the brand page and saves it as a new version. Use the owner's own CGP text from this conversation or project; do not invent brand facts. Owner only.",
      inputSchema: proposeCgpInput.extend({
        brand: z.string().describe("Brand id or slug"),
        cgp: z.string().describe("The full CGP in Markdown (max 50,000 characters)"),
        note: z.string().optional().describe("Short note for the owner, e.g. where it came from"),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (args) => run("propose_cgp", () => proposeCgp(d.db, d.ctx, args, d.appUrl)),
  );

  server.registerTool(
    "add_material",
    {
      title: "Add a text material to a brand",
      description:
        "Adds text to a brand's knowledge base (price lists, product facts, FAQs, campaign briefs, past posts). For every post Postaja picks the passages that match the request. Saved as Markdown unless the filename ends with .txt or .csv. Owner only.",
      inputSchema: addMaterialInput.extend({
        brand: z.string().describe("Brand id or slug"),
        filename: z.string().describe("Name shown in Postaja, e.g. \"cenik-2026.md\""),
        text: z.string().describe("The material's full text"),
      }),
      annotations: { destructiveHint: false },
    },
    async (args) => run("add_material", () => addTextMaterial(d.db, d.storage, d.ctx, args)),
  );

  return server;
}
