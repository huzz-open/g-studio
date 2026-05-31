import type { Peering, SubTileCoord } from '../types'

type Quadrant = 'tl' | 'tr' | 'bl' | 'br'

/** Special marker indicating the inner corner tile should be used */
export const INNER_CORNER_TL: SubTileCoord = { row: -1, col: 0 }
export const INNER_CORNER_TR: SubTileCoord = { row: -1, col: 1 }
export const INNER_CORNER_BL: SubTileCoord = { row: -1, col: 2 }
export const INNER_CORNER_BR: SubTileCoord = { row: -1, col: 3 }

/**
 * Get the sub-tile coordinate for a given quadrant and peering state.
 *
 * Edge branches use fixed center-region coordinates (semantically correct texture).
 * Interior (default) branches use adjacency-aware coordinates to prevent seams
 * between quadrants within large terrain blocks.
 */
export function getSubTileForQuadrant(quadrant: Quadrant, peering: Peering): SubTileCoord {
  const T = peering[0] === 0
  const TR_d = peering[1] === 0
  const R = peering[2] === 0
  const BR_d = peering[3] === 0
  const B = peering[4] === 0
  const BL_d = peering[5] === 0
  const L = peering[6] === 0
  const TL_d = peering[7] === 0

  switch (quadrant) {
    case 'tl':
      if (!T && !L) return { row: 0, col: 0 }
      if (!T && L) return { row: 0, col: 2 }
      if (T && !L) return { row: 2, col: 0 }
      if (T && L && !TL_d) return INNER_CORNER_TL
      return { row: B ? 2 : 4, col: R ? 2 : 4 }

    case 'tr':
      if (!T && !R) return { row: 0, col: 5 }
      if (!T && R) return { row: 0, col: 3 }
      if (T && !R) return { row: 2, col: 5 }
      if (T && R && !TR_d) return INNER_CORNER_TR
      return { row: B ? 2 : 4, col: L ? 3 : 1 }

    case 'bl':
      if (!B && !L) return { row: 5, col: 0 }
      if (!B && L) return { row: 5, col: 2 }
      if (B && !L) return { row: 3, col: 0 }
      if (B && L && !BL_d) return INNER_CORNER_BL
      return { row: T ? 3 : 1, col: R ? 2 : 4 }

    case 'br':
      if (!B && !R) return { row: 5, col: 5 }
      if (!B && R) return { row: 5, col: 3 }
      if (B && !R) return { row: 3, col: 5 }
      if (B && R && !BR_d) return INNER_CORNER_BR
      return { row: T ? 3 : 1, col: L ? 3 : 1 }
  }
}

export function isInnerCorner(coord: SubTileCoord): boolean {
  return coord.row === -1
}
