require("dotenv").config();
const express      = require("express");
const stripe       = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer   = require("nodemailer");
const path         = require("path");
const fs           = require("fs");
const PDFDocument  = require("pdfkit");
const QRCode       = require("qrcode");

const app    = express();
const PORT   = process.env.PORT || 3000;
const DOMAIN = process.env.DOMAIN || `http://localhost:${PORT}`;

// ── Middlewares
app.use(express.json()); // body-parser

// Ruta de keep-alive (útil en Render free tier)
app.get("/ping", (_, res) => res.send("pong"));

// Ruta de prueba simple
app.get("/test", (_, res) => {
  console.log("👉 /test OK");
  res.send("Test OK");
});

// ─────────────────────────────────────────
// 1. Crear sesión de Stripe Checkout
// ─────────────────────────────────────────
app.post("/create-checkout-session", async (req, res) => {
  const { email, name } = req.body;
  console.log("📨 /create-checkout-session", { email, name });

  if (!email || !name) {
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
            product_data: { name: "Boleto - Concierto de Cuencos de Cuarzo" },
            unit_amount: 35000, // $350.00 MXN
          },
          quantity: 1,
        },
      ],
      customer_email: email,
      success_url: `${DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url : `${DOMAIN}/cancel.html`,
      metadata: { name, email },
    });

    console.log("✅ Sesión Stripe creada:", session.id);
    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe error:", err);
    res.status(500).json({ error: "Error al crear la sesión de pago." });
  }
});

// ─────────────────────────────────────────
// 2. Enviar boleto PDF por correo
//    GET /enviar-boleto?session_id=...
// ─────────────────────────────────────────
app.get("/enviar-boleto", async (req, res) => {
  const sessionId = req.query.session_id;
  console.log("➡️ /enviar-boleto", { sessionId });

  if (!sessionId) return res.status(400).send("Falta session_id");

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const email   = session.customer_email;
    const name    = session.metadata?.name || "Asistente";

    if (!email) throw new Error("Email no encontrado en la sesión");

    // Generar PDF
    const boletoId  = `BOL-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const qrDataUrl = await QRCode.toDataURL(boletoId);
    const pdfPath   = path.join(__dirname, `boleto_${Date.now()}.pdf`);

    await new Promise((ok, fail) => {
      const doc    = new PDFDocument();
      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);

      doc.fontSize(26).text("Boleto de Entrada", { align: "center" });
      doc.moveDown().fontSize(20).text("✨ Concierto de Cuencos de Cuarzo ✨", { align: "center" });
      doc.moveDown().fontSize(14).text(`👤 Nombre: ${name}`);
      doc.text(`📧 Correo: ${email}`);
      doc.text("📅 6-Jun-2025 19:00 h");
      doc.text("📍 Salón Haciendas del Refugio");
      doc.text(`🎟️ ID: ${boletoId}`);
      doc.moveDown();
      doc.image(qrDataUrl, { fit: [150, 150], align: "center" });
      doc.end();

      stream.on("finish", ok);
      stream.on("error" , fail);
    });

    // Enviar correo
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_FROM,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "Tu boleto para el Concierto de Cuencos de Cuarzo",
      text: "Gracias por tu compra. Adjuntamos tu boleto en PDF.",
      attachments: [{ filename: "boleto.pdf", path: pdfPath }],
    });

    fs.unlinkSync(pdfPath); // Limpieza
    console.log("📧 Correo enviado a:", email);
    res.send("¡Boleto enviado correctamente! Revisa tu correo.");
  } catch (err) {
    console.error("❌ /enviar-boleto error:", err.message);
    res.status(500).send("No se pudo enviar el boleto.");
  }
});

// Ruta principal
app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ✨ Archivos estáticos
app.use(express.static(path.join(__dirname, "public")));

// Servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor listo en ${DOMAIN} (puerto ${PORT})`);
});
