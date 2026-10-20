// Remove the per-node "extras" blocks that the LEGONRUSH export embeds in the
// campus GLBs (culling data for the parent game, unused here). They make up
// about three quarters of each file. Usage: node tools/strip_glb_extras.mjs in.glb out.glb
import { readFileSync, writeFileSync } from 'node:fs';

const [source, target] = process.argv.slice(2);
const input = readFileSync(source);
const jsonLength = input.readUInt32LE(12);
const json = JSON.parse(input.subarray(20, 20 + jsonLength).toString());
for (const node of json.nodes || []) delete node.extras;
delete json.extras;
let text = JSON.stringify(json);
while (Buffer.byteLength(text) % 4) text += ' ';
const jsonChunk = Buffer.from(text);
const rest = input.subarray(20 + jsonLength); // the binary chunk, unchanged
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + jsonChunk.length + rest.length, 8);
header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
writeFileSync(target, Buffer.concat([header, jsonChunk, rest]));
console.log(`${source}: ${(input.length / 1048576).toFixed(2)} MB -> ${target}: ${((20 + jsonChunk.length + rest.length) / 1048576).toFixed(2)} MB`);
