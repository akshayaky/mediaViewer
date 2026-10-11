import { useEffect, useState } from "react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export function useDominantColor(imageSrc: string) {
  const [rgb, setRgb] = useState<[number, number, number] | null>(null);

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