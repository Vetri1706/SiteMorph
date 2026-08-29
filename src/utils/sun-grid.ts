export interface DecodedSunGrid {
  hours: number[];
  grid: Float32Array;
  mask: Uint8Array;
  note: string;
}

export function decodeSunGroundGrid(
  grid: Float32Array | Uint8Array,
  mask: Uint8Array | undefined,
  sunPositionsPerHour: number | undefined,
): DecodedSunGrid {
  const encodedSamples = grid instanceof Uint8Array;
  if (encodedSamples && (!sunPositionsPerHour || !Number.isFinite(sunPositionsPerHour) || sunPositionsPerHour <= 0)) {
    throw new Error("Forma returned encoded Sun samples without a valid samples-per-hour value.");
  }
  if (mask && mask.length !== grid.length) {
    throw new Error("Forma returned a ground Sun mask that does not match the grid shape.");
  }

  const hours: number[] = [];
  const decodedGrid = new Float32Array(grid.length);
  decodedGrid.fill(Number.NaN);
  const decodedMask = new Uint8Array(grid.length);
  for (let index = 0; index < grid.length; index += 1) {
    if (mask && mask[index] === 0) continue;
    const raw = grid[index];
    if (!Number.isFinite(raw)) continue;
    const value = encodedSamples ? raw / sunPositionsPerHour! : raw;
    if (value < 0 || value > 24) {
      throw new Error(`Forma returned an implausible daily Sun value (${value.toFixed(2)} h).`);
    }
    decodedGrid[index] = value;
    decodedMask[index] = 1;
    hours.push(value);
  }
  if (!hours.length) throw new Error("Forma returned no valid ground Sun samples.");
  return {
    hours,
    grid: decodedGrid,
    mask: decodedMask,
    note: encodedSamples
      ? `Forma Uint8 Sun samples decoded using ${sunPositionsPerHour} positions per hour.`
      : "Forma Float32 Sun grid read directly in exposure hours.",
  };
}
