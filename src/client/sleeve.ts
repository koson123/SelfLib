/** Crop an owner-supplied retail wraparound locally; no external artwork service or upload URL. */
export function bindSleeve(form: HTMLFormElement) {
  const role = form.querySelector<HTMLSelectElement>('[name=role]')!;
  const fileInput = form.querySelector<HTMLInputElement>('[name=image]')!;
  const controls = form.querySelector<HTMLElement>('.sleeve-editor');
  let image: ImageBitmap | undefined;
  let loadedFile: File | undefined;
  const canvases = controls?.querySelectorAll<HTMLCanvasElement>('canvas');
  const read = async () => {
    const file = fileInput.files?.[0];
    if (!file) throw new Error('Choose a sleeve scan first.');
    if (
      file.size > 4 * 1024 * 1024 ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    )
      throw new Error('Sleeve scans must be PNG, JPEG or WebP, maximum 4 MiB.');
    if (loadedFile === file && image) return image;
    const next = await createImageBitmap(file);
    if (!next.width || next.width * next.height > 20000000) {
      next.close();
      throw new Error('Sleeve scan must contain at most 20 million pixels.');
    }
    image?.close();
    image = next;
    loadedFile = file;
    return next;
  };
  const draw = async () => {
    if (!controls || !canvases) throw new Error('Sleeve editor unavailable.');
    const image = await read();
    const start = Number(form.querySelector<HTMLInputElement>('[name=spineStart]')!.value) / 100;
    const end = Number(form.querySelector<HTMLInputElement>('[name=frontStart]')!.value) / 100;
    if (end <= start) throw new Error('Front start must be after spine start.');
    // Typical scan layout is back | spine | front. Sliders correct edition-specific boundaries.
    for (const [index, left, width] of [
      [0, end, 1 - end],
      [1, start, end - start],
    ]) {
      const canvas = canvases[index];
      canvas.width = index === 0 ? 360 : 64;
      canvas.height = 510;
      canvas
        .getContext('2d')!
        .drawImage(
          image,
          left * image.width,
          0,
          width * image.width,
          image.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
    }
    controls.querySelector('[role=status]')!.textContent =
      'Preview: front sleeve and printed spine. Adjust the boundaries before saving.';
  };
  const refresh = () => {
    if (!controls) return;
    controls.hidden = role.value !== 'sleeve';
    if (!controls.hidden && fileInput.files?.length)
      void draw().catch((error) => {
        controls.querySelector('[role=status]')!.textContent = error.message;
      });
  };
  role.addEventListener('change', refresh);
  fileInput.addEventListener('change', refresh);
  controls?.querySelectorAll('input').forEach((input) => input.addEventListener('input', refresh));
  return async () => {
    await draw();
    return [...canvases!].map((canvas) => ({
      mime: 'image/jpeg',
      base64: canvas.toDataURL('image/jpeg', 0.92).split(',')[1],
    }));
  };
}
export const sleeveEditor = `<div class="sleeve-editor" hidden><p>Use an actual wraparound scan laid out back → spine → front. Adjust both boundaries; the preview shows exactly what will be saved.</p><label>Spine starts (% across scan)<input type="range" name="spineStart" min="1" max="90" step="0.1" value="47"></label><label>Front starts (% across scan)<input type="range" name="frontStart" min="2" max="99" step="0.1" value="53"></label><div class="sleeve-crops"><canvas aria-label="Front sleeve preview"></canvas><canvas aria-label="Printed spine preview"></canvas></div><p role="status">Choose a scan to preview it. Maximum 4 MiB and 20 million pixels.</p></div>`;
