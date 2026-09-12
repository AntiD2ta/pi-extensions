import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "pi-tool-display-home-"));
process.env.HOME = home;
delete process.env.PI_CODING_AGENT_DIR;
process.on("exit", () => rmSync(home, { recursive: true, force: true }));
