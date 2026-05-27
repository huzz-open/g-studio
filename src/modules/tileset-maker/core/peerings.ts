import type { Peering } from './types'

export const TILE_PEERINGS: Peering[] = [
  /*  0 */ [-1, -1, -1, -1, -1, -1, -1, -1],
  /*  1 */ [-1, -1, -1, -1, -1, -1,  0, -1],
  /*  2 */ [-1, -1, -1, -1,  0, -1, -1, -1],
  /*  3 */ [-1, -1, -1, -1,  0, -1,  0, -1],
  /*  4 */ [-1, -1, -1, -1,  0,  0,  0, -1],
  /*  5 */ [-1, -1,  0, -1, -1, -1, -1, -1],
  /*  6 */ [-1, -1,  0, -1, -1, -1,  0, -1],
  /*  7 */ [-1, -1,  0, -1,  0, -1, -1, -1],
  /*  8 */ [-1, -1,  0,  0,  0, -1, -1, -1],
  /*  9 */ [-1, -1,  0, -1,  0, -1,  0, -1],
  /* 10 */ [-1, -1,  0,  0,  0, -1,  0, -1],
  /* 11 */ [-1, -1,  0, -1,  0,  0,  0, -1],
  /* 12 */ [-1, -1,  0,  0,  0,  0,  0, -1],
  /* 13 */ [ 0, -1, -1, -1, -1, -1, -1, -1],
  /* 14 */ [ 0, -1, -1, -1, -1, -1,  0, -1],
  /* 15 */ [ 0, -1, -1, -1, -1, -1,  0,  0],
  /* 16 */ [ 0, -1, -1, -1,  0, -1, -1, -1],
  /* 17 */ [ 0, -1, -1, -1,  0, -1,  0, -1],
  /* 18 */ [ 0, -1, -1, -1,  0,  0,  0, -1],
  /* 19 */ [ 0, -1, -1, -1,  0, -1,  0,  0],
  /* 20 */ [ 0, -1, -1, -1,  0,  0,  0,  0],
  /* 21 */ [ 0, -1,  0, -1, -1, -1, -1, -1],
  /* 22 */ [ 0,  0,  0, -1, -1, -1, -1, -1],
  /* 23 */ [ 0, -1,  0, -1, -1, -1,  0, -1],
  /* 24 */ [ 0,  0,  0, -1, -1, -1,  0, -1],
  /* 25 */ [ 0, -1,  0, -1, -1, -1,  0,  0],
  /* 26 */ [ 0,  0,  0, -1, -1, -1,  0,  0],
  /* 27 */ [ 0, -1,  0, -1,  0, -1, -1, -1],
  /* 28 */ [ 0,  0,  0, -1,  0, -1, -1, -1],
  /* 29 */ [ 0, -1,  0,  0,  0, -1, -1, -1],
  /* 30 */ [ 0,  0,  0,  0,  0, -1, -1, -1],
  /* 31 */ [ 0, -1,  0, -1,  0, -1,  0, -1],
  /* 32 */ [ 0,  0,  0, -1,  0, -1,  0, -1],
  /* 33 */ [ 0, -1,  0,  0,  0, -1,  0, -1],
  /* 34 */ [ 0,  0,  0,  0,  0, -1,  0, -1],
  /* 35 */ [ 0, -1,  0, -1,  0,  0,  0, -1],
  /* 36 */ [ 0,  0,  0, -1,  0,  0,  0, -1],
  /* 37 */ [ 0, -1,  0,  0,  0,  0,  0, -1],
  /* 38 */ [ 0,  0,  0,  0,  0,  0,  0, -1],
  /* 39 */ [ 0, -1,  0, -1,  0, -1,  0,  0],
  /* 40 */ [ 0,  0,  0, -1,  0, -1,  0,  0],
  /* 41 */ [ 0, -1,  0,  0,  0, -1,  0,  0],
  /* 42 */ [ 0,  0,  0,  0,  0, -1,  0,  0],
  /* 43 */ [ 0, -1,  0, -1,  0,  0,  0,  0],
  /* 44 */ [ 0,  0,  0, -1,  0,  0,  0,  0],
  /* 45 */ [ 0, -1,  0,  0,  0,  0,  0,  0],
  /* 46 */ [ 0,  0,  0,  0,  0,  0,  0,  0],
]

/**
 * Convert peering array to 8-bit bitmask.
 * Bit layout: NW=1, N=2, NE=4, W=8, E=16, SW=32, S=64, SE=128
 * Peering index: [T=N, TR=NE, R=E, BR=SE, B=S, BL=SW, L=W, TL=NW]
 */
export function peeringToBitmask(p: Peering): number {
  let mask = 0
  if (p[0] === 0) mask |= 2    // T → N
  if (p[1] === 0) mask |= 4    // TR → NE
  if (p[2] === 0) mask |= 16   // R → E
  if (p[3] === 0) mask |= 128  // BR → SE
  if (p[4] === 0) mask |= 64   // B → S
  if (p[5] === 0) mask |= 32   // BL → SW
  if (p[6] === 0) mask |= 8    // L → W
  if (p[7] === 0) mask |= 1    // TL → NW
  return mask
}

/** Convert 8-bit bitmask back to peering array */
export function bitmaskToPeering(mask: number): Peering {
  return [
    (mask & 2) ? 0 : -1,    // T ← N
    (mask & 4) ? 0 : -1,    // TR ← NE
    (mask & 16) ? 0 : -1,   // R ← E
    (mask & 128) ? 0 : -1,  // BR ← SE
    (mask & 64) ? 0 : -1,   // B ← S
    (mask & 32) ? 0 : -1,   // BL ← SW
    (mask & 8) ? 0 : -1,    // L ← W
    (mask & 1) ? 0 : -1,    // TL ← NW
  ]
}

/** Build a lookup map from peering (as bitmask) to atlas position */
export function buildPeeringLookup(
  layout: { tiles: Array<{ col: number; row: number; peeringIndex: number }> }
): Map<number, { col: number; row: number }> {
  const map = new Map<number, { col: number; row: number }>()
  for (const tile of layout.tiles) {
    const mask = peeringToBitmask(TILE_PEERINGS[tile.peeringIndex])
    map.set(mask, { col: tile.col, row: tile.row })
  }
  return map
}
