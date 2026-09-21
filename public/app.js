const state = {
  result: null,
  frameId: 1,
  selected: null,
  projection: []
};

const $ = (selector) => document.querySelector(selector);
const canvas = $('#board');
const ctx = canvas.getContext('2d');

for (const check of ['median', 'peakRatio', 'velocityRange', 'temporal']) {
  $(`[data-check="${check}"]`).addEventListener('change', scheduleRun);
}
for (const id of ['medianThreshold', 'peakRatioThreshold', 'speedThreshold', 'temporalThreshold', 'minimumNeighbors']) {
  $('#' + id).addEventListener('change', scheduleRun);
}
$('#repair').addEventListener('change', scheduleRun);
$('#fieldVersion').addEventListener('change', scheduleRun);
$('#frameSelect').addEventListener('change', (event) => {
  state.frameId = Number(event.target.value);
  state.selected = null;
  draw();
});
$('#runAnalysis').addEventListener('click', runAnalysis);
$('#layerRaw').addEventListener('change', draw);
$('#layerInspection').addEventListener('change', draw);
$('#layerReplacement').addEventListener('change', draw);
$('#layerDerived').addEventListener('change', draw);
canvas.addEventListener('click', onCanvasClick);
$('#reimport').addEventListener('click', async () => {
  await fetch('/api/reimport', { method: 'POST' });
  await runAnalysis();
});

async function scheduleRun() {
  await runAnalysis();
}

function readConfig() {
  return {
    median: $('[data-check="median"]').checked,
    peakRatio: $('[data-check="peakRatio"]').checked,
    velocityRange: $('[data-check="velocityRange"]').checked,
    temporal: $('[data-check="temporal"]').checked,
    medianThreshold: $('#medianThreshold').value,
    peakRatioThreshold: $('#peakRatioThreshold').value,
    speedThreshold: $('#speedThreshold').value,
    temporalThreshold: $('#temporalThreshold').value,
    minimumNeighbors: $('#minimumNeighbors').value,
    repair: $('#repair').value,
    fieldVersion: $('#fieldVersion').value
  };
}

async function runAnalysis() {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(readConfig())
  });
  state.result = await response.json();
  $('#exportRun').href = `/api/runs/${state.result.runId}/export`;
  if (!state.result.frames.some((frame) => frame.frameId === state.frameId)) {
    state.frameId = state.result.frames[0].frameId;
  }
  $('#frameSelect').innerHTML = state.result.frames
    .map((frame) => `<option value="${frame.frameId}">第 ${frame.frameIndex + 1} 帧 (ID ${frame.frameId})</option>`)
    .join('');
  $('#frameSelect').value = String(state.frameId);
  state.selected = null;
  draw();
}

function currentFrame() {
  return state.result.frames.find((frame) => frame.frameId === state.frameId);
}

function projectPoints(points) {
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const margin = 70;
  const sx = (canvas.width - margin * 2) / (maxX - minX);
  const sy = (canvas.height - margin * 2) / (maxY - minY);
  state.projection = points.map((point) => ({
    point,
    x: margin + (point.x - minX) * sx,
    y: canvas.height - margin - (point.y - minY) * sy
  }));
}

function draw() {
  if (!state.result) return;
  const frame = currentFrame();
  projectPoints(frame.points);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawGrid();
  const maxAbs = Math.max(1, ...frame.points.flatMap((p) => [p.rawU, p.rawV, p.fieldU, p.fieldV]).filter(Number.isFinite).map(Math.abs));
  for (const item of state.projection) {
    if ($('#layerRaw').checked) drawVector(item, item.point.rawU, item.point.rawV, '#166534', 1.6, maxAbs);
    if ($('#layerReplacement').checked && item.point.fieldSource !== 'raw') {
      drawVector(item, item.point.fieldU, item.point.fieldV, '#2563eb', 2.8, maxAbs);
    }
    drawStatus(item);
    if ($('#layerDerived').checked) drawDerived(item);
  }
  if ($('#layerInspection').checked) drawInspection();
  highlightSelection();
  updateSummary(frame);
  renderDetails();
}

function drawGrid() {
  ctx.strokeStyle = '#d8dee9';
  ctx.lineWidth = 1;
  const byJ = new Map();
  for (const item of state.projection) {
    if (!byJ.has(item.point.j)) byJ.set(item.point.j, []);
    byJ.get(item.point.j).push(item);
  }
  for (const row of byJ.values()) {
    row.sort((a, b) => a.point.i - b.point.i);
    ctx.beginPath();
    row.forEach((item, index) => index ? ctx.lineTo(item.x, item.y) : ctx.moveTo(item.x, item.y));
    ctx.stroke();
  }
  const byI = new Map();
  for (const item of state.projection) {
    if (!byI.has(item.point.i)) byI.set(item.point.i, []);
    byI.get(item.point.i).push(item);
  }
  for (const col of byI.values()) {
    col.sort((a, b) => a.point.j - b.point.j);
    ctx.beginPath();
    col.forEach((item, index) => index ? ctx.lineTo(item.x, item.y) : ctx.moveTo(item.x, item.y));
    ctx.stroke();
  }
}

function drawVector(item, u, v, color, width, maxAbs) {
  if (!Number.isFinite(u) || !Number.isFinite(v)) return;
  const scale = 28 / maxAbs;
  const x2 = item.x + u * scale;
  const y2 = item.y - v * scale;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(item.x, item.y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const angle = Math.atan2(y2 - item.y, x2 - item.x);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 8 * Math.cos(angle - 0.5), y2 - 8 * Math.sin(angle - 0.5));
  ctx.lineTo(x2 - 8 * Math.cos(angle + 0.5), y2 - 8 * Math.sin(angle + 0.5));
  ctx.closePath();
  ctx.fill();
}

function drawStatus(item) {
  const p = item.point;
  if (p.sourceStatus === 'occluded') {
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(item.x - 7, item.y - 7, 14, 14);
  } else if (p.sourceStatus === 'missing') {
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(item.x - 7, item.y - 7);
    ctx.lineTo(item.x + 7, item.y + 7);
    ctx.moveTo(item.x + 7, item.y - 7);
    ctx.lineTo(item.x - 7, item.y + 7);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(item.x, item.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawDerived(item) {
  const p = item.point;
  if (p.vorticity === null || p.divergence === null) return;
  const intensity = Math.min(1, Math.abs(p.vorticity));
  ctx.fillStyle = `rgba(217, 70, 239, ${0.18 + intensity * 0.45})`;
  ctx.beginPath();
  ctx.arc(item.x, item.y, 9, 0, Math.PI * 2);
  ctx.fill();
}

function drawInspection() {
  for (const item of state.projection) {
    const p = item.point;
    if (p.invalid && p.sourceStatus === 'valid') {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(item.x, item.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function highlightSelection() {
  if (!state.selected) return;
  const selectedItem = state.projection.find((item) => item.point === state.selected);
  if (!selectedItem) return;
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(selectedItem.x, selectedItem.y, 14, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
  ctx.lineWidth = 2;
  for (const neighbor of state.selected.neighbors) {
    const item = state.projection.find((candidate) => candidate.point.i === neighbor.i && candidate.point.j === neighbor.j);
    if (!item) continue;
    ctx.beginPath();
    ctx.moveTo(selectedItem.x, selectedItem.y);
    ctx.lineTo(item.x, item.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(item.x, item.y, 11, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function onCanvasClick(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * canvas.width / rect.width;
  const y = (event.clientY - rect.top) * canvas.height / rect.height;
  let nearest = null;
  let distance = Infinity;
  for (const item of state.projection) {
    const current = Math.hypot(item.x - x, item.y - y);
    if (current < distance) {
      distance = current;
      nearest = item;
    }
  }
  if (nearest && distance < 20) state.selected = nearest.point;
  draw();
}

function updateSummary(frame) {
  const invalid = frame.points.filter((p) => p.invalid).length;
  const holes = frame.points.filter((p) => p.fieldSource === 'hole').length;
  const interpolated = frame.points.filter((p) => p.fieldSource === 'interpolation').length;
  const previous = frame.points.filter((p) => p.fieldSource === 'previous-frame').length;
  $('#summary').textContent = `共 ${frame.points.length} 点 · 无效 ${invalid} · 空洞 ${holes} · 插值 ${interpolated} · 上帧引用 ${previous}`;
}

function fmt(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? '缺失' : Number(value).toFixed(3);
}

function renderDetails() {
  if (!state.selected) {
    $('#details').innerHTML = '<p>尚未选择矢量。</p>';
    return;
  }
  const p = state.selected;
  const reasons = p.failureReasons.length
    ? `<ul class="list">${p.failureReasons.map((reason) => `<li><b>${reason.check}</b>：${reason.message}</li>`).join('')}</ul>`
    : '<p>无失败原因。</p>';
  const supports = p.supportPoints.length
    ? `<ul class="list">${p.supportPoints.map((s) => `<li>帧 ${s.frameId} (${s.i}, ${s.j})，权重 ${s.weight.toFixed(4)}</li>`).join('')}</ul>`
    : '<p>无支持点；未借用替换值。</p>';
  const neighbors = p.neighbors.length
    ? `<ul class="list">${p.neighbors.map((n) => `<li>(${n.i}, ${n.j}) u=${fmt(n.u)} v=${fmt(n.v)} 峰比=${fmt(n.peakRatio)}</li>`).join('')}</ul>`
    : '<p>没有可统计邻点；不环绕边界。</p>';
  $('#details').innerHTML = `
    <div>
      <span class="badge ${p.invalid ? 'invalid' : 'valid'}">${p.invalid ? '无效' : '通过'}</span>
      <span class="badge occluded">${p.sourceStatus}</span>
      <span class="badge raw">${p.fieldSource}</span>
    </div>
    <div class="kv">
      <b>网格</b><span>(${p.i}, ${p.j})</span>
      <b>坐标</b><span>x=${fmt(p.x)}, y=${fmt(p.y)}</span>
      <b>原始 u/v</b><span>${fmt(p.rawU)} / ${fmt(p.rawV)}</span>
      <b>峰比</b><span>${fmt(p.peakRatio)}</span>
      <b>选定场 u/v</b><span>${fmt(p.fieldU)} / ${fmt(p.fieldV)}</span>
      <b>中值残差</b><span>${fmt(p.medianResidual)}</span>
      <b>时间差</b><span>${fmt(p.temporalDelta)}</span>
      <b>涡量</b><span>${fmt(p.vorticity)}</span>
      <b>散度</b><span>${fmt(p.divergence)}</span>
    </div>
    <div class="section-title">失败原因</div>${reasons}
    <div class="section-title">修复方法</div><p>${p.methodDetail || '未修复'}</p>
    <div class="section-title">支持点集</div>${supports}
    <div class="section-title">实际参与邻域（${p.neighborCount}）</div>${neighbors}
  `;
}

runAnalysis();
