import Anthropic from "@anthropic-ai/sdk";

// Lee una NOTA DE ENTREGA / FACTURA de compra de un distribuidor y devuelve la
// lista de mercancía para cargar al inventario. Acepta varias fotos (recibos de
// más de una página). La clave de Anthropic vive solo aquí (variable de
// entorno), nunca en el navegador.

const SYSTEM = `Eres un asistente que lee NOTAS DE ENTREGA y FACTURAS de compra que los distribuidores le entregan a una óptica (OptiLatina). El objetivo es cargar la mercancía al inventario.

Suelen ser de monturas, lentes, lentes de contacto y accesorios ópticos. Pueden venir impresas en papel térmico tenue, a mano, o repartidas en varias páginas/fotos (todas las fotos que recibes son del MISMO recibo — únelas). Lee con cuidado los códigos, descripciones, cantidades y precios.

Cada línea suele tener: Código, Descripción, Precio (unitario), Cantidad, y a veces Color/Depósito y Total.

Reglas importantes:
- AGRUPA en UNA sola entrada las líneas del MISMO producto (mismo código + misma descripción + mismo precio unitario), SUMANDO las cantidades. Ej: si "GM34 GIO SOBRELENTE" aparece 3 veces (COLOR1, COLOR2, COLOR3), devuélvelo como UNA entrada con qty 3.
- IGNORA por completo las líneas que NO son mercancía: "factura pendiente anterior", saldos anteriores, abonos, flete, descuento, IGTF, IVA, subtotales y totales generales.
- El "Precio" o "Precio Unitario" es el COSTO al que la óptica compra cada unidad (unitCost). NUNCA inventes un precio de venta.
- Si no hay columna de cantidad pero hay una línea por unidad, la cantidad es el número de líneas de ese producto.
- Incluye el código dentro de "name" cuando ayude a identificar el producto (ej: "GIO SOBRELENTE GM34").

Devuelve SOLO un objeto JSON válido, sin texto adicional, con esta forma exacta:
{
  "distributor": "nombre del distribuidor del encabezado, o ''",
  "receiptNumber": "número de la nota/factura, o ''",
  "items": [
    { "codigo": "código del producto o ''",
      "name": "descripción clara del producto",
      "qty": número entero de unidades,
      "unitCost": costo unitario en dólares (número) }
  ]
}
No inventes datos. Si un campo no aparece, usa "" o 0. Si no logras leer ninguna línea de mercancía, devuelve "items": [].`;

const USER_TEXT = "Estas fotos son de un mismo recibo de compra de un distribuidor. Lee toda la mercancía y devuelve el JSON con la lista de productos agrupados. Responde únicamente con el objeto JSON.";

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
    // Acepta varias imágenes (recibo de varias páginas) o una sola.
    const rawImages = Array.isArray(body.images) ? body.images : (body.image ? [body.image] : []);
    const images = rawImages.map(parseDataUrl).filter(Boolean).slice(0, 6);
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
      max_tokens: 8192,
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

    // Normaliza cada renglón
    const items = parsed.items
      .map((it) => ({
        codigo: String(it.codigo ?? "").trim(),
        name: String(it.name ?? "").trim(),
        qty: Math.max(0, Math.round(Number(it.qty) || 0)),
        unitCost: Number(it.unitCost) || 0,
      }))
      .filter((it) => it.name || it.codigo);

    res.status(200).json({
      ok: true,
      data: {
        distributor: String(parsed.distributor ?? "").trim(),
        receiptNumber: String(parsed.receiptNumber ?? "").trim(),
        items,
      },
      model,
      pages: images.length,
    });
  } catch (e) {
    const status = e?.status || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: "server_error",
      message: String(e?.message || e),
    });
  }
}
