import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, "../static/sw-register.js");
const script = fs.readFileSync(scriptPath, "utf8");

describe("sw-register", () => {
  it("registers the service worker on window load", () => {
    const register = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, "serviceWorker", {
      value: { register },
      configurable: true
    });

    window.eval(script);
    window.dispatchEvent(new Event("load"));

    expect(register).toHaveBeenCalledWith("/sw.js");
  });
});
