import type { Peering, SubTileCoord } from '../types'

type Quadrant = 'tl' | 'tr' | 'bl' | 'br'

/**
 * Get the sub-tile coordinate for a given quadrant and peering state.
 * Each output tile is composed of 4 quadrants; this function determines
 * which sub-tile (from the 6x6 grid) to use for each quadrant.
 */
export function getSubTileForQuadrant(quadrant: Quadrant, peering: Peering): SubTileCoord {
  const T = peering[0] === 0
  const TR = peering[1] === 0
  const R = peering[2] === 0
  const BR = peering[3] === 0
  const B = peering[4] === 0
  const BL = peering[5] === 0
  const L = peering[6] === 0
  const TL = peering[7] === 0

  switch (quadrant) {
    case 'tl':
      if (!T && !L) return { row: 1, col: 1 }
      if (T && !L) return { row: 2, col: 1 }
      if (!T && L) return { row: 1, col: 2 }
      if (T && L && !TL) return { row: 4, col: 4 }
      return { row: 2, col: 2 }

    case 'tr':
      if (!T && !R) return { row: 1, col: 4 }
      if (T && !R) return { row: 2, col: 4 }
      if (!T && R) return { row: 1, col: 3 }
      if (T && R && !TR) return { row: 4, col: 1 }
      return { row: 2, col: 3 }

    case 'bl':
      if (!B && !L) return { row: 4, col: 1 }
      if (B && !L) return { row: 3, col: 1 }
      if (!B && L) return { row: 4, col: 2 }
      if (B && L && !BL) return { row: 1, col: 4 }
      return { row: 3, col: 2 }

    case 'br':
      if (!B && !R) return { row: 4, col: 4 }
      if (B && !R) return { row: 3, col: 4 }
      if (!B && R) return { row: 4, col: 3 }
      if (B && R && !BR) return { row: 1, col: 1 }
      return { row: 3, col: 3 }
  }
}
