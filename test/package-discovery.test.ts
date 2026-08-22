import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function createPackageFixture() {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-extensions-test-"));
	const packageDir = join(tempDir, "package");
	const agentDir = join(tempDir, "agent");
	const rootManifest = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));

	mkdirSync(join(packageDir, "packages", "alpha"), { recursive: true });
	mkdirSync(join(packageDir, "packages", "beta"), { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(packageDir, "packages", "alpha", "index.ts"), "export default function() {}\n");
	writeFileSync(join(packageDir, "packages", "beta", "index.ts"), "export default function() {}\n");
	writeFileSync(
		join(packageDir, "package.json"),
		JSON.stringify({ name: "fixture", ...(rootManifest.pi === undefined ? {} : { pi: rootManifest.pi }) }),
	);
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [packageDir] }));

	return { agentDir, packageDir, tempDir };
}

async function loadExtensionPaths(packageDir: string, agentDir: string) {
	const resourceLoader = new DefaultResourceLoader({ cwd: packageDir, agentDir });
	await resourceLoader.reload();
	return resourceLoader.getExtensions().extensions.map((extension) => extension.path).sort();
}

test("root manifest loads every workspace extension by default", async (t) => {
	const fixture = createPackageFixture();
	t.after(() => rmSync(fixture.tempDir, { recursive: true, force: true }));

	const enabledPaths = await loadExtensionPaths(fixture.packageDir, fixture.agentDir);

	assert.deepEqual(enabledPaths, [
		join(fixture.packageDir, "packages", "alpha", "index.ts"),
		join(fixture.packageDir, "packages", "beta", "index.ts"),
	]);
});

test("package filters load only selected workspace extensions", async (t) => {
	const fixture = createPackageFixture();
	t.after(() => rmSync(fixture.tempDir, { recursive: true, force: true }));
	writeFileSync(
		join(fixture.agentDir, "settings.json"),
		JSON.stringify({
			packages: [
				{
					source: fixture.packageDir,
					extensions: ["packages/alpha/index.ts"],
				},
			],
		}),
	);

	const enabledPaths = await loadExtensionPaths(fixture.packageDir, fixture.agentDir);

	assert.deepEqual(enabledPaths, [join(fixture.packageDir, "packages", "alpha", "index.ts")]);
});

test("empty package filters load no workspace extensions", async (t) => {
	const fixture = createPackageFixture();
	t.after(() => rmSync(fixture.tempDir, { recursive: true, force: true }));
	writeFileSync(
		join(fixture.agentDir, "settings.json"),
		JSON.stringify({
			packages: [{ source: fixture.packageDir, extensions: [] }],
		}),
	);

	const enabledPaths = await loadExtensionPaths(fixture.packageDir, fixture.agentDir);

	assert.deepEqual(enabledPaths, []);
});
