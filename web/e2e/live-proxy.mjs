#!/usr/bin/env node
/**
 * Relais TCP de test entre le navigateur et le service d'écoute (`aqr live-serve`) : il laisse tout
 * passer, et sait COUPER les connexions en cours sans trame de fermeture (comme un réseau qui tombe),
 * puis refuser les nouvelles pendant un temps donné. Sert à prouver, dans un vrai navigateur, la
 * coupure et la reprise de l'écran « En direct ». Jamais utilisé en production.
 *
 *   node e2e/live-proxy.mjs                      (écoute 127.0.0.1:8766 -> 127.0.0.1:8765, contrôle sur 8767)
 *   curl -X POST "http://127.0.0.1:8767/cut?block_ms=9000"   coupe tout et refuse 9 s
 *   curl "http://127.0.0.1:8767/state"                          connexions ouvertes
 *   curl -X POST --data '{"schema":"aqr.live/1","type":"DEGRADED",...}' http://127.0.0.1:8767/inject
 *
 * Variables : AQR_PROXY_LISTEN (8766), AQR_PROXY_TARGET (8765), AQR_PROXY_CONTROL (8767).
 */
import http from "node:http";
import net from "node:net";

const listen = Number(process.env.AQR_PROXY_LISTEN || 8766);
const target = Number(process.env.AQR_PROXY_TARGET || 8765);
const control = Number(process.env.AQR_PROXY_CONTROL || 8767);
const open = new Set();
let blockedUntil = 0;
let accepted = 0;
let refused = 0;

const server = net.createServer((client) => {
  if (Date.now() < blockedUntil) {
    refused += 1;
    client.destroy();
    return;
  }
  accepted += 1;
  const upstream = net.connect(target, "127.0.0.1");
  const pair = { client, upstream };
  open.add(pair);
  const done = () => {
    open.delete(pair);
    client.destroy();
    upstream.destroy();
  };
  client.pipe(upstream);
  upstream.pipe(client);
  client.on("error", done).on("close", done);
  upstream.on("error", done).on("close", done);
});
server.listen(listen, "127.0.0.1");

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/cut") {
      blockedUntil = Date.now() + Number(url.searchParams.get("block_ms") || 0);
      const n = open.size;
      // RST sans fermeture propre : le navigateur voit une coupure, pas une fin de flux.
      for (const { client, upstream } of open) {
        client.resetAndDestroy?.();
        client.destroy();
        upstream.destroy();
      }
      open.clear();
      res.end(JSON.stringify({ cut: n, blocked_until: blockedUntil }));
      return;
    }
    if (url.pathname === "/inject" && req.method === "POST") {
      // Injecte UN message texte du service (trame WebSocket serveur -> client, non masquée) dans la
      // connexion la plus récente. Sert à éprouver dans un vrai navigateur ce que le service ne sait pas
      // encore émettre (REVISION, DEGRADED) : à faire entre deux messages réels, avec `seq: 0`
      // (hors flux : ni rejoué ni compté), et à présenter comme injecté, jamais comme une sortie du moteur.
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const payload = Buffer.concat(chunks);
        const last = [...open].pop();
        if (!last || payload.length > 65535) {
          res.statusCode = 409;
          res.end(JSON.stringify({ injected: false }));
          return;
        }
        const head =
          payload.length < 126
            ? Buffer.from([0x81, payload.length])
            : Buffer.from([
                0x81,
                126,
                payload.length >> 8,
                payload.length & 255,
              ]);
        last.client.write(Buffer.concat([head, payload]));
        res.end(JSON.stringify({ injected: true, bytes: payload.length }));
      });
      return;
    }
    res.end(
      JSON.stringify({
        open: open.size,
        accepted,
        refused,
        blocked: Date.now() < blockedUntil,
      }),
    );
  })
  .listen(control, "127.0.0.1");

process.stdout.write(`proxy ${listen} -> ${target}, contrôle ${control}\n`);
