import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';

const root = resolve(__dirname, '../..');

// emits the declarations of `src/index.ts` (the types of `drizzle.config.ts`) in memory
// and returns the package imports of every declaration file reachable from `index.d.ts`
const packagesImportedByConfigTypes = () => {
	const configPath = join(root, 'tsconfig.json');
	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);

	const emitted = new Map<string, string>();
	const program = ts.createProgram([join(root, 'src/index.ts')], {
		...options,
		noEmit: false,
		declaration: true,
		emitDeclarationOnly: true,
		declarationDir: join(root, 'dts'),
		outDir: undefined,
		rootDir: join(root, 'src'),
	});
	program.emit(undefined, (fileName, text) => emitted.set(resolve(fileName), text));

	const packages = new Set<string>();
	const visited = new Set<string>();
	const queue = [join(root, 'dts/index.d.ts')];
	while (queue.length) {
		const file = queue.pop()!;
		if (visited.has(file)) continue;
		visited.add(file);

		const text = emitted.get(file);
		if (text === undefined) throw new Error(`declaration file was not emitted: ${file}`);

		for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
			if (!fileName.startsWith('.')) {
				packages.add(fileName);
				continue;
			}
			const base = resolve(dirname(file), fileName).replace(/\.(?:js|ts)$/, '');
			queue.push(emitted.has(`${base}.d.ts`) ? `${base}.d.ts` : join(base, 'index.d.ts'));
		}
	}
	return packages;
};

// driver packages are kept external by `scripts/build.ts` and are not dependencies of drizzle-kit,
// so a declaration import of one of them fails type checking where it is not installed
const driverPackages = [
	'pg',
	'postgres',
	'@vercel/postgres',
	'@neondatabase/serverless',
	'@electric-sql/pglite',
	'mysql2',
	'@planetscale/database',
	'@libsql/client',
	'better-sqlite3',
	'bun:sqlite',
	'@sqlitecloud/drivers',
	'@tursodatabase/database',
	'bun',
	'mssql',
	'duckdb',
	'@duckdb/node-api',
];

// https://github.com/drizzle-team/drizzle-orm/issues/6581
test('config types do not import driver packages', () => {
	const packages = packagesImportedByConfigTypes();

	expect(packages.has('zod')).toBe(true);
	expect([...packages].filter((it) => driverPackages.some((d) => it === d || it.startsWith(`${d}/`)))).toStrictEqual(
		[],
	);
}, 120_000);
