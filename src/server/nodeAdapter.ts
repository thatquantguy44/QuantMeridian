/**
 * Adapters between Node's `http` primitives and the Web `Request`/`Response`
 * objects the route handlers speak. Shared by the dev-server middleware and the
 * standalone production server so both convert requests/responses identically.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function toWebRequest(req: IncomingMessage, url: URL, body?: Buffer): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (typeof value === "string") headers.set(key, value);
  }
  const method = (req.method ?? "GET").toUpperCase();
  const hasBody = body && body.length > 0 && method !== "GET" && method !== "HEAD";
  return new Request(url.toString(), {
    method,
    headers,
    ...(hasBody ? { body, duplex: "half" } : {}),
  } as RequestInit);
}

export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!res.hasHeader("content-length")) res.setHeader("content-length", String(buffer.byteLength));
  await new Promise<void>((resolve, reject) => {
    res.once("error", reject);
    res.end(buffer, () => {
      res.off("error", reject);
      resolve();
    });
  });
}
