// ─────────────────────────────────────────────────────
// server.js  – Backend Express + Stripe + Nodemailer
// ─────────────────────────────────────────────────────
require("dotenv").config();
const express = require("express");
const stripe  = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const path   = require("path");
const fs     = require("fs");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const app = express();
const PORT   = process.env.PORT   || 3000;
const DOMAIN = process.env.DOMAIN || `http://localhost:${PORT}`;

// ── Middlewares
app.use(express.static(path.join(__dirname, 'public')));  // sirve index.html, style.css, etc.
app.use(express.json());            // parsea JSON del body

// ─────────────────────────────────────────────────────
// Ruta para la raíz
// ─────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────────────
// 1. Crear sesión de Stripe Checkout
//    POST /create-checkout-session
// ─────────────────────────────────────────────────────
app.post("/create-checkout-session", async (req, res) => {
  const { email, name } = req.body;
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
            product_data: {
              name: "Boleto - Concierto de Cuencos de Cuarzo",
            },
            unit_amount: 35000, // $350.00 MXN
          },
          quantity: 1,
        },
      ],
      customer_email: email,
      // Usamos el placeholder oficial {CHECKOUT_SESSION_ID} para identificar
      // la compra luego y enviar el boleto de forma segura.
      success_url: `${DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url : `${DOMAIN}/cancel.html`,
      metadata: { name },          // guardamos el nombre para recuperarlo luego
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    return res.status(500).json({ error: "Error al crear la sesión de pago." });
  }
});

// ─────────────────────────────────────────────────────
// 2. Enviar boleto PDF por correo
//    GET /enviar-boleto?session_id=cs_test_123
// ─────────────────────────────────────────────────────
app.get("/enviar-boleto", async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) {
    return res.status(400).send("Falta session_id");
  }

  try {
    // 1. Recuperamos la sesión para obtener email y nombre
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const email   = session.customer_email;
    const name    = session.metadata.name || "Asistente";

    // 2. Generamos PDF + QR
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

      stream.on("finish", resolve);
      stream.on("error", reject);
    });

    // 3. Mandamos correo
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

    fs.unlinkSync(pdfPath); // eliminamos temporal

    res.send("¡Boleto enviado correctamente! Revisa tu correo.");
  } catch (err) {
    console.error("Error al enviar boleto:", err);
    res.status(500).send("No se pudo enviar el boleto.");
  }
});

// ─────────────────────────────────────────────────────
// 3. Servidor
// ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Servidor escuchando en ${DOMAIN}`);
});
