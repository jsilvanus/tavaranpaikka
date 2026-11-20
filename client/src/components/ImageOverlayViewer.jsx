import { useRef, useState } from 'react';
import { withBasePath } from '../api/client.js';

/**
 * Displays an image with SVG overlays (rectangles, polygons, pins) and
 * optionally allows drawing new rectangle overlays via click-and-drag.
 */
export default function ImageOverlayViewer({
  imageUrl,
  alt = '',
  overlays = [],
  highlightTargetId = null,
  drawMode = false,
  drawColor = '#dc2626',
  onDrawRect,
}) {
  const wrapRef = useRef(null);
  const [dragStart, setDragStart] = useState(null);
  const [dragCurrent, setDragCurrent] = useState(null);

  function toNorm(e) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  }

  function handlePointerDown(e) {
    if (!drawMode) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const pt = toNorm(e);
    setDragStart(pt);
    setDragCurrent(pt);
  }

  function handlePointerMove(e) {
    if (!drawMode || !dragStart) return;
    setDragCurrent(toNorm(e));
  }

  function handlePointerUp() {
    if (!drawMode || !dragStart || !dragCurrent) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }
    const x = Math.min(dragStart.x, dragCurrent.x);
    const y = Math.min(dragStart.y, dragCurrent.y);
    const w = Math.abs(dragCurrent.x - dragStart.x);
    const h = Math.abs(dragCurrent.y - dragStart.y);
    setDragStart(null);
    setDragCurrent(null);
    if (w >= 0.015 && h >= 0.015 && onDrawRect) {
      onDrawRect({
        x: Number(x.toFixed(4)),
        y: Number(y.toFixed(4)),
        w: Number(w.toFixed(4)),
        h: Number(h.toFixed(4)),
      });
    }
  }

  const draftRect =
    dragStart && dragCurrent
      ? {
          x: Math.min(dragStart.x, dragCurrent.x) * 100,
          y: Math.min(dragStart.y, dragCurrent.y) * 100,
          w: Math.abs(dragCurrent.x - dragStart.x) * 100,
          h: Math.abs(dragCurrent.y - dragStart.y) * 100,
        }
      : null;

  return (
    <div
      ref={wrapRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'relative',
        width: '100%',
        overflow: 'hidden',
        borderRadius: 8,
        border: '1px solid var(--border)',
        cursor: drawMode ? 'crosshair' : 'default',
        touchAction: drawMode ? 'none' : 'auto',
        userSelect: 'none',
      }}
    >
      <img
        src={withBasePath(imageUrl)}
        alt={alt}
        draggable={false}
        style={{ display: 'block', width: '100%', height: 'auto' }}
      />

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        {overlays.map((ov) => {
          const isHighlighted = highlightTargetId && ov.targetId === highlightTargetId;
          const color = ov.color || '#dc2626';
          const fillOpacity = isHighlighted ? 0.28 : 0.14;
          const strokeWidth = isHighlighted ? 1.1 : 0.6;

          if (ov.shape === 'rect' && ov.coords) {
            return (
              <rect
                key={ov.id}
                x={(ov.coords.x || 0) * 100}
                y={(ov.coords.y || 0) * 100}
                width={(ov.coords.w || 0) * 100}
                height={(ov.coords.h || 0) * 100}
                fill={color}
                fillOpacity={fillOpacity}
                stroke={color}
                strokeWidth={strokeWidth}
              />
            );
          }

          if (ov.shape === 'polygon' && Array.isArray(ov.coords?.points)) {
            const pts = ov.coords.points.map((p) => `${p.x * 100},${p.y * 100}`).join(' ');
            return (
              <polygon
                key={ov.id}
                points={pts}
                fill={color}
                fillOpacity={fillOpacity}
                stroke={color}
                strokeWidth={strokeWidth}
              />
            );
          }

          if (ov.shape === 'pin' && ov.coords) {
            return (
              <circle
                key={ov.id}
                cx={(ov.coords.x || 0) * 100}
                cy={(ov.coords.y || 0) * 100}
                r={isHighlighted ? 2.4 : 1.6}
                fill={color}
                stroke="#ffffff"
                strokeWidth={0.5}
              />
            );
          }
          return null;
        })}

        {draftRect && (
          <rect
            x={draftRect.x}
            y={draftRect.y}
            width={draftRect.w}
            height={draftRect.h}
            fill={drawColor}
            fillOpacity={0.22}
            stroke={drawColor}
            strokeWidth={0.8}
            strokeDasharray="2 1"
          />
        )}
      </svg>

      {overlays.map((ov) => {
        if (!ov.label) return null;
        const leftPct =
          ov.shape === 'rect' ? (ov.coords?.x || 0) * 100 : (ov.coords?.x || 0) * 100;
        const topPct =
          ov.shape === 'rect' ? (ov.coords?.y || 0) * 100 : (ov.coords?.y || 0) * 100;
        return (
          <span
            key={`lbl-${ov.id}`}
            style={{
              position: 'absolute',
              left: `${leftPct}%`,
              top: `${topPct}%`,
              transform: 'translate(2px, 2px)',
              background: ov.color || '#dc2626',
              color: '#fff',
              fontSize: '0.7rem',
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: 4,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {ov.label}
          </span>
        );
      })}
    </div>
  );
}
