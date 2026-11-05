import { db } from "./db";
import {
  type Person,
  type Relation,
  initials,
  nameOf,
  partnership,
} from "./domain";

/** Draw data directly: DOM-to-image foreignObject capture varies by browser. */
export async function renderTreePng(
  title: string,
  people: Person[],
  relations: Relation[],
  positions: Map<string, { x: number; y: number }>,
) {
  if (!people.length) throw new Error("There are no visible people to export.");
  const located = people.map((p) => ({
    person: p,
    position: positions.get(p.id),
  }));
  if (located.some((p) => !p.position))
    throw new Error("Wait for the tree to finish arranging before exporting.");
  const minX = Math.min(...located.map((p) => p.position!.x)),
    minY = Math.min(...located.map((p) => p.position!.y));
  const maxX = Math.max(...located.map((p) => p.position!.x)) + 196,
    maxY = Math.max(...located.map((p) => p.position!.y)) + 102;
  const width = Math.max(640, maxX - minX + 80),
    height = maxY - minY + 180;
  const scale = Math.min(2, 4096 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image export is unavailable in this browser.");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#fafbf7";
  ctx.fillRect(0, 0, width, height);
  const fit = (value: string, max: number) => {
    let str = value;
    while (ctx.measureText(str).width > max && str.length > 1)
      str = str.slice(0, -1);
    return str !== value ? str.slice(0, -1) + "…" : str;
  };
  ctx.fillStyle = "#285544";
  ctx.font = "28px Georgia";
  ctx.fillText(fit(title, width - 60), 30, 40);
  ctx.font = "11px Arial";
  ctx.fillStyle = "#73836b";
  ctx.fillText(
    `${new Date().toLocaleDateString()} · ${people.length} people · Solid: parentage · Blue: adoption · Rose: partnership · Gold: care`,
    30,
    65,
  );
  ctx.save();
  ctx.translate(40 - minX, 105 - minY);
  const visible = new Set(people.map((p) => p.id));
  for (const r of relations) {
    if (!visible.has(r.fromId) || !visible.has(r.toId)) continue;
    let from = positions.get(r.fromId)!,
      to = positions.get(r.toId)!;
    ctx.strokeStyle = partnership(r)
      ? "#bb8b7c"
      : r.kind === "adoptive"
        ? "#628c9b"
        : r.kind === "step" || r.kind === "guardian"
          ? "#b28e4a"
          : "#8a9e91";
    ctx.lineWidth = 1.5;
    ctx.setLineDash(
      r.kind === "biological" || r.kind === "parent" ? [] : [5, 4],
    );
    ctx.beginPath();
    if (partnership(r)) {
      if (from.x > to.x) [from, to] = [to, from];
      ctx.moveTo(from.x + 196, from.y + 51);
      ctx.bezierCurveTo(
        from.x + 226,
        from.y + 51,
        to.x - 30,
        to.y + 51,
        to.x,
        to.y + 51,
      );
    } else {
      const sy = from.y + 102,
        ty = to.y,
        mid = (sy + ty) / 2;
      ctx.moveTo(from.x + 98, sy);
      ctx.bezierCurveTo(from.x + 98, mid, to.x + 98, mid, to.x + 98, ty);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const { person: p, position } of located) {
    const { x, y } = position!;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#cfdcc6";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, 196, 102, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e5ecd9";
    ctx.beginPath();
    ctx.arc(x + 32, y + 39, 19, 0, Math.PI * 2);
    ctx.fill();
    let drawn = false;
    if (p.photoId) {
      const asset = await db.media.get(p.photoId);
      if (asset) {
        try {
          const image = await createImageBitmap(asset.blob);
          ctx.save();
          ctx.beginPath();
          ctx.arc(x + 32, y + 39, 19, 0, Math.PI * 2);
          ctx.clip();
          const side = Math.min(image.width, image.height);
          ctx.drawImage(
            image,
            (image.width - side) / 2,
            (image.height - side) / 2,
            side,
            side,
            x + 13,
            y + 20,
            38,
            38,
          );
          ctx.restore();
          image.close();
          drawn = true;
        } catch {
          /* Invalid image data falls back to initials; records remain exportable. */
        }
      }
    }
    if (!drawn) {
      ctx.font = "15px Georgia";
      ctx.fillStyle = "#738b60";
      ctx.textAlign = "center";
      ctx.fillText(initials(p), x + 32, y + 44);
      ctx.textAlign = "left";
    }
    ctx.font = "bold 12px Arial";
    ctx.fillStyle = "#405638";
    ctx.fillText(fit(nameOf(p), 128), x + 60, y + 30);
    ctx.font = "10px Arial";
    ctx.fillStyle = "#88967b";
    ctx.fillText(
      `${p.birthApprox ? "c. " : ""}${p.birthDate || "Birth unknown"}`,
      x + 60,
      y + 48,
    );
    if (p.status === "deceased")
      ctx.fillText(
        `Died ${p.deathApprox ? "c. " : ""}${p.deathDate || "date unknown"}`,
        x + 60,
        y + 63,
      );
    ctx.strokeStyle = "#e8ede0";
    ctx.beginPath();
    ctx.moveTo(x, y + 77);
    ctx.lineTo(x + 196, y + 77);
    ctx.stroke();
    ctx.font = "9px Arial";
    ctx.fillText(
      p.status === "unknown"
        ? "Living status unknown"
        : p.status === "living"
          ? "Living"
          : "In memory",
      x + 12,
      y + 93,
    );
  }
  ctx.restore();
  ctx.font = "10px Arial";
  ctx.fillStyle = "#87977a";
  ctx.fillText(
    "Kinfolk · Family diagram. Keep a complete data backup separately.",
    30,
    height - 18,
  );
  return canvas.toDataURL("image/png");
}
