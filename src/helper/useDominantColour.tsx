import { useEffect, useState } from "react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export function useDominantColor(imageSrc?: string | null) {
  const [rgb, setRgb] = useState<[number, number, number] | null>(null);
  console.log("Using DominantColor");
  useEffect(() => {
    if (!imageSrc) {
      setRgb(null);
      return;
    }

    let cancelled = false;
    let objectUrl = "";

    const extractColor = async () => {
      try {
        const response = await tauriFetch(imageSrc);

        if (!response.ok) {
          throw new Error(`Image request failed: ${response.status}`);
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);

        const img = new Image();

        img.onload = () => {
          if (cancelled) return;

          const canvas = document.createElement("canvas");
          canvas.width = 32;
          canvas.height = 32;

          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          ctx.drawImage(img, 0, 0, 32, 32);

          const pixels = ctx.getImageData(0, 0, 32, 32).data;

          let r = 0, g = 0, b = 0, count = 0;

          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] < 128) continue;

            r += pixels[i];
            g += pixels[i + 1];
            b += pixels[i + 2];
            count++;
          }

          if (count && !cancelled) {
            setRgb([
              Math.round(r / count),
              Math.round(g / count),
              Math.round(b / count),
            ]);
          }
        };

        img.onerror = () => {
          if (!cancelled) {
            console.error("Failed to decode image");
          }
        };

        img.src = objectUrl;
      } catch (error) {
        if (!cancelled) {
          console.error("Color extraction failed:", error);
        }
      }
    };

    extractColor();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageSrc]);

  return rgb;
}

type RGB = [number, number, number];

function rgbToOklch([r, g, b]: RGB): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const linearize = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;

  [r, g, b] = [r, g, b].map(linearize) as RGB;

  const l = Math.cbrt(
    0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  );
  const m = Math.cbrt(
    0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  );
  const s = Math.cbrt(
    0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  );

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const C = Math.sqrt(a * a + bb * bb);
  const h = (Math.atan2(bb, a) * 180) / Math.PI;

  return [L, C, (h + 360) % 360];
}

export function getCardColor(rgb: string): string {
  const match = rgb.match(/\d+(\.\d+)?/g);
  if (!match || match.length < 3) return "oklch(0.25 0.025 250)";

  const [r, g, b] = match.slice(0, 3).map(Number);

  let [L, C, h] = rgbToOklch([r, g, b]);

  if (L < 0.12 || C < 0.025) {
    h = 250;
    C = 0.025;
  }

  const cardL = Math.max(0.22, Math.min(L * 0.65, 0.32));
  const cardC = Math.min(Math.max(C * 0.5, 0.025), 0.06);

  return `oklch(${cardL.toFixed(3)} ${cardC.toFixed(3)} ${h.toFixed(1)})`;
}