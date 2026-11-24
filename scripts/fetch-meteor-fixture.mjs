import fs from "node:fs/promises";
import crypto from "node:crypto";
const file = new URL("../fixtures/meteor_m2_72k.wav", import.meta.url);
let data;
try {
  data = await fs.readFile(file);
} catch {
  const response = await fetch(
    "https://raw.githubusercontent.com/lar-tech/satellite-decoder/043619baa2456623554e54e067706086b6ecbf78/data/meteor_m2_72k.wav",
  );
  if (!response.ok) throw Error(`Fixture download: HTTP ${response.status}`);
  data = Buffer.from(await response.arrayBuffer());
}
if (
  crypto.createHash("sha256").update(data).digest("hex") !==
  "c8be339e69db2b192f852c8ab5d2cb7c7b547552bab41fadd584e0296df0cdf8"
)
  throw Error("Real IQ fixture checksum mismatch");
await fs.mkdir(new URL("../fixtures/", import.meta.url), { recursive: true });
await fs.writeFile(file, data);
console.log(`Verified real IQ fixture: ${data.length} bytes.`);
