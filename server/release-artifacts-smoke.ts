import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const rootDir = process.cwd();
const arch = "x64";

type PackageJson = {
  version?: string;
  build?: {
    productName?: string;
  };
};

type CheckedFile = {
  label: string;
  path: string;
  bytes: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function displayPath(filePath: string) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

async function readPackageJson() {
  const packagePath = path.join(rootDir, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as PackageJson;
  const version = typeof packageJson.version === "string" ? packageJson.version.trim() : "";
  const productName = typeof packageJson.build?.productName === "string" ? packageJson.build.productName.trim() : "";
  assert(version, "package.json does not define a version for release artifact validation.");
  assert(productName, "package.json build.productName is required for release artifact validation.");
  return {
    version,
    productName,
  };
}

async function assertNonEmptyFile(label: string, parts: string[]) {
  const filePath = path.join(rootDir, ...parts);
  let info;
  try {
    info = await stat(filePath);
  } catch (error) {
    throw Object.assign(
      new Error(`${label} is missing at ${displayPath(filePath)}. Run npm run dist:win:built before npm run smoke:release:artifacts.`),
      { cause: error },
    );
  }
  assert(info.isFile(), `${label} is not a file: ${displayPath(filePath)}`);
  assert(info.size > 0, `${label} is empty: ${displayPath(filePath)}`);
  return { label, path: filePath, bytes: info.size };
}

const { productName, version } = await readPackageJson();
const checkedFiles: CheckedFile[] = [];

checkedFiles.push(await assertNonEmptyFile("Unpacked desktop executable", ["release", "win-unpacked", `${productName}.exe`]));
checkedFiles.push(await assertNonEmptyFile("NSIS setup artifact", ["release", `${productName}-Setup-${version}-${arch}.exe`]));
checkedFiles.push(await assertNonEmptyFile("NSIS setup blockmap", ["release", `${productName}-Setup-${version}-${arch}.exe.blockmap`]));
checkedFiles.push(await assertNonEmptyFile("Portable executable artifact", ["release", `${productName}-Portable-${version}-${arch}.exe`]));
const zipArtifact = await assertNonEmptyFile("Zip artifact", ["release", `${productName}-${version}-${arch}.zip`]);
checkedFiles.push(zipArtifact);
checkedFiles.push(await assertNonEmptyFile("Electron builder debug log", ["release", "builder-debug.yml"]));
checkedFiles.push(await assertNonEmptyFile("Unpacked English OCR traineddata", ["release", "win-unpacked", "resources", "ocr", "eng.traineddata"]));
checkedFiles.push(await assertNonEmptyFile("Unpacked Simplified Chinese OCR traineddata", ["release", "win-unpacked", "resources", "ocr", "chi_sim.traineddata"]));

for (const artifact of checkedFiles.filter((item) => item.path.startsWith(path.join(rootDir, "release")) && item.path !== path.join(rootDir, "release", "win-unpacked", `${productName}.exe`))) {
  if (path.basename(artifact.path).includes(".traineddata")) continue;
  if (path.basename(artifact.path) === "builder-debug.yml") continue;
  assert(
    path.basename(artifact.path).includes(`-${version}-`),
    `${artifact.label} file name does not match package.json version ${version}: ${displayPath(artifact.path)}`,
  );
}

const zip = await JSZip.loadAsync(await readFile(zipArtifact.path));
const requiredZipEntries = [
  `${productName}.exe`,
  "resources/ocr/eng.traineddata",
  "resources/ocr/chi_sim.traineddata",
  "resources/app/package.json",
];

for (const entryName of requiredZipEntries) {
  assert(zip.file(entryName), `Zip artifact ${displayPath(zipArtifact.path)} does not list required entry: ${entryName}`);
}

const packagedPackageEntry = zip.file("resources/app/package.json");
assert(packagedPackageEntry, "Zip artifact does not include resources/app/package.json.");
const packagedPackageJson = JSON.parse(await packagedPackageEntry.async("string")) as PackageJson;
assert(
  packagedPackageJson.version === version,
  `Packaged app version ${packagedPackageJson.version ?? "(missing)"} does not match package.json version ${version}.`,
);

console.log(JSON.stringify({
  ok: true,
  version,
  productName,
  artifacts: checkedFiles.map((file) => ({
    label: file.label,
    path: displayPath(file.path),
    bytes: file.bytes,
  })),
  zipEntries: requiredZipEntries,
}, null, 2));
