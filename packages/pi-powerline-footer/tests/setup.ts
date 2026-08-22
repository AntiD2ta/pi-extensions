import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Theme, icon, and settings lookups read ~/.pi/agent. Point HOME at an empty directory
// so a real agent dir on the developer's machine cannot change results. Tests that need
// their own HOME still override and restore it themselves.
const home = mkdtempSync(join(tmpdir(), "powerline-test-home-"));
process.env.HOME = home;
delete process.env.USERPROFILE;
process.on("exit", () => rmSync(home, { recursive: true, force: true }));
