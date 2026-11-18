import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = path.join(webRoot, 'data');
const publicRoot = path.join(webRoot, 'public');
const maxPublicFileBytes = 100_000_000;
const exclusions = [];

if (!publicRoot.startsWith(`${webRoot}${path.sep}`)) {
  throw new Error(`Refusing to prepare public data outside the web project: ${publicRoot}`);
}

function copyDeployableData(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.database-build-') || entry.name === '.database-previous' || entry.name === '.database-publish.lock') continue;
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDeployableData(source, target);
      continue;
    }
    if (!entry.isFile()) continue;

    let size = statSync(source).size;
    if (size < 512) {
      const pointer = readFileSync(source, 'utf8');
      if (pointer.startsWith('version https://git-lfs.github.com/spec/v1')) {
        const declaredSize = Number(pointer.match(/^size (\d+)$/m)?.[1]);
        if (Number.isFinite(declaredSize)) size = declaredSize;
      }
    }
    if (size >= maxPublicFileBytes) {
      exclusions.push({
        path: path.relative(dataRoot, source).replaceAll(path.sep, '/'),
        sizeBytes: size,
        reason: `Excluded from static hosting because the file is at least ${maxPublicFileBytes.toLocaleString()} bytes. The source remains in web/data and Git LFS.`,
      });
      continue;
    }
    cpSync(source, target);
  }
}

rmSync(publicRoot, { recursive: true, force: true });
copyDeployableData(dataRoot, publicRoot);

const pipelineSnapshotPath = path.join(publicRoot, 'pipeline_demo.json');
if (exclusions.length && statSync(pipelineSnapshotPath).isFile()) {
  const snapshot = JSON.parse(readFileSync(pipelineSnapshotPath, 'utf8'));
  const excludedPaths = new Set(exclusions.map((item) => item.path));
  for (const stage of snapshot.stages ?? []) {
    stage.files = (stage.files ?? []).filter((file) => !excludedPaths.has(String(file.sourcePath ?? '').replace(/^data\//, '')));
  }
  snapshot.staticAssetExclusions = exclusions;
  writeFileSync(pipelineSnapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

const publicFileCount = exclusions.length;
console.log(`Prepared static data in ${path.relative(webRoot, publicRoot)}; omitted ${publicFileCount} file(s) over the public asset limit.`);
for (const item of exclusions) console.log(`Omitted ${item.path} (${item.sizeBytes.toLocaleString()} bytes)`);
