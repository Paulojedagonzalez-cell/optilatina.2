import Anthropic from "@anthropic-ai/sdk";

// Lee la foto de un TICKET DE VENTA ya escrito a mano en la tienda (papel
// físico) y devuelve los renglones vendidos para recrearlo en la app antes
// de guardarlo. El personal solo toma la foto — nunca escribe el ticket de
// nuevo. La clave de Anthropic vive solo aquí, nunca en el navegador.

const SYSTEM = `Eres un asistente que lee TICKETS DE VENTA escritos a mano en una óptica (OptiLatina). El ticket ya fue llenado en papel por el vendedor; tu trabajo es transcribirlo para que el sistema lo registre.

Cada ticket suele tener: uno o varios productos vendidos (nombre/descripción, cantidad, precio unitario), el método de pago, y a veces una nota o el nombre del cliente.

Reglas importantes:
- Lee cada renglón de producto: descripción, cantidad y precio unitario (en USD salvo que diga Bs).
- Si no hay cantidad explícita, asume 1.
- El método de pago suele estar escrito o marcado: efectivo, zelle, USDT, pago móvil, transferencia. Si dice "punto" o no se distingue, usa "efectivo".
- Si hay un total escrito, inclúyelo; si no, se calculará solo.
- No inventes productos ni montos que no aparezcan escritos.

Devuelve SOLO un objeto JSON válido, sin texto adicional, con esta forma exacta:
{
  "items": [ { "name": "descripción del producto", "qty": número entero, "unitPrice": precio unitario en USD (número) } ],
  "total": total en USD si aparece escrito, o null,
  "paymentMethod": uno de "efectivo","zelle","usdt","pagoMovil","transferencia",
  "note": "nombre del cliente o nota breve si aparece, o ''"
}
Si no logras leer ningún producto, devuelve "items": [].`;

const USER_TEXT = "Esta foto es de un ticket de venta ya escrito a mano en la óptica. Transcribe los productos vendidos y devuelve el JSON. Responde únicamente con el objeto JSON.";

const parseDataUrl = (s) => {
  const m = typeof s === "string" && s.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  return m ? { media_type: m[1], data: m[2] } : null;
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error: "not_configured",
      message: "El escáner aún no está activado: falta la clave de Anthropic en el servidor.",
    });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const rawImages = Array.isArray(body.images) ? body.images : (body.image ? [body.image] : []);
    const images = rawImages.map(parseDataUrl).filter(Boolean).slice(0, 3);
    if (!images.length) { res.status(400).json({ error: "bad_image" }); return; }

    const client = new Anthropic({ apiKey });
    const model = process.env.SCAN_MODEL || "claude-haiku-4-5";

    const content = [
      ...images.map((img) => ({
        type: "image",
        source: { type: "base64", media_type: img.media_type, data: img.data },
      })),
      { type: "text", text: USER_TEXT },
    ];

    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      res.status(422).json({ error: "refusal", message: "La imagen no se pudo procesar." });
      return;
    }

    const raw = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
    let parsed = null;
    if (start !== -1 && end !== -1) {
      try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch {}
    }
    if (!parsed || !Array.isArray(parsed.items)) {
      res.status(502).json({ error: "parse_failed", raw });
      return;
    }

    const METHODS = new Set(["efectivo", "zelle", "usdt", "pagoMovil", "transferencia"]);
    const items = parsed.items
      .map((it) => ({
        name: String(it.name ?? "").trim(),
        qty: Math.max(1, Math.round(Number(it.qty) || 1)),
        unitPrice: Number(it.unitPrice) || 0,
      }))
      .filter((it) => it.name);

    res.status(200).json({
      ok: true,
      data: {
        items,
        total: parsed.total != null && !isNaN(Number(parsed.total)) ? Number(parsed.total) : null,
        paymentMethod: METHODS.has(parsed.paymentMethod) ? parsed.paymentMethod : "efectivo",
        note: String(parsed.note ?? "").trim(),
      },
      model,
    });
  } catch (e) {
    const status = e?.status || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: "server_error",
      message: String(e?.message || e),
    });
  }
}
