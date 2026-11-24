// camera.js — photo capture (mobile native camera, desktop webcam viewfinder, gallery)
// and client-side square crop + JPEG compression so photos fit comfortably in IndexedDB/Firestore.

const DEFAULT_SIZE = 420;
const DEFAULT_QUALITY = 0.78;

export function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

/**
 * Center-crops an HTMLImageElement or HTMLVideoElement to a square and
 * encodes it as a compact JPEG data URL (~20–45 KB at 420x420).
 */
export function compressSource(source, size = DEFAULT_SIZE, quality = DEFAULT_QUALITY) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh) throw new Error('Imagen sin dimensiones válidas');

  const side = Math.min(sw, sh);
  const sx = Math.floor((sw - side) / 2);
  const sy = Math.floor((sh - side) / 2);
  const target = Math.min(size, side);

  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, side, side, 0, 0, target, target);

  return canvas.toDataURL('image/jpeg', quality);
}

export function compressFile(file, size = DEFAULT_SIZE, quality = DEFAULT_QUALITY) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('Selecciona un archivo de imagen válido'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const dataUrl = compressSource(img, size, quality);
        resolve(dataUrl);
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}

export function canUseWebcam() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export async function startWebcam(videoEl) {
  if (!canUseWebcam()) {
    throw new Error('Tu navegador no permite acceso a la cámara aquí (requiere HTTPS o localhost).');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 720 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();

  return {
    capture(size = DEFAULT_SIZE, quality = DEFAULT_QUALITY) {
      return compressSource(videoEl, size, quality);
    },
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      videoEl.srcObject = null;
    },
  };
}

export function dataUrlByteSize(dataUrl) {
  if (!dataUrl) return 0;
  const base64 = dataUrl.split(',')[1] || '';
  return Math.round((base64.length * 3) / 4);
}


export function supportsLiveBarcode() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && canUseWebcam();
}

/**
 * Starts the rear camera and scans continuously for EAN/UPC barcodes.
 * Calls `onDetect(rawValue)` on first match and returns `{ stop() }`.
 */
export async function startBarcodeScanner(videoEl, onDetect) {
  if (!supportsLiveBarcode()) {
    throw new Error('Tu navegador no soporta escáner en vivo (usa Chrome en Android o escribe el código manualmente).');
  }
  const detector = new window.BarcodeDetector({
    formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
  });
  const cam = await startWebcam(videoEl);
  let active = true;

  const loop = async () => {
    if (!active) return;
    try {
      if (videoEl.readyState >= 2) {
        const codes = await detector.detect(videoEl);
        if (codes?.length && codes[0].rawValue) {
          active = false;
          cam.stop();
          onDetect(codes[0].rawValue);
          return;
        }
      }
    } catch {
      // ignore frame errors
    }
    if (active) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    stop() {
      active = false;
      cam.stop();
    },
  };
}
