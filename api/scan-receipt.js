import Anthropic from "@anthropic-ai/sdk";

// Lee una factura de óptica (manuscrita o impresa) y devuelve los campos
// estructurados. La clave de Anthropic vive solo aquí (variable de entorno),
// nunca en el navegador.

const SYSTEM = `Eres un asistente que lee facturas de una óptica venezolana (OptiLatina) y extrae los datos en JSON.
Las facturas suelen estar escritas a mano. Lee con cuidado nombres, cédulas y montos.
Devuelve SOLO un objeto JSON válido, sin texto adicional, con estas claves:
- customer: nombre del cliente (string, "" si no aparece)
- phone: teléfono (solo dígitos con código de país si se ve, "" si no aparece)
- cedula: número de cédula/documento (string, "" si no aparece)
- orderNumber: número de orden como entero, o null
- product: descripción de lo vendido (concepto, tipo de lente/montura), string breve
- total: importe total en dólares (número), o null
- abono: monto abonado/adelantado en dólares (número), 0 si no hay
- saldo: saldo pendiente en dólares (número), o null
- method: método de pago, uno de: "efectivo","zelle","usdt","pagoMovil","transferencia". Si dice "punto"/"cashea"/"pago movil" usa "pagoMovil". Si no se distingue, usa "efectivo".
- rx: fórmula óptica resumida en una línea si aparece (OD/OI esfera-cilindro-eje, ADD), o "".
Los montos en la factura están en dólares (USD) salvo que se indique Bs. No inventes datos: si un campo no está, usa "" o null.`;

const USER_TEXT = "Lee esta factura de óptica y devuelve el JSON con los campos indicados. Responde únicamente con el objeto JSON.";

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
    const image = body.image;
    const m = typeof image === "string" && image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!m) { res.status(400).json({ error: "bad_image" }); return; }
    const mediaType = m[1];
    const data = m[2];

    const client = new Anthropic({ apiKey });
    const model = process.env.SCAN_MODEL || "claude-haiku-4-5";

    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data } },
          { type: "text", text: USER_TEXT },
        ],
      }],
    });

    if (response.stop_reason === "refusal") {
      res.status(422).json({ error: "refusal", message: "La imagen no se pudo procesar." });
      return;
    }

    const raw = response.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    // Extraer el objeto JSON aunque venga con texto alrededor
    const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
    let parsed = null;
    if (start !== -1 && end !== -1) {
      try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch {}
    }
    if (!parsed) { res.status(502).json({ error: "parse_failed", raw }); return; }

    res.status(200).json({ ok: true, data: parsed, model });
  } catch (e) {
    const status = e?.status || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: "server_error",
      message: String(e?.message || e),
    });
  }
}
