import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "pi31-smoke-server", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "success", description: "Return a deterministic successful result.", inputSchema: { type: "object", properties: {} } },
    { name: "delayed", description: "Return success after a visible delay.", inputSchema: { type: "object", properties: {} } },
    { name: "failure", description: "Throw a deterministic transport-style error.", inputSchema: { type: "object", properties: {} } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "delayed") await new Promise((resolve) => setTimeout(resolve, 8000));
  if (request.params.name === "failure") throw new Error("PI-31 deterministic smoke failure");
  if (request.params.name === "success" || request.params.name === "delayed") {
    return { content: [{ type: "text", text: request.params.name === "delayed" ? "delayed ok" : "success ok" }] };
  }
  throw new Error(`Unknown smoke tool: ${request.params.name}`);
});

await server.connect(new StdioServerTransport());
