// Film grain as a small raster tile, generated once. SVG feTurbulence backgrounds under a blend
// mode re-render every frame and dropped the landing page to a few fps; a PNG tile does not.
export function installNoise() {
  if (typeof document === "undefined") return;
  try {
    const size = 160;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // A literal url() in a stylesheet (not a custom property) so the tile is decoded once.
    const url = URL.createObjectURL(dataUrlToBlob(c.toDataURL("image/png")));
    const style = document.createElement("style");
    style.textContent = `body::before, .grain::after, .noise-bg { background-image: url("${url}"); }`;
    document.head.appendChild(style);
  } catch {
    /* grain is decoration only */
  }
}

function dataUrlToBlob(d: string): Blob {
  const bin = atob(d.split(",")[1] ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}
