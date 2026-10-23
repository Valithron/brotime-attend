import { clearSessionCookie, redirect } from "../_lib/auth.js";

export async function onRequest({ request }) {
  return redirect(new URL("/", request.url).toString(), { "set-cookie": clearSessionCookie(), "cache-control": "no-store" });
}
