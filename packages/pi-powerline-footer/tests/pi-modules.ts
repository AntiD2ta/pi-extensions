import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Pi packages hide their dist layout behind "exports", so tests that need internals
// resolve the package entry point and address sibling modules from its directory.
const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const requireFromCodingAgent = createRequire(codingAgentEntry);

export function codingAgentModuleUrl(subpath: string): string {
  return pathToFileURL(join(dirname(codingAgentEntry), subpath)).href;
}

// pi-coding-agent ships an npm shrinkwrap, so npm may install its own pi-tui copy.
// Resolve pi-tui through pi-coding-agent so module-level mutations affect the same instance its editor uses.
export function piTuiModuleUrl(subpath: string): string {
  return pathToFileURL(requireFromCodingAgent.resolve(`@earendil-works/pi-tui/${subpath}`)).href;
}
