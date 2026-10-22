import { describe, expect, it } from "vitest";
import { fmtBytes } from "./bytes";

describe("fmtBytes", () => {
  it("shows a short size in the unit a person reads", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(1023)).toBe("1023 B");
    expect(fmtBytes(1024)).toBe("1.0 KB");
    expect(fmtBytes(1536)).toBe("1.5 KB");
    expect(fmtBytes(21 * 1024 * 1024)).toBe("21.0 MB");
    expect(fmtBytes(466 * 1024 * 1024)).toBe("466 MB");
    expect(fmtBytes(3 * 1024 ** 3)).toBe("3.0 GB");
  });

  it("moves up a unit instead of showing 1024 of the one below", () => {
    expect(fmtBytes(1024 * 1024 - 1)).toBe("1.0 MB");
    expect(fmtBytes(1024 ** 3 - 1)).toBe("1.0 GB");
  });
});
