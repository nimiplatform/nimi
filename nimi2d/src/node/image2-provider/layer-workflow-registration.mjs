const layerCells = {
  body: { column: 0, row: 0 },
  head: { column: 1, row: 0 },
  hair: { column: 2, row: 0 },
  eye: { column: 0, row: 1 },
  mouth: { column: 1, row: 1 },
  outfit: { column: 2, row: 1 },
};

function gate(status, detail, metrics = {}) {
  return { status, detail, metrics };
}

function cellFor(column, row, cellWidth, cellHeight) {
  return {
    column,
    row,
    x: column * cellWidth,
    y: row * cellHeight,
    width: cellWidth,
    height: cellHeight,
  };
}

function localBounds(bounds, cell) {
  if (!bounds) return null;
  return {
    x: bounds.x - cell.x,
    y: bounds.y - cell.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function boundsCenter(bounds) {
  if (!bounds) return null;
  return {
    x: bounds.x + (bounds.width / 2),
    y: bounds.y + (bounds.height / 2),
  };
}

function pointInsideBounds(point, bounds, pad = 0) {
  if (!point || !bounds) return false;
  return point.x >= bounds.x - pad
    && point.x <= bounds.x + bounds.width + pad
    && point.y >= bounds.y - pad
    && point.y <= bounds.y + bounds.height + pad;
}

function overlapsOnX(left, right) {
  if (!left || !right) return false;
  return Math.max(left.x, right.x) <= Math.min(left.x + left.width, right.x + right.width);
}

function ratioWithin(bounds, y) {
  if (!bounds || bounds.height <= 0 || y === null || y === undefined) return null;
  return Number(((y - bounds.y) / bounds.height).toFixed(3));
}

function cellStatsByName(cellStats) {
  return new Map((cellStats ?? []).map((item) => [item.cell, item]));
}

function measuredLocalBounds(cellStatsMap, name, cellWidth, cellHeight) {
  const layerCell = layerCells[name];
  const cell = cellFor(layerCell.column, layerCell.row, cellWidth, cellHeight);
  const stats = cellStatsMap.get(`r${layerCell.row}c${layerCell.column}`);
  return localBounds(stats?.foregroundBounds ?? null, cell);
}

function evaluateSharedAvatarRegistration(cellStats, cellWidth, cellHeight) {
  const statsMap = cellStatsByName(cellStats);
  const bounds = Object.fromEntries(Object.keys(layerCells)
    .map((name) => [name, measuredLocalBounds(statsMap, name, cellWidth, cellHeight)]));
  const missing = Object.entries(bounds)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    return gate('fail', 'Semantic cells must share a measurable avatar registration frame.', {
      failures: missing.map((name) => `missing_${name}_bounds`),
      bounds,
    });
  }

  const bodyCenter = boundsCenter(bounds.body);
  const headCenter = boundsCenter(bounds.head);
  const eyeCenter = boundsCenter(bounds.eye);
  const mouthCenter = boundsCenter(bounds.mouth);
  const outfitCenter = boundsCenter(bounds.outfit);
  const headCenterBodyYRatio = ratioWithin(bounds.body, headCenter.y);
  const eyeCenterBodyYRatio = ratioWithin(bounds.body, eyeCenter.y);
  const mouthCenterBodyYRatio = ratioWithin(bounds.body, mouthCenter.y);
  const outfitHeightBodyRatio = Number((bounds.outfit.height / bounds.body.height).toFixed(3));
  const eyeHeightHeadRatio = Number((bounds.eye.height / bounds.head.height).toFixed(3));
  const eyeHeightBodyRatio = Number((bounds.eye.height / bounds.body.height).toFixed(3));
  const mouthHeightHeadRatio = Number((bounds.mouth.height / bounds.head.height).toFixed(3));
  const mouthHeightBodyRatio = Number((bounds.mouth.height / bounds.body.height).toFixed(3));
  const headCenterXDeltaPx = Math.abs(headCenter.x - bodyCenter.x);
  const outfitCenterXDeltaPx = Math.abs(outfitCenter.x - bodyCenter.x);
  const thresholds = {
    body_min_height_ratio: 0.45,
    head_center_body_y_ratio: { min: 0.18, max: 0.55 },
    eye_center_body_y_ratio: { min: 0.2, max: 0.52 },
    mouth_center_body_y_ratio: { min: 0.35, max: 0.7 },
    head_center_x_delta_max_px: Number((cellWidth * 0.22).toFixed(2)),
    outfit_center_x_delta_max_px: Number((cellWidth * 0.18).toFixed(2)),
    outfit_height_body_ratio: { min: 0.65, max: 1.45 },
    eye_height_head_ratio_max: 0.45,
    eye_height_body_ratio_max: 0.25,
    mouth_height_head_ratio_max: 0.22,
    mouth_height_body_ratio_max: 0.14,
  };
  const failures = [];

  if (bounds.body.height < cellHeight * thresholds.body_min_height_ratio) failures.push('body_frame_too_short');
  if (headCenterBodyYRatio < thresholds.head_center_body_y_ratio.min || headCenterBodyYRatio > thresholds.head_center_body_y_ratio.max) {
    failures.push('head_center_outside_body_registration_band');
  }
  if (eyeCenterBodyYRatio < thresholds.eye_center_body_y_ratio.min || eyeCenterBodyYRatio > thresholds.eye_center_body_y_ratio.max) {
    failures.push('eye_center_outside_body_registration_band');
  }
  if (mouthCenterBodyYRatio < thresholds.mouth_center_body_y_ratio.min || mouthCenterBodyYRatio > thresholds.mouth_center_body_y_ratio.max) {
    failures.push('mouth_center_outside_body_registration_band');
  }
  if (headCenterXDeltaPx > thresholds.head_center_x_delta_max_px) failures.push('head_center_x_drift');
  if (outfitCenterXDeltaPx > thresholds.outfit_center_x_delta_max_px) failures.push('outfit_center_x_drift');
  if (outfitHeightBodyRatio < thresholds.outfit_height_body_ratio.min || outfitHeightBodyRatio > thresholds.outfit_height_body_ratio.max) {
    failures.push('outfit_body_scale_drift');
  }
  if (eyeHeightHeadRatio > thresholds.eye_height_head_ratio_max || eyeHeightBodyRatio > thresholds.eye_height_body_ratio_max) {
    failures.push('eye_feature_layer_too_tall');
  }
  if (mouthHeightHeadRatio > thresholds.mouth_height_head_ratio_max || mouthHeightBodyRatio > thresholds.mouth_height_body_ratio_max) {
    failures.push('mouth_feature_layer_too_tall');
  }
  if (!pointInsideBounds(eyeCenter, bounds.head, cellWidth * 0.08)) failures.push('eye_not_registered_to_head');
  if (!pointInsideBounds(mouthCenter, bounds.head, cellWidth * 0.08)) failures.push('mouth_not_registered_to_head');
  if (!overlapsOnX(bounds.hair, bounds.head)) failures.push('hair_not_registered_to_head');

  return gate(
    failures.length === 0 ? 'pass' : 'fail',
    'All atlas cells must preserve the same avatar registration frame; independently centered semantic crops are not repairable layer evidence.',
    {
      bounds,
      body_height_ratio: Number((bounds.body.height / cellHeight).toFixed(3)),
      head_center_body_y_ratio: headCenterBodyYRatio,
      eye_center_body_y_ratio: eyeCenterBodyYRatio,
      mouth_center_body_y_ratio: mouthCenterBodyYRatio,
      eye_height_head_ratio: eyeHeightHeadRatio,
      eye_height_body_ratio: eyeHeightBodyRatio,
      mouth_height_head_ratio: mouthHeightHeadRatio,
      mouth_height_body_ratio: mouthHeightBodyRatio,
      head_center_x_delta_px: Number(headCenterXDeltaPx.toFixed(2)),
      outfit_center_x_delta_px: Number(outfitCenterXDeltaPx.toFixed(2)),
      outfit_height_body_ratio: outfitHeightBodyRatio,
      thresholds,
      failures,
    },
  );
}

export { evaluateSharedAvatarRegistration };
