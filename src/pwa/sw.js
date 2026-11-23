import { PrecacheController, PrecacheRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { clientsClaim } from "workbox-core";

// vite-plugin-pwa injects every built dependency, including lazy WASM/worker
// chunks. Workbox owns revision keys, incremental downloads and stale cleanup.
const precache = new PrecacheController({ cacheName: "spectrum-precache-v1" });
precache.addToCacheList(self.__WB_MANIFEST);
self.addEventListener("install", (event) => precache.install(event));
self.addEventListener("activate", (event) => precache.activate(event));
clientsClaim();
registerRoute(new PrecacheRoute(precache));
registerRoute(
  new NavigationRoute(precache.createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//],
  }),
);

async function status() {
  const saved = new Set(
    (await (await caches.open(precache.strategy.cacheName)).keys()).map(
      (request) => request.url,
    ),
  );
  const keys = [...precache.getURLsToCacheKeys().values()];
  return { ready: keys.every((key) => saved.has(key)), files: keys.length };
}
// Only application-specific coordination remains here. No automatic reloads,
// runtime API caches, or cache entries for captured IQ/credentials.
self.addEventListener("message", (event) => {
  const respond = (data) => event.ports[0]?.postMessage(data);
  event.waitUntil(
    (async () => {
      try {
        switch (event.data?.type) {
          case "STATUS":
            respond(await status());
            break;
          case "SAVE_OFFLINE":
            await precache.install(event);
            respond(await status());
            break;
          case "APPLY_UPDATE": {
            const windows = await self.clients.matchAll({
              type: "window",
              includeUncontrolled: true,
            });
            if (windows.length > 1) {
              respond({
                error: "Close other Spectrum windows before updating.",
              });
              return;
            }
            respond({ ok: true });
            await self.skipWaiting();
            break;
          }
        }
      } catch {
        respond({
          error:
            "Offline files could not be saved. Check your connection and available storage, then retry.",
        });
      }
    })(),
  );
});
