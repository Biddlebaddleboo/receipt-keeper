import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

if (!window.crypto.randomUUID) {
  let testUUIDCounter = 0;
  Object.defineProperty(window.crypto, "randomUUID", {
    value: () => `00000000-0000-4000-8000-${String(++testUUIDCounter).padStart(12, "0")}`,
  });
}

if (!URL.createObjectURL) {
  Object.defineProperty(URL, "createObjectURL", {
    value: () => "blob:test",
  });
}

if (!URL.revokeObjectURL) {
  Object.defineProperty(URL, "revokeObjectURL", {
    value: () => undefined,
  });
}
