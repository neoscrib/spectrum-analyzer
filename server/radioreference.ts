import { DOMParser } from "@xmldom/xmldom";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { TalkgroupRule } from "../src/armer/model";

const escapeXml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
export function requestXml(username: string, password: string, key: string) {
  return `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:rr="http://api.radioreference.com/soap2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" soap:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><soap:Body><rr:getTrsTalkgroups><sid xsi:type="xsd:int">3508</sid><tgCid xsi:type="xsd:int">0</tgCid><tgTag xsi:type="xsd:int">0</tgTag><tgDec xsi:type="xsd:int">0</tgDec><authInfo xsi:type="rr:authInfo"><username>${escapeXml(username)}</username><password>${escapeXml(password)}</password><appKey>${escapeXml(key)}</appKey><version>17</version><style>rpc</style></authInfo></rr:getTrsTalkgroups></soap:Body></soap:Envelope>`;
}
export function parseAliases(xml: string): TalkgroupRule[] {
  if (xml.length > 4 * 1024 * 1024 || /<!\s*(DOCTYPE|ENTITY)\b/i.test(xml))
    throw Error("Invalid directory response.");
  const doc = new DOMParser({
    onError: () => {
      throw Error("Invalid directory response.");
    },
  }).parseFromString(xml, "text/xml");
  const elements = Array.from(doc.getElementsByTagName("*"));
  if (elements.some((e) => e.localName === "Fault"))
    throw Error(
      "RadioReference rejected the request. Check your Premium login and application key.",
    );
  const byId = new Map(
    elements
      .filter((e) => e.hasAttribute("id"))
      .map((e) => [e.getAttribute("id"), e]),
  );
  const value = (e: (typeof elements)[number]) => {
    const ref = e.getAttribute("href");
    return (
      (ref?.startsWith("#") ? byId.get(ref.slice(1)) : e)?.textContent ?? ""
    );
  };
  const rules = new Map<number, TalkgroupRule>();
  for (const element of elements) {
    const fields = Array.from(element.childNodes).filter(
      (n) => n.nodeType === 1,
    ) as typeof elements;
    const field = (name: string) => fields.find((e) => e.localName === name);
    const dec = field("tgDec");
    if (!dec) continue;
    const id = Number(value(dec));
    if (!Number.isInteger(id) || id < 1 || id > 65535) continue;
    const alpha = field("tgAlpha"),
      description = field("tgDescr");
    const name = (
      alpha
        ? value(alpha)
        : description
          ? value(description)
          : `Talkgroup ${id}`
    ).slice(0, 240);
    rules.set(id, { id, name, group: "ARMER", origin: "radioreference" });
  }
  if (!rules.size || rules.size > 10000)
    throw Error("RadioReference returned no usable ARMER talkgroups.");
  return [...rules.values()];
}
export function aliasMiddleware(key: string, fetcher: typeof fetch = fetch) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    if (req.url?.split("?")[0] !== "/api/armer/aliases") {
      next();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    const send = (status: number, data: unknown) => {
      res.statusCode = status;
      res.end(JSON.stringify(data));
    };
    if (req.method === "GET") {
      send(200, { configured: !!key });
      return;
    }
    if (req.method !== "POST") {
      send(405, { error: "Use GET or POST." });
      return;
    }
    const origin = req.headers.origin;
    let sameOrigin = false;
    try {
      sameOrigin = !!origin && new URL(origin).host === req.headers.host;
    } catch {
      /* Invalid origins are rejected. */
    }
    if (!sameOrigin || req.headers["sec-fetch-site"] === "cross-site") {
      send(403, { error: "Use the local app to request aliases." });
      return;
    }
    if (!key) {
      send(503, {
        error:
          "Set RR_APP_KEY in .env.local and restart the server. RadioReference requires an approved application key and a Premium account.",
      });
      return;
    }
    if (!req.headers["content-type"]?.startsWith("application/json")) {
      send(415, { error: "Expected JSON." });
      return;
    }
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 16384) throw Error("Request too large.");
      }
      const credentials = JSON.parse(body);
      const { username, password } = credentials;
      if (
        typeof username !== "string" ||
        typeof password !== "string" ||
        !username ||
        !password ||
        username.length > 240 ||
        password.length > 1000
      )
        throw Error("Enter your RadioReference username and password.");
      const response = await fetcher(
        "https://api.radioreference.com/soap2/index.php",
        {
          method: "POST",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            SOAPAction:
              '"http://api.radioreference.com/soap2#getTrsTalkgroups"',
          },
          body: requestXml(username, password, key),
          signal: AbortSignal.timeout(20000),
          redirect: "error",
        },
      );
      if (!response.ok)
        throw Error(
          "RadioReference is unavailable or rejected authentication.",
        );
      const reader = response.body?.getReader();
      if (!reader) throw Error("Empty directory response.");
      let bytes = 0;
      const parts: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 4 * 1024 * 1024) {
          await reader.cancel();
          throw Error("Directory response too large.");
        }
        parts.push(value);
      }
      const text = new TextDecoder();
      const xml =
        parts.map((p) => text.decode(p, { stream: true })).join("") +
        text.decode();
      send(200, { rules: parseAliases(xml), system: 3508 });
    } catch (error) {
      // Never forward upstream bodies or exception details that could echo credentials.
      const message =
        error instanceof Error &&
        /^(RadioReference |Enter your |Request too large|Directory response too large|Invalid directory response)/.test(
          error.message,
        )
          ? error.message
          : "Alias lookup failed. Check the server connection and RadioReference account.";
      send(400, { error: message });
    }
  };
}
export function radioReferencePlugin(key: string): Plugin {
  const middleware = aliasMiddleware(key);
  return {
    name: "armer-alias-directory",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
