import { it, expect } from "vitest";
import { createServer } from "node:http";
import { aliasMiddleware, parseAliases, requestXml } from "./radioreference";

const xml = `<Envelope><Body><getTrsTalkgroupsResponse><return><item href="#group1"/></return></getTrsTalkgroupsResponse><multiRef id="group1"><tgDec>6620</tgDec><tgAlpha href="#name1"/><tgDescr>Dispatch</tgDescr></multiRef><multiRef id="name1">Kanabec &amp; Test</multiRef></Body></Envelope>`;
it("parses SOAP multiRef aliases and rejects faults/entities", () => {
  expect(parseAliases(xml)).toEqual([
    {
      id: 6620,
      name: "Kanabec & Test",
      group: "ARMER",
      origin: "radioreference",
    },
  ]);
  expect(() =>
    parseAliases(
      "<Envelope><Fault><faultstring>secret echo</faultstring></Fault></Envelope>",
    ),
  ).toThrow("RadioReference rejected");
  expect(() => parseAliases("<!DOCTYPE a><Envelope/>")).toThrow();
  expect(requestXml("a&b", "<secret>", 'key"')).toContain(
    "<username>a&amp;b</username><password>&lt;secret&gt;</password><appKey>key&quot;</appKey>",
  );
});
it("keeps credentials in a fixed HTTPS server request, refusing cross-origin calls", async () => {
  let upstream = "",
    body = "",
    calls = 0;
  const middleware = aliasMiddleware("server-only", (async (url, options) => {
    upstream = String(url);
    body = String(options?.body);
    calls++;
    return new Response(xml);
  }) as typeof fetch);
  const server = createServer((req, res) => {
    void middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No server address");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const status = await fetch(`${base}/api/armer/aliases`);
    expect(await status.json()).toEqual({ configured: true });
    const options = {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "user", password: "secret" }),
    };
    const blocked = await fetch(`${base}/api/armer/aliases`, {
      ...options,
      headers: { ...options.headers, Origin: "https://evil.test" },
    });
    expect(blocked.status).toBe(403);
    expect(calls).toBe(0);
    const response = await fetch(`${base}/api/armer/aliases`, options);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.rules).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain("secret");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(upstream).toBe("https://api.radioreference.com/soap2/index.php");
    expect(body).toContain('<sid xsi:type="xsd:int">3508</sid>');
    expect(body).toContain("<appKey>server-only</appKey>");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
