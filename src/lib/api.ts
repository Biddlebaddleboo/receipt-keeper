import { getBearerTokenOrThrow } from "@/lib/authReady";

export async function apiFetch(path: string, init: RequestInit = {}) {
  const token = await getBearerTokenOrThrow();

  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  const body = init.body;
  const hasBody = body !== undefined && body !== null;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  if (hasBody && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });
  if (response.status === 401) throw new Error("Unauthorized");
  return response;
}

