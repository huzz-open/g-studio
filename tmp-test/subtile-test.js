// === PEERINGS: 47 种 8-邻居连接状态 ===
// [T, TR, R, BR, B, BL, L, TL], 0=connected, -1=not
const TILE_PEERINGS = [
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
];

// === LAYOUTS ===
const LAYOUT_8x6 = {
  name: '8x6',
  cols: 8,
  rows: 6,
  tiles: TILE_PEERINGS.map((_, i) => ({
    col: i % 8,
    row: Math.floor(i / 8),
    peeringIndex: i,
  })),
};

const LAYOUT_11x5 = {
  name: '11x5',
  cols: 11,
  rows: 5,
  tiles: [
    { col: 0, row: 0, peeringIndex: 8 },
    { col: 1, row: 0, peeringIndex: 12 },
    { col: 2, row: 0, peeringIndex: 4 },
    { col: 3, row: 0, peeringIndex: 2 },
    { col: 4, row: 0, peeringIndex: 7 },
    { col: 5, row: 0, peeringIndex: 11 },
    { col: 6, row: 0, peeringIndex: 10 },
    { col: 7, row: 0, peeringIndex: 3 },
    { col: 8, row: 0, peeringIndex: 9 },
    { col: 9, row: 0, peeringIndex: 38 },
    { col: 0, row: 1, peeringIndex: 30 },
    { col: 1, row: 1, peeringIndex: 46 },
    { col: 2, row: 1, peeringIndex: 20 },
    { col: 3, row: 1, peeringIndex: 16 },
    { col: 4, row: 1, peeringIndex: 28 },
    { col: 5, row: 1, peeringIndex: 29 },
    { col: 6, row: 1, peeringIndex: 27 },
    { col: 7, row: 1, peeringIndex: 18 },
    { col: 8, row: 1, peeringIndex: 19 },
    { col: 9, row: 1, peeringIndex: 17 },
    { col: 0, row: 2, peeringIndex: 22 },
    { col: 1, row: 2, peeringIndex: 26 },
    { col: 2, row: 2, peeringIndex: 15 },
    { col: 3, row: 2, peeringIndex: 13 },
    { col: 4, row: 2, peeringIndex: 21 },
    { col: 5, row: 2, peeringIndex: 25 },
    { col: 6, row: 2, peeringIndex: 24 },
    { col: 7, row: 2, peeringIndex: 14 },
    { col: 8, row: 2, peeringIndex: 23 },
    { col: 9, row: 2, peeringIndex: 45 },
    { col: 10, row: 2, peeringIndex: 42 },
    { col: 0, row: 3, peeringIndex: 5 },
    { col: 1, row: 3, peeringIndex: 6 },
    { col: 2, row: 3, peeringIndex: 1 },
    { col: 3, row: 3, peeringIndex: 0 },
    { col: 4, row: 3, peeringIndex: 31 },
    { col: 5, row: 3, peeringIndex: 40 },
    { col: 6, row: 3, peeringIndex: 41 },
    { col: 7, row: 3, peeringIndex: 39 },
    { col: 8, row: 3, peeringIndex: 44 },
    { col: 9, row: 3, peeringIndex: 43 },
    { col: 10, row: 3, peeringIndex: 32 },
    { col: 4, row: 4, peeringIndex: 34 },
    { col: 5, row: 4, peeringIndex: 33 },
    { col: 6, row: 4, peeringIndex: 37 },
    { col: 7, row: 4, peeringIndex: 35 },
    { col: 8, row: 4, peeringIndex: 36 },
  ],
};

function getLayout(name) {
  return name === '11x5' ? LAYOUT_11x5 : LAYOUT_8x6;
}

// === MAPPER (full 6x6 grid + inner corners via flip180) ===
const INNER_CORNER_TL = { row: -1, col: 0 };
const INNER_CORNER_TR = { row: -1, col: 1 };
const INNER_CORNER_BL = { row: -1, col: 2 };
const INNER_CORNER_BR = { row: -1, col: 3 };

function getSubTileForQuadrant(quadrant, peering) {
  const T = peering[0] === 0;
  const TR_d = peering[1] === 0;
  const R = peering[2] === 0;
  const BR_d = peering[3] === 0;
  const B = peering[4] === 0;
  const BL_d = peering[5] === 0;
  const L = peering[6] === 0;
  const TL_d = peering[7] === 0;

  switch (quadrant) {
    case 'tl':
      if (!T && !L) return { row: 0, col: 0 };
      if (!T && L) return { row: 0, col: 2 };
      if (T && !L) return { row: 2, col: 0 };
      if (T && L && !TL_d) return INNER_CORNER_TL;
      return { row: B ? 2 : 4, col: R ? 2 : 4 };

    case 'tr':
      if (!T && !R) return { row: 0, col: 5 };
      if (!T && R) return { row: 0, col: 3 };
      if (T && !R) return { row: 2, col: 5 };
      if (T && R && !TR_d) return INNER_CORNER_TR;
      return { row: B ? 2 : 4, col: L ? 3 : 1 };

    case 'bl':
      if (!B && !L) return { row: 5, col: 0 };
      if (!B && L) return { row: 5, col: 2 };
      if (B && !L) return { row: 3, col: 0 };
      if (B && L && !BL_d) return INNER_CORNER_BL;
      return { row: T ? 3 : 1, col: R ? 2 : 4 };

    case 'br':
      if (!B && !R) return { row: 5, col: 5 };
      if (!B && R) return { row: 5, col: 3 };
      if (B && !R) return { row: 3, col: 5 };
      if (B && R && !BR_d) return INNER_CORNER_BR;
      return { row: T ? 3 : 1, col: L ? 3 : 1 };
  }
}

function isInnerCorner(coord) {
  return coord.row === -1;
}

// === SLICER: 切成 6×6 子瓦片 + 4个内角 ===
function flip180(src, w, h) {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = (y * w + x) * 4;
      const dstIdx = ((h - 1 - y) * w + (w - 1 - x)) * 4;
      out[dstIdx] = src[srcIdx];
      out[dstIdx + 1] = src[srcIdx + 1];
      out[dstIdx + 2] = src[srcIdx + 2];
      out[dstIdx + 3] = src[srcIdx + 3];
    }
  }
  return out;
}

function sliceSubTiles(pixels, width, height) {
  if (width % 6 !== 0 || height % 6 !== 0) {
    throw new Error(`Source ${width}×${height} not divisible by 6`);
  }
  const halfW = width / 6;
  const halfH = height / 6;
  const tiles = [];

  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      const tile = new Uint8ClampedArray(halfW * halfH * 4);
      const sx = col * halfW;
      const sy = row * halfH;
      for (let y = 0; y < halfH; y++) {
        const srcOff = ((sy + y) * width + sx) * 4;
        const dstOff = y * halfW * 4;
        tile.set(pixels.subarray(srcOff, srcOff + halfW * 4), dstOff);
      }
      tiles.push(tile);
    }
  }

  const innerCornerTiles = [
    flip180(tiles[0 * 6 + 0], halfW, halfH),  // TL: flip same (row0,col0) → notch at BR of sub-tile
    flip180(tiles[0 * 6 + 5], halfW, halfH),  // TR: flip same (row0,col5) → notch at BL of sub-tile
    flip180(tiles[5 * 6 + 0], halfW, halfH),  // BL: flip same (row5,col0) → notch at TR of sub-tile
    flip180(tiles[5 * 6 + 5], halfW, halfH),  // BR: flip same (row5,col5) → notch at TL of sub-tile
  ];

  return { tiles, innerCornerTiles, halfW, halfH, tileW: halfW * 2, tileH: halfH * 2 };
}

/**
 * Custom slicer: uses non-uniform split positions.
 * xSplits: 7 x-positions [0, x1, x2, x3, x4, x5, width]
 * ySplits: 7 y-positions [0, y1, y2, y3, y4, y5, height]
 * Output tiles are normalized to uniform halfW×halfH via nearest-neighbor scaling.
 */
function sliceSubTilesCustom(pixels, width, height, xSplits, ySplits) {
  const halfW = Math.round(width / 6);
  const halfH = Math.round(height / 6);
  const tiles = [];

  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      const sx = xSplits[col];
      const sy = ySplits[row];
      const sw = xSplits[col + 1] - sx;
      const sh = ySplits[row + 1] - sy;
      const tile = new Uint8ClampedArray(halfW * halfH * 4);

      for (let dy = 0; dy < halfH; dy++) {
        const srcY = Math.min(sy + Math.round(dy * sh / halfH), height - 1);
        for (let dx = 0; dx < halfW; dx++) {
          const srcX = Math.min(sx + Math.round(dx * sw / halfW), width - 1);
          const srcIdx = (srcY * width + srcX) * 4;
          const dstIdx = (dy * halfW + dx) * 4;
          tile[dstIdx] = pixels[srcIdx];
          tile[dstIdx + 1] = pixels[srcIdx + 1];
          tile[dstIdx + 2] = pixels[srcIdx + 2];
          tile[dstIdx + 3] = pixels[srcIdx + 3];
        }
      }
      tiles.push(tile);
    }
  }

  const innerCornerTiles = [
    flip180(tiles[0 * 6 + 0], halfW, halfH),  // TL: flip same (row0,col0)
    flip180(tiles[0 * 6 + 5], halfW, halfH),  // TR: flip same (row0,col5)
    flip180(tiles[5 * 6 + 0], halfW, halfH),  // BL: flip same (row5,col0)
    flip180(tiles[5 * 6 + 5], halfW, halfH),  // BR: flip same (row5,col5)
  ];

  return { tiles, innerCornerTiles, halfW, halfH, tileW: halfW * 2, tileH: halfH * 2 };
}

// === GENERATOR: 组合 47 tile atlas ===
function generateTilesetSubtile(sourcePixels, sourceWidth, sourceHeight, layout, customSplits) {
  const grid = customSplits
    ? sliceSubTilesCustom(sourcePixels, sourceWidth, sourceHeight, customSplits.x, customSplits.y)
    : sliceSubTiles(sourcePixels, sourceWidth, sourceHeight);
  const outW = layout.cols * grid.tileW;
  const outH = layout.rows * grid.tileH;
  const output = new Uint8ClampedArray(outW * outH * 4);

  for (const { col, row, peeringIndex } of layout.tiles) {
    const peering = TILE_PEERINGS[peeringIndex];
    const tl = getSubTileForQuadrant('tl', peering);
    const tr = getSubTileForQuadrant('tr', peering);
    const bl = getSubTileForQuadrant('bl', peering);
    const br = getSubTileForQuadrant('br', peering);

    const dx = col * grid.tileW;
    const dy = row * grid.tileH;

    const getSub = (coord) => {
      if (isInnerCorner(coord)) {
        return grid.innerCornerTiles[coord.col];
      }
      return grid.tiles[coord.row * 6 + coord.col];
    };

    copySubTile(getSub(tl), grid.halfW, grid.halfH, output, outW, dx, dy);
    copySubTile(getSub(tr), grid.halfW, grid.halfH, output, outW, dx + grid.halfW, dy);
    copySubTile(getSub(bl), grid.halfW, grid.halfH, output, outW, dx, dy + grid.halfH);
    copySubTile(getSub(br), grid.halfW, grid.halfH, output, outW, dx + grid.halfW, dy + grid.halfH);
  }

  return { pixels: output, width: outW, height: outH, tileW: grid.tileW, tileH: grid.tileH };
}

function copySubTile(src, halfW, halfH, dst, dstStride, dx, dy) {
  for (let y = 0; y < halfH; y++) {
    const srcOff = y * halfW * 4;
    const dstOff = ((dy + y) * dstStride + dx) * 4;
    dst.set(src.subarray(srcOff, srcOff + halfW * 4), dstOff);
  }
}

// === TILEMAP: 构建测试地图 ===
const TEST_MAP = [
  [0,0,0,0,0,0,0,0,0,0,0,0],
  [0,1,1,1,0,0,1,1,1,1,1,0],
  [0,1,1,1,0,0,1,1,1,1,1,0],
  [0,1,1,1,0,0,1,1,1,1,1,0],
  [0,0,0,0,0,0,1,1,0,1,1,0],
  [0,0,1,0,0,0,1,1,0,1,1,0],
  [0,1,1,1,0,0,1,1,1,1,1,0],
  [0,1,1,1,1,1,1,1,1,1,1,0],
  [0,1,1,1,1,1,1,1,1,1,1,0],
  [0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0],
  [0,1,0,1,1,0,1,0,1,1,1,0],
  [0,0,0,0,0,0,1,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0],
  [0,1,0,0,1,0,0,0,0,0,0,0],
  [0,1,0,1,1,1,0,0,0,0,0,0],
  [0,1,0,0,1,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0],
];
// 上半 (row 0-9): 原始测试场景
// 下半 (row 10-17): 小形状测试 (各1个):
//   (11,1): 1格孤立
//   (11,3)-(11,4): 2格水平
//   (11,6)-(12,6): 2格垂直
//   (11,8)-(11,9)-(11,10): 3格水平
//   (14,1)-(15,1)-(16,1): 3格垂直
//   (14,4)+(15,3)-(15,4)-(15,5)+(16,4): 十字型

function getPeeringForCell(map, cx, cy) {
  const rows = map.length;
  const cols = map[0].length;
  const get = (x, y) => (x >= 0 && x < cols && y >= 0 && y < rows) ? map[y][x] : 0;

  if (!get(cx, cy)) return -1;

  const T  = get(cx, cy - 1);
  const TR = get(cx + 1, cy - 1);
  const R  = get(cx + 1, cy);
  const BR = get(cx + 1, cy + 1);
  const B  = get(cx, cy + 1);
  const BL = get(cx - 1, cy + 1);
  const L  = get(cx - 1, cy);
  const TL = get(cx - 1, cy - 1);

  const effTR = (T && R) ? TR : 0;
  const effBR = (B && R) ? BR : 0;
  const effBL = (B && L) ? BL : 0;
  const effTL = (T && L) ? TL : 0;

  return [
    T  ? 0 : -1,
    effTR ? 0 : -1,
    R  ? 0 : -1,
    effBR ? 0 : -1,
    B  ? 0 : -1,
    effBL ? 0 : -1,
    L  ? 0 : -1,
    effTL ? 0 : -1,
  ];
}

function findPeeringIndex(peering) {
  for (let i = 0; i < TILE_PEERINGS.length; i++) {
    const p = TILE_PEERINGS[i];
    if (p[0] === peering[0] && p[1] === peering[1] && p[2] === peering[2] &&
        p[3] === peering[3] && p[4] === peering[4] && p[5] === peering[5] &&
        p[6] === peering[6] && p[7] === peering[7]) {
      return i;
    }
  }
  return -1;
}

// === LOG ===
function log(msg) {
  const el = document.getElementById('log');
  el.textContent += msg + '\n';
  console.log(msg);
}

// === MAIN ===
let cachedSrcData = null;
let cachedImgWidth = 0;
let cachedImgHeight = 0;

// Split positions (in source image pixels): 7 boundaries for 6 cells
let xSplits = [];
let ySplits = [];
const GRID_SCALE = 4;
const DRAG_THRESHOLD = 5; // px in screen space for hit detection

function getDefaultSplits(w, h) {
  const xs = [];
  const ys = [];
  for (let i = 0; i <= 6; i++) {
    xs.push(Math.round(i * w / 6));
    ys.push(Math.round(i * h / 6));
  }
  return { x: xs, y: ys };
}

function isUniformSplits() {
  const def = getDefaultSplits(cachedImgWidth, cachedImgHeight);
  return xSplits.every((v, i) => v === def.x[i]) && ySplits.every((v, i) => v === def.y[i]);
}

function renderGrid(img) {
  const gridCanvas = document.getElementById('gridCanvas');
  gridCanvas.width = cachedImgWidth * GRID_SCALE;
  gridCanvas.height = cachedImgHeight * GRID_SCALE;
  gridCanvas.style.width = `${cachedImgWidth * GRID_SCALE}px`;
  gridCanvas.style.height = `${cachedImgHeight * GRID_SCALE}px`;
  const ctx = gridCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  ctx.drawImage(img, 0, 0, cachedImgWidth * GRID_SCALE, cachedImgHeight * GRID_SCALE);

  // Draw cells with role coloring
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      const x = xSplits[col] * GRID_SCALE;
      const y = ySplits[row] * GRID_SCALE;
      const w = (xSplits[col + 1] - xSplits[col]) * GRID_SCALE;
      const h = (ySplits[row + 1] - ySplits[row]) * GRID_SCALE;

      const isCorner = (row === 0 || row === 5) && (col === 0 || col === 5);
      const isEdge = (row === 0 || row === 5 || col === 0 || col === 5) && !isCorner;

      let color;
      if (isCorner) color = 'rgba(255,100,100,0.4)';
      else if (isEdge) color = 'rgba(100,200,255,0.35)';
      else color = 'rgba(100,255,100,0.25)';

      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);

      ctx.fillStyle = '#fff';
      ctx.font = '10px monospace';
      ctx.fillText(`${row},${col}`, x + 3, y + 12);
    }
  }

  // Draw grid lines (draggable ones are brighter)
  for (let i = 0; i <= 6; i++) {
    const px = xSplits[i] * GRID_SCALE;
    const isBoundary = (i === 0 || i === 6);
    ctx.strokeStyle = isBoundary ? 'rgba(255,255,255,0.3)' : 'rgba(255,220,50,0.9)';
    ctx.lineWidth = isBoundary ? 1 : 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, cachedImgHeight * GRID_SCALE);
    ctx.stroke();
  }
  for (let i = 0; i <= 6; i++) {
    const py = ySplits[i] * GRID_SCALE;
    const isBoundary = (i === 0 || i === 6);
    ctx.strokeStyle = isBoundary ? 'rgba(255,255,255,0.3)' : 'rgba(255,220,50,0.9)';
    ctx.lineWidth = isBoundary ? 1 : 2;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(cachedImgWidth * GRID_SCALE, py);
    ctx.stroke();
  }

  // Update info
  const xWidths = [];
  const yHeights = [];
  for (let i = 0; i < 6; i++) {
    xWidths.push(xSplits[i + 1] - xSplits[i]);
    yHeights.push(ySplits[i + 1] - ySplits[i]);
  }
  document.getElementById('splitInfo').textContent =
    `X: [${xWidths.join(', ')}]  Y: [${yHeights.join(', ')}]`;
}

function renderAtlasAndMap(layoutName) {
  if (!cachedSrcData) return;

  const layout = getLayout(layoutName);
  const customSplits = isUniformSplits() ? null : { x: xSplits, y: ySplits };
  const result = generateTilesetSubtile(cachedSrcData, cachedImgWidth, cachedImgHeight, layout, customSplits);

  document.getElementById('atlasInfo').textContent =
    `${layout.tiles.length} tiles, ${layout.cols}×${layout.rows} grid, tile: ${result.tileW}×${result.tileH}`;

  // Draw atlas
  const atlasCanvas = document.getElementById('atlasCanvas');
  atlasCanvas.width = result.width;
  atlasCanvas.height = result.height;
  atlasCanvas.style.width = `${result.width * 3}px`;
  atlasCanvas.style.height = `${result.height * 3}px`;
  const atlasCtx = atlasCanvas.getContext('2d');
  const atlasImgData = new ImageData(result.pixels, result.width, result.height);
  atlasCtx.putImageData(atlasImgData, 0, 0);

  atlasCtx.strokeStyle = 'rgba(255,255,255,0.15)';
  atlasCtx.lineWidth = 1;
  for (let c = 1; c < layout.cols; c++) {
    atlasCtx.beginPath();
    atlasCtx.moveTo(c * result.tileW, 0);
    atlasCtx.lineTo(c * result.tileW, result.height);
    atlasCtx.stroke();
  }
  for (let r = 1; r < layout.rows; r++) {
    atlasCtx.beginPath();
    atlasCtx.moveTo(0, r * result.tileH);
    atlasCtx.lineTo(result.width, r * result.tileH);
    atlasCtx.stroke();
  }

  // Build peering lookup for tilemap
  const peeringToAtlasPos = new Map();
  for (const tile of layout.tiles) {
    peeringToAtlasPos.set(tile.peeringIndex, { col: tile.col, row: tile.row });
  }

  // Draw tilemap
  const mapRows = TEST_MAP.length;
  const mapCols = TEST_MAP[0].length;
  const mapCanvas = document.getElementById('mapCanvas');
  const mapW = mapCols * result.tileW;
  const mapH = mapRows * result.tileH;
  mapCanvas.width = mapW;
  mapCanvas.height = mapH;
  mapCanvas.style.width = `${mapW * 2}px`;
  mapCanvas.style.height = `${mapH * 2}px`;
  const mapCtx = mapCanvas.getContext('2d');
  mapCtx.imageSmoothingEnabled = false;

  mapCtx.fillStyle = '#445566';
  mapCtx.fillRect(0, 0, mapW, mapH);

  const atlasImageData = new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height);
  const atlasOffscreen = new OffscreenCanvas(result.width, result.height);
  const atlasOffCtx = atlasOffscreen.getContext('2d');
  atlasOffCtx.putImageData(atlasImageData, 0, 0);

  let unmatchedCount = 0;

  for (let cy = 0; cy < mapRows; cy++) {
    for (let cx = 0; cx < mapCols; cx++) {
      const peering = getPeeringForCell(TEST_MAP, cx, cy);
      if (peering === -1) continue;

      const idx = findPeeringIndex(peering);
      if (idx === -1) {
        unmatchedCount++;
        mapCtx.fillStyle = '#f00';
        mapCtx.fillRect(cx * result.tileW, cy * result.tileH, result.tileW, result.tileH);
        continue;
      }

      const pos = peeringToAtlasPos.get(idx);
      mapCtx.drawImage(
        atlasOffscreen,
        pos.col * result.tileW, pos.row * result.tileH, result.tileW, result.tileH,
        cx * result.tileW, cy * result.tileH, result.tileW, result.tileH,
      );
    }
  }

  mapCtx.strokeStyle = 'rgba(255,255,255,0.1)';
  mapCtx.lineWidth = 1;
  for (let c = 1; c < mapCols; c++) {
    mapCtx.beginPath();
    mapCtx.moveTo(c * result.tileW, 0);
    mapCtx.lineTo(c * result.tileW, mapH);
    mapCtx.stroke();
  }
  for (let r = 1; r < mapRows; r++) {
    mapCtx.beginPath();
    mapCtx.moveTo(0, r * result.tileH);
    mapCtx.lineTo(mapW, r * result.tileH);
    mapCtx.stroke();
  }

  if (unmatchedCount > 0) {
    log(`ERROR: ${unmatchedCount} cells had no matching peering (shown in red)`);
  }
}

function refreshAll(sourceImg) {
  renderGrid(sourceImg);
  const layoutName = document.querySelector('input[name="layout"]:checked').value;
  renderAtlasAndMap(layoutName);
}

function setupGridDrag(sourceImg) {
  const canvas = document.getElementById('gridCanvas');
  let dragging = null; // { axis: 'x'|'y', index: 1-5 }

  function hitTest(mx, my) {
    // Check vertical lines (x splits) - indices 1..5 are draggable
    for (let i = 1; i <= 5; i++) {
      const lx = xSplits[i] * GRID_SCALE;
      if (Math.abs(mx - lx) <= DRAG_THRESHOLD) {
        return { axis: 'x', index: i };
      }
    }
    // Check horizontal lines (y splits)
    for (let i = 1; i <= 5; i++) {
      const ly = ySplits[i] * GRID_SCALE;
      if (Math.abs(my - ly) <= DRAG_THRESHOLD) {
        return { axis: 'y', index: i };
      }
    }
    return null;
  }

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hit = hitTest(mx, my);
    if (hit) {
      dragging = hit;
      canvas.style.cursor = hit.axis === 'x' ? 'col-resize' : 'row-resize';
      e.preventDefault();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (dragging) {
      const i = dragging.index;
      if (dragging.axis === 'x') {
        const newVal = Math.round(mx / GRID_SCALE);
        const minX = xSplits[i - 1] + 1;
        const maxX = xSplits[i + 1] - 1;
        xSplits[i] = Math.max(minX, Math.min(maxX, newVal));
      } else {
        const newVal = Math.round(my / GRID_SCALE);
        const minY = ySplits[i - 1] + 1;
        const maxY = ySplits[i + 1] - 1;
        ySplits[i] = Math.max(minY, Math.min(maxY, newVal));
      }
      refreshAll(sourceImg);
    } else {
      const hit = hitTest(mx, my);
      if (hit) {
        canvas.style.cursor = hit.axis === 'x' ? 'col-resize' : 'row-resize';
      } else {
        canvas.style.cursor = 'default';
      }
    }
  });

  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = null;
      canvas.style.cursor = 'default';
    }
  });
}

async function main() {
  log('Loading SNOW_H.png...');
  const img = new Image();
  img.src = 'SNOW_H.png';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('Failed to load image'));
  });

  log(`Source: ${img.width}×${img.height}`);
  if (img.width % 6 !== 0 || img.height % 6 !== 0) {
    log(`ERROR: dimensions not divisible by 6!`);
    return;
  }

  cachedImgWidth = img.width;
  cachedImgHeight = img.height;

  // Draw source
  const srcCanvas = document.getElementById('srcCanvas');
  srcCanvas.width = img.width;
  srcCanvas.height = img.height;
  srcCanvas.style.width = `${img.width * 3}px`;
  srcCanvas.style.height = `${img.height * 3}px`;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(img, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, img.width, img.height);
  cachedSrcData = srcData.data;

  log(`Sub-tile size: ${img.width / 6}×${img.height / 6}`);
  log(`Output tile size: ${img.width / 3}×${img.height / 3}`);

  // Initialize splits to uniform
  const def = getDefaultSplits(img.width, img.height);
  xSplits = def.x;
  ySplits = def.y;

  // Render everything
  renderGrid(img);
  const selectedLayout = document.querySelector('input[name="layout"]:checked').value;
  log(`Generating TileSet47 (full 6x6 + flip180, layout: ${selectedLayout})...`);
  renderAtlasAndMap(selectedLayout);

  // Setup grid drag interaction
  setupGridDrag(img);

  // Layout switch
  document.querySelectorAll('input[name="layout"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      log(`Switching to layout: ${e.target.value}`);
      renderAtlasAndMap(e.target.value);
    });
  });

  // Reset button
  document.getElementById('resetGrid').addEventListener('click', () => {
    const def = getDefaultSplits(cachedImgWidth, cachedImgHeight);
    xSplits = def.x;
    ySplits = def.y;
    log('Grid reset to uniform splits.');
    refreshAll(img);
  });

  log('Done. Drag yellow grid lines to adjust splits.');
}

main().catch(e => log(`FATAL: ${e.message}\n${e.stack}`));
