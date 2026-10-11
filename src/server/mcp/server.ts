// Postaja's MCP server (TASK-010, ADR-038): one McpServer per request, built for the verified user and organization.
// Tools return JSON (structuredContent) plus the same JSON as text; failures come back as tool errors Claude can
// read and explain, never as stack traces.
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { BrandError } from "../brands/service";
import { CgpImportError, FileError } from "../brands/files";
import type { Db } from "../db/client";
import type { Storage } from "../files/storage";
import type { FetchFile } from "../files/fetch-public";
import type { OrgContext } from "../tenancy/context";
import { addFile, addFileInput, addMaterialInput, addTextMaterial, createBrandInput, ensureBrand, FILE_MAX_BYTES, logToolCall, McpError, mcpGetBrand, mcpListBrands, proposeCgp, proposeCgpInput, uploadLink } from "./service";

/** fetchFile: how add_file downloads a URL (default: public addresses only); replaceable in tests. */
export type McpDeps = { db: Db; storage: Storage; appUrl: string; ctx: OrgContext; clientId: string; fetchFile?: FetchFile };

const FILE_MESSAGES: Partial<Record<FileError["code"], string>> = {
  DUPLICATE: "This exact material is already uploaded for the brand.",
  LIMIT_REACHED: "The brand has the maximum number of materials.",
  TOO_LARGE: "The material is too large (max 50 MB).",
  ARCHIVED: "The brand is archived.",
  FORBIDDEN: "Only the organization owner can add materials.",
  UNSUPPORTED_TYPE: "Postaja does not accept this file type (images, PDF, Word, Excel, PowerPoint, text, fonts and ZIP are accepted).",
  INVALID_FILE: "The file could not be read (damaged or not what its name says).",
  MISSING_GLYPHS: "The font lacks Slovenian letters (č š ž) required by the brand.",
  FONT_UNSUPPORTED: "Postaja cannot draw text in this font. Upload a static TTF/OTF (e.g. the Regular or Bold file) instead.",
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
        "Postaja writes and schedules the social posts itself. Use these tools to set up and fill a brand: create it if it does not exist yet (create_brand; propose_cgp, add_material and add_file also create it when the name matches no brand), send the owner's CGP for review (propose_cgp), add facts as text materials (add_material: price lists, products, dates, FAQs, past posts) and add files (add_file: the logo, images of past posts — Postaja derives the brand's visual identity from them — PDF/Word/Excel material, fonts). Prefer add_file with a public url (e.g. the logo or images on the brand's website); send content_base64 only for small files you actually have as bytes. Images the owner pasted into the chat cannot be sent: give the owner upload_link for those and for large files or folders. Call list_brands first and use an existing brand's exact name or slug. Do not write posts here; tell the owner to create them in Postaja.",
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
    "create_brand",
    {
      title: "Create a brand (if it does not exist)",
      description: "Creates a brand (project) in Postaja for a new project — or returns the existing one if a brand with this name already exists. Postaja makes the short name from the name. Owner only.",
      inputSchema: createBrandInput.extend({
        name: z.string().describe("The brand's name, e.g. \"aibuilders.si\" or \"Inženirji\""),
        website: z.string().optional().describe("The brand's website, e.g. \"https://www.aibuilders.si\""),
        languages: createBrandInput.shape.languages.describe("Languages the brand posts in (sl, en, de, hr, it); default sl"),
      }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async (args) => run("create_brand", () => ensureBrand(d.db, d.ctx, args, d.appUrl)),
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
        create_if_missing: z.boolean().optional().describe("Create the brand when no brand matches (default true)"),
        languages: proposeCgpInput.shape.languages.describe("Languages if the brand is created (sl, en, de, hr, it)"),
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
        create_if_missing: z.boolean().optional().describe("Create the brand when no brand matches (default true)"),
      }),
      annotations: { destructiveHint: false },
    },
    async (args) => run("add_material", () => addTextMaterial(d.db, d.storage, d.ctx, args, d.appUrl)),
  );

  server.registerTool(
    "add_file",
    {
      title: "Add a file to a brand",
      description:
        `Adds a file from this conversation to a brand in Postaja: the logo, images of past posts (Postaja's visual identity and image style are derived from them), PDF/Word/Excel/PowerPoint material (its text becomes knowledge), a font (TTF/OTF/WOFF), or a ZIP of such files. Give either url (a public http(s) link; Postaja downloads it — best for the logo or images on the brand's website) or content_base64 (the bytes, only for small files you have as bytes; images pasted into the chat are not available as bytes — use upload_link). Max ${FILE_MAX_BYTES / 1024 / 1024} MB. kind: "logo", "post_example", "material", "font", or "auto" (sorted by type and name). Owner only.`,
      inputSchema: addFileInput.extend({
        brand: z.string().describe("Brand id, slug or name"),
        filename: addFileInput.shape.filename.describe("File name with extension, e.g. \"logo.png\" (required with content_base64; taken from the URL otherwise)"),
        content_base64: addFileInput.shape.content_base64.describe("The file's bytes, base64-encoded (small files only)"),
        url: addFileInput.shape.url.describe("Public http(s) URL of the file; Postaja downloads it"),
        kind: addFileInput.shape.kind.describe("logo | post_example | material | font | auto (default)"),
        create_if_missing: z.boolean().optional().describe("Create the brand when no brand matches (default true)"),
      }),
      annotations: { destructiveHint: false },
    },
    async (args) => run("add_file", () => addFile(d.db, d.storage, d.ctx, args, d.appUrl, d.fetchFile)),
  );

  server.registerTool(
    "upload_link",
    {
      title: "Link for uploading large files",
      description: "Returns the brand's Files page in Postaja, where the owner (signed in) drops files too large to send with add_file, or whole folders as a ZIP.",
      inputSchema: z.object({ brand: z.string().describe("Brand id, slug or name") }),
      annotations: { readOnlyHint: true },
    },
    async ({ brand }) => run("upload_link", () => uploadLink(d.db, d.ctx, brand, d.appUrl)),
  );

  return server;
}
