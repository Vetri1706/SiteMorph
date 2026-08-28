function wordHash(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
    hash ^= hash >>> 13;
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  return (hash ^ (hash >>> 13)) >>> 0;
}

class StableWorkerHash {
  private input = "";

  update(value: string | ArrayBufferView): this {
    this.input += typeof value === "string" ? value : String(value);
    return this;
  }

  digest(encoding: "hex"): string {
    if (encoding !== "hex") throw new Error("SiteMorph worker cache hashes support hex output only");
    const seeds = [0x811c9dc5, 0x9e3779b1, 0x85ebca77, 0xc2b2ae3d, 0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5];
    return seeds.map((seed) => wordHash(this.input, seed).toString(16).padStart(8, "0")).join("");
  }
}

export function createHash(_algorithm: string): StableWorkerHash {
  return new StableWorkerHash();
}
