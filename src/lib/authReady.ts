let cachedToken: string | null = null;
let cachedLoading = true;
let readyPromise: Promise<string | null> | null = null;
let readyResolve: ((token: string | null) => void) | null = null;

export function updateAuthReadyState(token: string | null, isLoading: boolean) {
  cachedToken = token;
  cachedLoading = isLoading;

  if (!isLoading && readyResolve) {
    readyResolve(token);
    readyResolve = null;
    readyPromise = null;
  }
}

export function waitForAuthReady(): Promise<string | null> {
  if (!cachedLoading) return Promise.resolve(cachedToken);
  if (readyPromise) return readyPromise;

  readyPromise = new Promise((resolve) => {
    readyResolve = resolve;
  });
  return readyPromise;
}

export async function getBearerTokenOrThrow(): Promise<string> {
  const token = cachedToken ?? (await waitForAuthReady());
  if (!token) throw new Error("Not authenticated");
  return token;
}

