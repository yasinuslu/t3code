import { describe, expect, it } from "vite-plus/test";

import { seedWindowStorage } from "./windowStorage";

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
}

describe("seedWindowStorage", () => {
  it("starts a profile window from the app's state, then keeps the two apart", () => {
    const base = new MemoryStorage();
    base.setItem("theme", "dark");
    const yu = seedWindowStorage(base, "yu");
    const sn = seedWindowStorage(base, "sn");
    expect(yu.getItem("theme")).toBe("dark");

    yu.setItem("theme", "light");
    sn.setItem("sidebar", "closed");
    expect(base.getItem("theme")).toBe("dark");
    expect(sn.getItem("theme")).toBe("dark");
    expect(yu.getItem("sidebar")).toBeNull();
    expect(yu.length).toBe(1);

    // Seeding happens once: reopening keeps the window's own state.
    base.setItem("theme", "contrast");
    expect(seedWindowStorage(base, "yu").getItem("theme")).toBe("light");

    yu.clear();
    expect(yu.length).toBe(0);
    expect(sn.getItem("sidebar")).toBe("closed");
  });
});
