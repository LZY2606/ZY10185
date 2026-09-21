import { createCanvas, type CanvasRenderingContext2D } from 'canvas';
import type { AnalysisFrame } from './types.js';

export function renderFramePng(frame: AnalysisFrame, width = 1100, height = 700) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const points = frame.points;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const margin = 70;
  const scaleX = (width - margin * 2) / (maxX - minX);
  const scaleY = (height - margin * 2) / (maxY - minY);
  const project = (x: number, y: number) => ({
    x: margin + (x - minX) * scaleX,
    y: height - margin - (y - minY) * scaleY
  });

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#d8dee9';
  ctx.lineWidth = 1;
  for (const point of points) {
    const p = project(point.x, point.y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  const maxVector = Math.max(
    1,
    ...points
      .flatMap((point) => [point.rawU, point.rawV, point.fieldU, point.fieldV])
      .filter((value): value is number => value !== null && Number.isFinite(value))
      .map((value) => Math.abs(value))
  );

  for (const point of points) {
    const p = project(point.x, point.y);
    if (point.fieldU !== null && point.fieldV !== null) {
      const scale = 28 / maxVector;
      ctx.strokeStyle = point.fieldSource === 'raw' ? '#166534' : '#2563eb';
      ctx.lineWidth = point.fieldSource === 'raw' ? 2 : 2.5;
      drawArrow(ctx, p.x, p.y, p.x + point.fieldU * scale, p.y - point.fieldV * scale);
    }
    if (point.sourceStatus === 'occluded') {
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(p.x - 7, p.y - 7, 14, 14);
    }
    if (point.sourceStatus === 'missing') {
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - 7, p.y - 7);
      ctx.lineTo(p.x + 7, p.y + 7);
      ctx.moveTo(p.x + 7, p.y - 7);
      ctx.lineTo(p.x - 7, p.y + 7);
      ctx.stroke();
    }
    if (point.invalid && point.sourceStatus === 'valid') {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = '#111827';
  ctx.font = '22px sans-serif';
  ctx.fillText(`Frame ${frame.frameId} - ${frame.frameIndex + 1}/4`, 24, 34);
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#166534';
  ctx.fillText('■ 原始通过', 24, height - 24);
  ctx.fillStyle = '#2563eb';
  ctx.fillText('■ 替换值', 120, height - 24);
  ctx.fillStyle = '#dc2626';
  ctx.fillText('● 检查失败', 220, height - 24);
  ctx.fillStyle = '#6b7280';
  ctx.fillText('■ 遮挡', 320, height - 24);

  return canvas.toBuffer('image/png');
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 8 * Math.cos(angle - Math.PI / 6), y2 - 8 * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - 8 * Math.cos(angle + Math.PI / 6), y2 - 8 * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle as string;
  ctx.fill();
}
