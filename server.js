require("dotenv").config();
const express = require("express");
const stripe  = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const path   = require("path");
const fs     = require("fs");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const app = express();
const PORT   = process.env.PORT;
const DOMAIN = process.env.DOMAIN || `http://localhost:${PORT}`;

// ── Middlewares
app.use(express.json()); // parsea JSON del body

// ─────────────────────────────────────────────────────
// Ruta de prueba /test para verificar si está activa
// ─────────────────────────────────────────────────────
app.get("/test", (req, res) => {
  console.log("Ruta /test llamada");
  res.send("Test OK");
});

// ─────────────────────────────────────────────────────
// 1. Crear sesión de Stripe Checkout
//    POST /create-checkout-session
// ─────────────────────────────────────────────────────
app.post("/create-checkout-session", async (req, res) => {
  const { email, name } = req.body;
  console.log("[POST /create-checkout-session] - Datos recibidos:", { email, name });

  if (!email || !name) {
    console.warn("[POST /create-checkout-session] - Falta email o nombre");
    return res.status(400).json({ error: "Nombre y correo son obligatorios." });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "mxn",
            product_data: {
              name: "Boleto - Concierto de Cuencos de Cuarzo",
            },
            unit_amount: 35000,
          },
          quantity: 1,
        },
      ],
      customer_email: email,
      success_url: `${DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url : `${DOMAIN}/cancel.html`,
      metadata: { name },
    });

    console.log("[POST /create-checkout-session] - Sesión creada con ID:", session.id);
    return res.json({ url: session.url });
  } catch (err) {
    console.error("[POST /create-checkout-session] - Error Stripe:", err);
    return res.status(500).json({ error: "Error al crear la sesión de pago." });
  }
});

// ─────────────────────────────────────────────────────
// 2. Enviar boleto PDF por correo
//    GET /enviar-boleto?session_id=cs_test_123
// ─────────────────────────────────────────────────────
app.get("/enviar-boleto", async (req, res) => {
  const { session_id } = req.query;
  console.log("Ruta /enviar-boleto fue llamada con query:", req.query);
  console.log("[GET /enviar-boleto] - session_id recibido:", session_id);

  if (!session_id) {
    console.warn("[GET /enviar-boleto] - Falta session_id en query");
    return res.status(400).send("Falta session_id");
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    console.log("[GET /enviar-boleto] - Sesión Stripe recuperada:", session.id);

    const email   = session.customer_email;
    const name    = session.metadata.name || "Asistente";

    const boletoId  = `BOL-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const qrDataUrl = await QRCode.toDataURL(boletoId);
    const pdfPath   = path.join(__dirname, `boleto_${Date.now()}.pdf`);

    await new Promise((resolve, reject) => {
      const doc = new PDFDocument();
      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);

      doc.fontSize(26).text("Boleto de Entrada", { align: "center" });
      doc.moveDown().fontSize(20).text("✨ Concierto de Cuencos de Cuarzo ✨", { align: "center" });
      doc.moveDown().fontSize(14).text(`👤 Nombre: ${name}`);
      doc.text(`📧 Correo: ${email}`);
      doc.text("📅 6 de Junio de 2025 – 19:00 h");
      doc.text("📍 Salón Haciendas del Refugio");
      doc.text(`🎟️ ID del Boleto: ${boletoId}`);
      doc.moveDown();
      doc.image(qrDataUrl, { fit: [150,150], align: "center" });
      doc.end();

      stream.on("finish", () => {
        console.log("[GET /enviar-boleto] - PDF generado:", pdfPath);
        resolve();
      });
      stream.on("error", (err) => {
        console.error("[GET /enviar-boleto] - Error al generar PDF:", err);
        reject(err);
      });
    });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.EMAIL_FROM, pass: process.env.EMAIL_PASS },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "Tu boleto para el Concierto de Cuencos de Cuarzo",
      text: "Gracias por tu compra. Adjuntamos tu boleto en PDF.",
      attachments: [{ filename: "boleto.pdf", path: pdfPath }],
    });

    console.log("[GET /enviar-boleto] - Correo enviado a:", email);
    fs.unlinkSync(pdfPath);
    console.log("[GET /enviar-boleto] - Archivo PDF eliminado:", pdfPath);

    res.send("¡Boleto enviado correctamente! Revisa tu correo.");
  } catch (err) {
    console.error("[GET /enviar-boleto] - Error al enviar boleto:", err);
    res.status(500).send("No se pudo enviar el boleto.");
  }
});

// ─────────────────────────────────────────────────────
// Ruta principal
// ─────────────────────────────────────────────────────
app.get('/', (req, res) => {
  console.log("[GET /] - Página principal solicitada");
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────────────
// Archivos estáticos (coloca esto al final)
// ─────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────
// 3. Servidor
// ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Servidor escuchando en ${DOMAIN} (Puerto ${PORT})`);
});
