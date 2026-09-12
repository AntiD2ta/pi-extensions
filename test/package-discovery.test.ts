import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const rootManifest = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
const toolDisplayManifest = JSON.parse(
	readFileSync(join(repositoryRoot, "packages", "pi-tool-display", "package.json"), "utf8"),
);

function createPackageFixture() {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-extensions-test-"));
	const packageDir = join(tempDir, "package");
	const agentDir = join(tempDir, "agent");
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

test("root manifest declares one entry per package and its themes", () => {
	assert.deepEqual(rootManifest.pi, {
		extensions: ["packages/*/index.ts"],
		themes: ["packages/*/themes/*.json"],
	});
});

test("pi-tool-display declares Pi 0.85 compatibility", () => {
	assert.deepEqual(toolDisplayManifest.peerDependencies, {
		"@earendil-works/pi-coding-agent": ">=0.85.0 <0.86.0",
		"@earendil-works/pi-tui": ">=0.85.0 <0.86.0",
	});
});

test("pi-tool-display publishes its provenance records", () => {
	assert.ok(toolDisplayManifest.files.includes("UPSTREAM.md"));
	assert.ok(toolDisplayManifest.files.includes("NOTICE"));
});

test("visual-profile package contributes one entry and its themes", async (t) => {
	const fixture = createPackageFixture();
	t.after(() => rmSync(fixture.tempDir, { recursive: true, force: true }));
	writeFileSync(join(fixture.agentDir, "settings.json"), JSON.stringify({ packages: [repositoryRoot] }));

	const resourceLoader = new DefaultResourceLoader({ cwd: fixture.packageDir, agentDir: fixture.agentDir });
	await resourceLoader.reload();

	assert.deepEqual(
		resourceLoader.getExtensions().extensions
			.map((extension) => extension.path)
			.filter((path) => path.includes("pi-visual-profile"))
			.sort(),
		[join(repositoryRoot, "packages", "pi-visual-profile", "index.ts")],
	);
	const visualProfileThemes = resourceLoader.getThemes().themes
		.map((theme) => theme.name)
		.filter((name): name is string => name?.startsWith("pi-visual-profile") === true)
		.sort();
	assert.deepEqual(visualProfileThemes, ["pi-visual-profile-dark", "pi-visual-profile-light"]);
});

test("root manifest discovers pi-tool-display exactly once", async (t) => {
	const fixture = createPackageFixture();
	t.after(() => rmSync(fixture.tempDir, { recursive: true, force: true }));
	writeFileSync(join(fixture.agentDir, "settings.json"), JSON.stringify({ packages: [repositoryRoot] }));

	const resourceLoader = new DefaultResourceLoader({ cwd: fixture.packageDir, agentDir: fixture.agentDir });
	await resourceLoader.reload();

	assert.deepEqual(
		Array.from(resourceLoader.getExtensions().extensions, (extension) => extension.path)
			.filter((path) => path === join(repositoryRoot, "packages", "pi-tool-display", "index.ts")),
		[join(repositoryRoot, "packages", "pi-tool-display", "index.ts")],
	);
});

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
