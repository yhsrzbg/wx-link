import { readFile, rm, writeFile } from "node:fs/promises";
import JavaScriptObfuscator from "javascript-obfuscator";

const entryFile = new URL("../dist/index.js", import.meta.url);
const sourceMapFile = new URL("../dist/index.js.map", import.meta.url);
const source = await readFile(entryFile, "utf8");

const result = JavaScriptObfuscator.obfuscate(source, {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  identifierNamesGenerator: "hexadecimal",
  ignoreImports: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  sourceMap: false,
  splitStrings: false,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.8,
  target: "node",
  transformObjectKeys: false,
  unicodeEscapeSequence: false
});

await writeFile(entryFile, result.getObfuscatedCode(), "utf8");
await rm(sourceMapFile, { force: true });
