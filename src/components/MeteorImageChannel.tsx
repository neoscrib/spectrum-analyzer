import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import type { ChannelImage } from "../meteor/types";
import { CHANNEL_NAMES } from "../meteor/settings";
import { download } from "../meteor/iq";
import { contrastLevels } from "../meteor/images";
export function MeteorImageChannel({
  image,
  enhance = false,
}: {
  image: ChannelImage;
  enhance?: boolean;
}) {
  const [scale, setScale] = useState("fit");
  const pan = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const drawnHeight = useRef(0);
  const previousLevels = useRef<[number, number]>([0, 255]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (canvas.height !== image.height || canvas.width !== image.width) {
      const old = document.createElement("canvas");
      old.width = canvas.width;
      old.height = canvas.height;
      old.getContext("2d")!.drawImage(canvas, 0, 0);
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext("2d")!.drawImage(old, 0, 0);
    }
    const levels: [number, number] = enhance
      ? contrastLevels(image.pixels)
      : [0, 255];
    const changed = levels.some(
      (value, index) => value !== previousLevels.current[index],
    );
    const startRow = changed
      ? 0
      : Math.max(0, Math.min(drawnHeight.current, image.height) - 8);
    const pixels = image.pixels.subarray(
      startRow * image.width,
      image.height * image.width,
    );
    const context = canvas.getContext("2d")!,
      data = context.createImageData(image.width, image.height - startRow);
    for (let n = 0; n < pixels.length; n++) {
      data.data[n * 4] =
        data.data[n * 4 + 1] =
        data.data[n * 4 + 2] =
          pixels[n] === 0
            ? 0
            : Math.round(
                Math.max(
                  0,
                  Math.min(
                    255,
                    ((pixels[n] - levels[0]) * 255) / (levels[1] - levels[0]),
                  ),
                ),
              );
      data.data[n * 4 + 3] = 255;
    }
    context.putImageData(data, 0, startRow);
    drawnHeight.current = image.height;
    previousLevels.current = levels;
  }, [image, enhance]);
  const exportRaw = () => {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!,
      rgba = ctx.createImageData(image.width, image.height);
    for (let n = 0; n < image.width * image.height; n++) {
      rgba.data[n * 4] =
        rgba.data[n * 4 + 1] =
        rgba.data[n * 4 + 2] =
          image.pixels[n];
      rgba.data[n * 4 + 3] = 255;
    }
    ctx.putImageData(rgba, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) download(blob, `meteor-apid-${image.apid}.png`);
    });
  };
  return (
    <article className="meteor-channel">
      <div className="channel-title">
        <div>
          <b>CH {image.apid - 63}</b>{" "}
          <span>{CHANNEL_NAMES[image.apid - 64]}</span>
        </div>
        <button
          aria-label={`Export APID ${image.apid} PNG`}
          title="Download original grayscale pixels"
          onClick={exportRaw}
        >
          <Download size={13} /> Raw PNG
        </button>
      </div>
      <label className="meteor-scale">
        Image scale{" "}
        <select
          aria-label="Satellite image zoom"
          value={scale}
          onChange={(e) => setScale(e.target.value)}
        >
          <option value="fit">Fit to view</option>
          <option value="0.5">50%</option>
          <option value="1">100%</option>
          <option value="2">200%</option>
        </select>
      </label>
      <div
        className="meteor-image-scroll"
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") {
            e.currentTarget.setPointerCapture(e.pointerId);
            pan.current = {
              x: e.clientX,
              y: e.clientY,
              left: e.currentTarget.scrollLeft,
              top: e.currentTarget.scrollTop,
            };
          }
        }}
        onPointerMove={(e) => {
          if (pan.current) {
            e.currentTarget.scrollLeft =
              pan.current.left + pan.current.x - e.clientX;
            e.currentTarget.scrollTop =
              pan.current.top + pan.current.y - e.clientY;
          }
        }}
        onPointerUp={() => {
          pan.current = null;
        }}
        onPointerCancel={() => {
          pan.current = null;
        }}
      >
        <canvas
          style={{
            width:
              scale === "fit" ? "100%" : `${image.width * Number(scale)}px`,
            maxWidth: "none",
          }}
          ref={ref}
          width={1568}
          height={1}
          aria-label={`Decoded satellite image APID ${image.apid}`}
        />
      </div>
      <small>
        APID {image.apid} · {image.width} × {image.height} ·{" "}
        {enhance ? "contrast display; raw PNG unchanged" : "raw grayscale"} · no
        map projection · black includes missing strips
      </small>
    </article>
  );
}
