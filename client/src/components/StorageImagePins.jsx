import { useState, useRef } from 'react';
import { t } from '../i18n/index.js';
import styles from './StorageImagePins.module.css';

export default function StorageImagePins({
  imageUrl,
  alt,
  pins = [],
  activePinId = null,
  pulsingPinId = null,
  interactive = false,
  onSelectCoords,
  showZoomControls = false,
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const canvasRef = useRef(null);

  if (!imageUrl) {
    return null;
  }

  function handleCanvasClick(e) {
    if (!interactive || !onSelectCoords || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    onSelectCoords(Number(x.toFixed(4)), Number(y.toFixed(4)));
  }

  function handleZoomIn() {
    setZoom((z) => Math.min(3, Number((z + 0.5).toFixed(1))));
  }

  function handleZoomOut() {
    setZoom((z) => {
      const next = Math.max(1, Number((z - 0.5).toFixed(1)));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  function handleZoomReset() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  return (
    <div className={styles.wrapper}>
      {showZoomControls && (
        <div className={styles.controls}>
          <button type="button" className="btn btn-sm" onClick={handleZoomIn}>
            {t('manage.places.zoomIn')}
          </button>
          <button type="button" className="btn btn-sm" onClick={handleZoomOut}>
            {t('manage.places.zoomOut')}
          </button>
          <button type="button" className="btn btn-sm" onClick={handleZoomReset}>
            {t('manage.places.zoomReset')}
          </button>
          {zoom > 1 && (
            <>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPan((p) => ({ ...p, x: p.x + 40 }))}
                aria-label="←"
              >
                ←
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPan((p) => ({ ...p, x: p.x - 40 }))}
                aria-label="→"
              >
                →
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPan((p) => ({ ...p, y: p.y + 40 }))}
                aria-label="↑"
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPan((p) => ({ ...p, y: p.y - 40 }))}
                aria-label="↓"
              >
                ↓
              </button>
            </>
          )}
        </div>
      )}

      <div className={styles.viewport}>
        <div
          ref={canvasRef}
          className={`${styles.canvas} ${interactive ? styles.interactive : ''}`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
          onClick={handleCanvasClick}
          data-testid="storage-image-canvas"
        >
          <img src={imageUrl} alt={alt} className={styles.image} />
          {pins
            .filter((p) => p.pinX !== null && p.pinX !== undefined && p.pinY !== null && p.pinY !== undefined)
            .map((pin) => {
              const isActive = activePinId && pin.id === activePinId;
              const isPulsing = pulsingPinId && pin.id === pulsingPinId;
              return (
                <div
                  key={pin.id}
                  className={`${styles.pin} ${isActive ? styles.pinActive : ''} ${
                    isPulsing ? styles.pinPulsing : ''
                  }`}
                  style={{
                    left: `${pin.pinX * 100}%`,
                    top: `${pin.pinY * 100}%`,
                  }}
                  title={pin.pinLabel || pin.name}
                  data-testid={`pin-${pin.id}`}
                >
                  <span className={styles.pinDot} />
                  {pin.name && <span className={styles.pinTag}>{pin.name}</span>}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
