import Anthropic from "@anthropic-ai/sdk";

// Lee la foto de un TICKET DE VENTA ya escrito a mano en la tienda (papel
// físico) y devuelve los renglones vendidos para recrearlo en la app antes
// de guardarlo. El personal solo toma la foto — nunca escribe el ticket de
// nuevo. La clave de Anthropic vive solo aquí, nunca en el navegador.

const SYSTEM = `Eres un asistente que lee TICKETS DE VENTA de una óptica venezolana (OptiLatina), llenados a mano por el vendedor. Tu trabajo es transcribir el ticket para registrarlo en el sistema.

Un ticket de óptica típico incluye:
- El nombre del cliente y a veces su cédula (C.I.) y teléfono.
- La MONTURA vendida (marca/modelo/referencia). Ej: "Montura Orview ref. 68132".
- El TIPO DE CRISTAL/lente que se le pone a la montura: monofocal, progresivo, bifocal, antirreflejante, fotocromático, etc. (Esto NO es un producto aparte, es una característica del lente).
- El TOTAL de la venta (en USD salvo que diga Bs).
- El ABONO/adelanto que pagó el cliente, y el SALDO pendiente si compró a crédito.
- El MÉTODO de pago: efectivo, zelle, usdt, pago móvil, transferencia, o CASHEA (Cashea es una app de compra a crédito, muy común).

Reglas:
- "montura" = descripción de la montura/armazón vendida (marca, modelo, referencia, color si aparece).
- "crystal" = tipo de cristal/lente (una palabra: progresivo, monofocal, bifocal, antirreflejante, fotocromático, u ''). NO lo pongas dentro de "montura".
- Método: si dice "cashea" usa "cashea". Si dice "pago movil"/"punto" usa "pagoMovil". Si no se distingue, "efectivo".
- Los montos en USD salvo que se indique Bs. No inventes datos: si algo no aparece, usa "" o null o 0.

Devuelve SOLO un objeto JSON válido, sin texto adicional, con esta forma exacta:
{
  "customer": "nombre del cliente, o ''",
  "phone": "teléfono solo dígitos, o ''",
  "montura": "descripción de la montura vendida, o ''",
  "crystal": "tipo de cristal, o ''",
  "total": total en USD (número), o null,
  "abono": monto abonado en USD (número), 0 si no hay,
  "paymentMethod": uno de "efectivo","zelle","usdt","pagoMovil","transferencia","cashea"
}`;

const USER_TEXT = "Esta foto es de un ticket de venta escrito a mano en la óptica. Transcribe los datos y devuelve el JSON. Responde únicamente con el objeto JSON.";

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
    if (!parsed || typeof parsed !== "object") {
      res.status(502).json({ error: "parse_failed", raw });
      return;
    }

    const METHODS = new Set(["efectivo", "zelle", "usdt", "pagoMovil", "transferencia", "cashea"]);
    const num = (v) => (v != null && !isNaN(Number(v)) ? Number(v) : 0);

    res.status(200).json({
      ok: true,
      data: {
        customer: String(parsed.customer ?? "").trim(),
        phone: String(parsed.phone ?? "").replace(/\D/g, ""),
        montura: String(parsed.montura ?? "").trim(),
        crystal: String(parsed.crystal ?? "").trim(),
        total: parsed.total != null && !isNaN(Number(parsed.total)) ? Number(parsed.total) : null,
        abono: num(parsed.abono),
        paymentMethod: METHODS.has(parsed.paymentMethod) ? parsed.paymentMethod : "efectivo",
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
