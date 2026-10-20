import { indemnificationProxy } from "@/lib/server/indemnificationProxy";
export const runtime = "nodejs";
export function GET() { return indemnificationProxy({ path: "/v1/capabilities", method: "GET" }); }
