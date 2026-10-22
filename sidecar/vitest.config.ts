import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests never download anything on their own; the live ones opt in (MEMOTION_LIVE_TESTS=1) and say so.
    env: { MEMOTION_NO_VENDOR_DOWNLOAD: "1" },
  },
});
