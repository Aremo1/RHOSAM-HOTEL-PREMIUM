require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const crypto = require("crypto");
const http = require("http");
const WebSocket = require("ws");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 5000;
const SECRET = process.env.JWT_SECRET || "rhosam-hotel-premium-secret";
const SALT_ROUNDS = 12;

// ── Database ───────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => console.error("[DB] Pool error:", err.message));

// ── WebSocket Server for Real-Time Notifications ──────────────
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

// Connected clients map: userId -> Set<WebSocket>
const wsClients = new Map();

wss.on("connection", (ws, req) => {
  // Extract token from query string
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  let userId = null;
  try {
    const decoded = jwt.verify(token, SECRET);
    userId = decoded.id;
  } catch { ws.close(1008, "Invalid token"); return; }

  if (!userId) { ws.close(1008, "No user ID"); return; }

  // Register client
  if (!wsClients.has(userId)) wsClients.set(userId, new Set());
  wsClients.get(userId).add(ws);
  console.log(`[WS] User ${userId} connected (${wsClients.get(userId).size} connections)`);

  ws.on("close", () => {
    const clients = wsClients.get(userId);
    if (clients) { clients.delete(ws); if (clients.size === 0) wsClients.delete(userId); }
    console.log(`[WS] User ${userId} disconnected`);
  });

  ws.on("error", (err) => console.error(`[WS] Error for user ${userId}:`, err.message));
});

// Broadcast notification to specific user
function pushNotification(userId, notification) {
  const clients = wsClients.get(userId);
  if (clients && clients.size > 0) {
    const msg = JSON.stringify({ type: "notification", data: notification });
    clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
  }
}

// Broadcast to all connected clients
function broadcastAll(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
}

// ── Email Service (Nodemailer) ─────────────────────────────────
const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: process.env.SMTP_USER ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  } : null,
});
const EMAIL_FROM = process.env.EMAIL_FROM || "RHoSAM Hotel <noreply@rhosamhotel.com>";

// ── SMS Service (HTTP-based, pluggable) ────────────────────────
const SMS_API_URL = process.env.SMS_API_URL || ""; // e.g. https://api.africastalking.com/version1/messaging
const SMS_API_KEY = process.env.SMS_API_KEY || "";
const SMS_SENDER_ID = process.env.SMS_SENDER_ID || "RHoSAM";

async function sendEmail(to, subject, htmlBody) {
  if (!process.env.SMTP_USER) {
    console.log(`[EMAIL-SKIPPED] No SMTP configured. Would send to ${to}: ${subject}`);
    return { ok: false, reason: "SMTP not configured" };
  }
  try {
    await emailTransporter.sendMail({ from: EMAIL_FROM, to, subject, html: htmlBody });
    console.log(`[EMAIL] Sent to ${to}: ${subject}`);
    return { ok: true };
  } catch (e) {
    console.error(`[EMAIL] Failed to ${to}:`, e.message);
    return { ok: false, reason: e.message };
  }
}

async function sendSMS(to, message) {
  if (!SMS_API_URL || !SMS_API_KEY) {
    console.log(`[SMS-SKIPPED] No SMS API configured. Would send to ${to}: ${message.substring(0, 50)}...`);
    return { ok: false, reason: "SMS API not configured" };
  }
  try {
    const params = new URLSearchParams();
    params.append("username", process.env.SMS_USERNAME || "");
    params.append("to", to);
    params.append("message", message);
    params.append("from", SMS_SENDER_ID);
    const res = await fetch(SMS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "apiKey": SMS_API_KEY },
      body: params.toString(),
    });
    const data = await res.json();
    if (data.SMSMessageData?.Recipients?.[0]?.status === "Success" || data.status === "success") {
      console.log(`[SMS] Sent to ${to}`);
      return { ok: true };
    }
    console.error(`[SMS] Failed:`, JSON.stringify(data));
    return { ok: false, reason: JSON.stringify(data) };
  } catch (e) {
    console.error(`[SMS] Failed to ${to}:`, e.message);
    return { ok: false, reason: e.message };
  }
}

// ── Guest Notification Delivery (Email + SMS) ──────────────────
async function deliverGuestNotification(guestId, title, body, notificationType) {
  try {
    // Get guest details
    const { rows: guests } = await pool.query(`SELECT * FROM guests WHERE id=$1`, [guestId]);
    const guest = guests[0];
    if (!guest) return;

    // Check guest notification preferences
    const { rows: prefs } = await pool.query(`SELECT * FROM guest_notification_preferences WHERE guest_id=$1`, [guestId]);
    const pref = prefs[0] || { email_enabled: true, sms_enabled: true };

    const results = { email: null, sms: null };

    // Email delivery
    if (guest.email && pref.email_enabled !== false) {
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px">
          <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;padding:24px;border-radius:12px 12px 0 0;text-align:center">
            <h1 style="margin:0;font-size:18px">🏨 RHoSAM Hotel & Suites</h1>
          </div>
          <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px">
            <h2 style="margin:0 0 12px;font-size:16px;color:#1f2937">${title}</h2>
            <p style="color:#374151;line-height:1.6;margin:0 0 16px">${body}</p>
            <div style="border-top:1px solid #e5e7eb;padding-top:12px;color:#9ca3af;font-size:12px;text-align:center">
              RHoSAM Hotel & Suites · ${new Date().toLocaleDateString("en-NG", { dateStyle: "medium" })}
            </div>
          </div>
        </div>`;
      results.email = await sendEmail(guest.email, `RHoSAM Hotel: ${title}`, html);
    }

    // SMS delivery
    if (guest.phone && pref.sms_enabled !== false) {
      const smsBody = `RHoSAM Hotel: ${title}\n${body}`;
      results.sms = await sendSMS(guest.phone, smsBody);
    }

    // Log delivery
    await pool.query(
      `INSERT INTO guest_notification_log(guest_id, notification_type, title, body, email_sent, email_status, sms_sent, sms_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [guestId, notificationType || "GENERAL", title, body, !!results.email?.ok, results.email?.reason || "sent", !!results.sms?.ok, results.sms?.reason || "sent"]
    );

    return results;
  } catch (e) {
    console.error("[Guest Notification] Delivery error:", e.message);
  }
}

// Helper: create notification + push via WebSocket + deliver email/SMS to guests
async function createNotification(userId, title, body, type, refType, refId) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO notifications(user_id, title, body, type, reference_type, reference_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [userId, title, body, type || 'INFO', refType || null, refId || null]
    );
    pushNotification(userId, rows[0]);

    // Check if this userId belongs to a guest — if so, deliver via email/SMS
    try {
      const { rows: guestCheck } = await pool.query(
        `SELECT id FROM guests WHERE id=$1`, [userId]
      );
      if (guestCheck[0]) {
        // Fire-and-forget: don't block the notification creation
        deliverGuestNotification(userId, title, body, type).catch(e =>
          console.error("[Guest Notification] Async delivery failed:", e.message)
        );
      }
    } catch {}

    return rows[0];
  } catch (e) { console.error("[Notification] Create error:", e.message); }
}

// Helper: notify multiple users
async function notifyUsers(userIds, title, body, type, refType, refId) {
  for (const uid of userIds) {
    await createNotification(uid, title, body, type, refType, refId);
  }
}

// Helper: notify all users with a role
async function notifyByRole(roles, title, body, type, refType, refId) {
  const placeholders = roles.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await pool.query(`SELECT id FROM users WHERE role IN (${placeholders}) AND is_active=TRUE`, roles);
  for (const u of rows) {
    await createNotification(u.id, title, body, type, refType, refId);
  }
}

// ── Middleware ──────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const auth = (req, res, next) => {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!t) return res.status(401).json({ message: "Authentication required." });
  try { req.user = jwt.verify(t, SECRET); next(); }
  catch { return res.status(401).json({ message: "Session expired." }); }
};

const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ message: "Permission denied." });

async function audit(c, userId, action, entity, entityId, details = {}, req = null) {
  const ip = req ? (req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim() : null;
  const ua = req ? req.headers["user-agent"] || null : null;
  await c.query(
    "INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details,ip_address,user_agent) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [userId, action, entity, String(entityId || ""), JSON.stringify(details), ip, ua]
  );
}

async function notify(c, userId, title, body, type = "INFO", refType = null, refId = null) {
  await c.query(
    "INSERT INTO notifications(user_id,title,body,type,reference_type,reference_id) VALUES($1,$2,$3,$4,$5,$6)",
    [userId, title, body, type, refType, refId]
  );
}

// ═══════════════════════════════════════════════════════════════════
// DATABASE MIGRATION
// ═══════════════════════════════════════════════════════════════════
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'STAFF',
        department TEXT,
        phone TEXT,
        avatar_url TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS room_types (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        base_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
        max_occupancy INT DEFAULT 2,
        amenities TEXT[] DEFAULT '{}',
        image_url TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        number TEXT UNIQUE NOT NULL,
        floor INT NOT NULL,
        room_type_id INT REFERENCES room_types(id),
        status TEXT NOT NULL DEFAULT 'AVAILABLE',
        notes TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS guests (
        id SERIAL PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        nationality TEXT,
        id_type TEXT,
        id_number TEXT,
        date_of_birth DATE,
        gender TEXT,
        address TEXT,
        loyalty_tier TEXT DEFAULT 'BRONZE',
        loyalty_points INT DEFAULT 0,
        total_stays INT DEFAULT 0,
        total_spent NUMERIC(14,2) DEFAULT 0,
        preferences JSONB DEFAULT '{}',
        allergies TEXT,
        dietary_notes TEXT,
        vip_notes TEXT,
        consent_marketing BOOLEAN DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY,
        confirmation_number TEXT UNIQUE NOT NULL,
        guest_id INT REFERENCES guests(id),
        room_id INT REFERENCES rooms(id),
        room_type_id INT REFERENCES room_types(id),
        check_in DATE NOT NULL,
        check_out DATE NOT NULL,
        adults INT DEFAULT 1,
        children INT DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'PENDING',
        rate NUMERIC(12,2) NOT NULL,
        total_amount NUMERIC(14,2) DEFAULT 0,
        deposit_amount NUMERIC(14,2) DEFAULT 0,
        payment_status TEXT DEFAULT 'UNPAID',
        special_requests TEXT,
        source TEXT DEFAULT 'DIRECT',
        corporate_account TEXT,
        arrival_time TIME,
        is_vip BOOLEAN DEFAULT FALSE,
        created_by INT REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS folios (
        id SERIAL PRIMARY KEY,
        reservation_id INT REFERENCES reservations(id),
        guest_id INT REFERENCES guests(id),
        status TEXT DEFAULT 'OPEN',
        total_charges NUMERIC(14,2) DEFAULT 0,
        total_payments NUMERIC(14,2) DEFAULT 0,
        balance NUMERIC(14,2) DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS folio_items (
        id SERIAL PRIMARY KEY,
        folio_id INT REFERENCES folios(id),
        description TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        category TEXT DEFAULT 'OTHER',
        posted_by INT REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS housekeeping_tasks (
        id SERIAL PRIMARY KEY,
        room_id INT REFERENCES rooms(id),
        task_type TEXT NOT NULL DEFAULT 'CLEANING',
        status TEXT NOT NULL DEFAULT 'PENDING',
        priority TEXT DEFAULT 'NORMAL',
        assigned_to INT REFERENCES users(id),
        notes TEXT,
        checklist JSONB DEFAULT '{}',
        inspection_score INT,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS maintenance_requests (
        id SERIAL PRIMARY KEY,
        room_id INT REFERENCES rooms(id),
        title TEXT NOT NULL,
        description TEXT,
        category TEXT DEFAULT 'GENERAL',
        priority TEXT DEFAULT 'NORMAL',
        status TEXT DEFAULT 'OPEN',
        assigned_to INT REFERENCES users(id),
        estimated_cost NUMERIC(10,2) DEFAULT 0,
        actual_cost NUMERIC(10,2) DEFAULT 0,
        parts_used TEXT,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS restaurant_menu (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        price NUMERIC(10,2) NOT NULL,
        is_available BOOLEAN DEFAULT TRUE,
        is_vegetarian BOOLEAN DEFAULT FALSE,
        is_vegan BOOLEAN DEFAULT FALSE,
        allergens TEXT[] DEFAULT '{}',
        preparation_time INT DEFAULT 15,
        image_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS restaurant_orders (
        id SERIAL PRIMARY KEY,
        reservation_id INT REFERENCES reservations(id),
        room_id INT REFERENCES rooms(id),
        order_type TEXT DEFAULT 'ROOM_SERVICE',
        status TEXT DEFAULT 'PENDING',
        total_amount NUMERIC(10,2) DEFAULT 0,
        notes TEXT,
        ordered_by INT REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS restaurant_order_items (
        id SERIAL PRIMARY KEY,
        order_id INT REFERENCES restaurant_orders(id) ON DELETE CASCADE,
        menu_item_id INT REFERENCES restaurant_menu(id),
        quantity INT DEFAULT 1,
        unit_price NUMERIC(10,2) NOT NULL,
        subtotal NUMERIC(10,2) NOT NULL,
        special_instructions TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS spa_services (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        duration_minutes INT DEFAULT 60,
        price NUMERIC(10,2) NOT NULL,
        is_available BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS spa_appointments (
        id SERIAL PRIMARY KEY,
        guest_id INT REFERENCES guests(id),
        service_id INT REFERENCES spa_services(id),
        reservation_id INT REFERENCES reservations(id),
        appointment_date DATE NOT NULL,
        appointment_time TIME NOT NULL,
        therapist_name TEXT,
        status TEXT DEFAULT 'SCHEDULED',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        event_type TEXT NOT NULL,
        space_name TEXT,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        start_time TIME,
        end_time TIME,
        guest_count INT DEFAULT 0,
        estimated_revenue NUMERIC(12,2) DEFAULT 0,
        actual_revenue NUMERIC(12,2) DEFAULT 0,
        status TEXT DEFAULT 'INQUIRY',
        contact_name TEXT,
        contact_email TEXT,
        contact_phone TEXT,
        notes TEXT,
        created_by INT REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS event_services (
        id SERIAL PRIMARY KEY,
        event_id INT REFERENCES events(id) ON DELETE CASCADE,
        service_name TEXT NOT NULL,
        description TEXT,
        quantity INT DEFAULT 1,
        unit_price NUMERIC(10,2) DEFAULT 0,
        total_price NUMERIC(10,2) DEFAULT 0,
        status TEXT DEFAULT 'PENDING',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        invoice_number TEXT UNIQUE NOT NULL,
        guest_id INT REFERENCES guests(id),
        reservation_id INT REFERENCES reservations(id),
        folio_id INT REFERENCES folios(id),
        subtotal NUMERIC(14,2) DEFAULT 0,
        tax_amount NUMERIC(14,2) DEFAULT 0,
        service_charge NUMERIC(14,2) DEFAULT 0,
        discount NUMERIC(14,2) DEFAULT 0,
        total NUMERIC(14,2) DEFAULT 0,
        status TEXT DEFAULT 'DRAFT',
        issued_at TIMESTAMPTZ,
        paid_at TIMESTAMPTZ,
        payment_method TEXT,
        created_by INT REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS expense_categories (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        budget NUMERIC(12,2) DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        category_id INT REFERENCES expense_categories(id),
        description TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        vendor TEXT,
        receipt_number TEXT,
        status TEXT DEFAULT 'PENDING',
        approved_by INT REFERENCES users(id),
        created_by INT REFERENCES users(id),
        expense_date DATE DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS employee_shifts (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        shift_date DATE NOT NULL,
        shift_start TIME NOT NULL,
        shift_end TIME NOT NULL,
        department TEXT,
        status TEXT DEFAULT 'SCHEDULED',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS employee_preferences (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) UNIQUE,
        preferred_shift TEXT DEFAULT 'Morning',
        preferred_days TEXT DEFAULT '[1,2,3,4,5]',
        max_hours_weekly INT DEFAULT 40,
        preferred_department TEXT,
        notes TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS shift_swaps (
        id SERIAL PRIMARY KEY,
        requester_id INT REFERENCES users(id) NOT NULL,
        requester_shift_id INT REFERENCES employee_shifts(id) NOT NULL,
        target_id INT REFERENCES users(id),
        target_shift_id INT REFERENCES employee_shifts(id),
        swap_type TEXT DEFAULT 'TRADE',
        status TEXT DEFAULT 'PENDING',
        reason TEXT,
        reviewer_id INT REFERENCES users(id),
        reviewer_notes TEXT,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS security_incidents (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        incident_type TEXT NOT NULL,
        severity TEXT DEFAULT 'LOW',
        location TEXT,
        description TEXT,
        reported_by INT REFERENCES users(id),
        status TEXT DEFAULT 'OPEN',
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS guest_requests (
        id SERIAL PRIMARY KEY,
        guest_id INT REFERENCES guests(id),
        reservation_id INT REFERENCES reservations(id),
        room_id INT REFERENCES rooms(id),
        request_type TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT DEFAULT 'PENDING',
        priority TEXT DEFAULT 'NORMAL',
        assigned_to INT REFERENCES users(id),
        response_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        details JSONB DEFAULT '{}',
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        title TEXT NOT NULL,
        body TEXT,
        type TEXT DEFAULT 'INFO',
        is_read BOOLEAN DEFAULT FALSE,
        reference_type TEXT,
        reference_id INT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notification_preferences (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) UNIQUE,
        room_service_updates BOOLEAN DEFAULT TRUE,
        spa_reminders BOOLEAN DEFAULT TRUE,
        housekeeping_updates BOOLEAN DEFAULT TRUE,
        maintenance_updates BOOLEAN DEFAULT TRUE,
        guest_requests BOOLEAN DEFAULT TRUE,
        shift_updates BOOLEAN DEFAULT TRUE,
        security_alerts BOOLEAN DEFAULT TRUE,
        general BOOLEAN DEFAULT TRUE,
        sound_enabled BOOLEAN DEFAULT TRUE,
        email_enabled BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS digital_keys (
        id SERIAL PRIMARY KEY,
        guest_id INT REFERENCES guests(id),
        reservation_id INT REFERENCES reservations(id),
        room_id INT REFERENCES rooms(id),
        key_code TEXT NOT NULL,
        key_type TEXT DEFAULT 'QR',
        permissions JSONB DEFAULT '{"lock":true,"lights":true,"ac":true,"tv":true}',
        is_active BOOLEAN DEFAULT TRUE,
        is_revoked BOOLEAN DEFAULT FALSE,
        activated_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS room_controls (
        id SERIAL PRIMARY KEY,
        room_id INT REFERENCES rooms(id) UNIQUE,
        lights_main BOOLEAN DEFAULT TRUE,
        lights_bedroom BOOLEAN DEFAULT FALSE,
        lights_bathroom BOOLEAN DEFAULT FALSE,
        lights_mood BOOLEAN DEFAULT FALSE,
        ac_enabled BOOLEAN DEFAULT TRUE,
        ac_temperature INT DEFAULT 22,
        ac_mode TEXT DEFAULT 'COOL',
        ac_fan_speed TEXT DEFAULT 'AUTO',
        tv_on BOOLEAN DEFAULT FALSE,
        tv_channel INT DEFAULT 1,
        tv_volume INT DEFAULT 30,
        curtains_open BOOLEAN DEFAULT TRUE,
        do_not_disturb BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS key_access_log (
        id SERIAL PRIMARY KEY,
        key_id INT REFERENCES digital_keys(id),
        room_id INT REFERENCES rooms(id),
        guest_id INT REFERENCES guests(id),
        action TEXT NOT NULL,
        method TEXT DEFAULT 'QR',
        success BOOLEAN DEFAULT TRUE,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Guest notification preferences (email/SMS opt-in)
      CREATE TABLE IF NOT EXISTS guest_notification_preferences (
        id SERIAL PRIMARY KEY,
        guest_id INT REFERENCES guests(id) UNIQUE,
        email_enabled BOOLEAN DEFAULT TRUE,
        sms_enabled BOOLEAN DEFAULT TRUE,
        room_service_updates BOOLEAN DEFAULT TRUE,
        spa_updates BOOLEAN DEFAULT TRUE,
        checkin_checkout BOOLEAN DEFAULT TRUE,
        promotions BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Guest notification delivery log
      CREATE TABLE IF NOT EXISTS guest_notification_log (
        id SERIAL PRIMARY KEY,
        guest_id INT REFERENCES guests(id),
        notification_type TEXT DEFAULT 'GENERAL',
        title TEXT,
        body TEXT,
        email_sent BOOLEAN DEFAULT FALSE,
        email_status TEXT DEFAULT '',
        sms_sent BOOLEAN DEFAULT FALSE,
        sms_status TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Conflict history log
      CREATE TABLE IF NOT EXISTS conflict_history (
        id SERIAL PRIMARY KEY,
        conflict_type TEXT NOT NULL,
        severity TEXT DEFAULT 'WARNING',
        date TEXT,
        department TEXT,
        employee_name TEXT,
        employee_id INT,
        message TEXT,
        details JSONB DEFAULT '{}',
        detected_by TEXT DEFAULT 'AUTO',
        alert_sent BOOLEAN DEFAULT FALSE,
        resolved BOOLEAN DEFAULT FALSE,
        resolved_by TEXT,
        resolved_at TIMESTAMPTZ,
        resolution_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS local_experiences (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        short_description TEXT,
        location TEXT,
        distance_km DECIMAL(4,1),
        duration_hours DECIMAL(4,1),
        price_from DECIMAL(12,2),
        price_currency TEXT DEFAULT 'NGN',
        rating DECIMAL(2,1) DEFAULT 4.5,
        review_count INT DEFAULT 0,
        image_url TEXT,
        highlights JSONB DEFAULT '{}',
        availability TEXT DEFAULT 'AVAILABLE',
        max_group_size INT DEFAULT 10,
        includes JSONB DEFAULT '{}',
        is_featured BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS experience_bookings (
        id SERIAL PRIMARY KEY,
        guest_id INT REFERENCES guests(id),
        reservation_id INT REFERENCES reservations(id),
        experience_id INT REFERENCES local_experiences(id),
        booking_date DATE NOT NULL,
        booking_time TEXT,
        group_size INT DEFAULT 1,
        total_price DECIMAL(12,2),
        special_requests TEXT,
        contact_phone TEXT,
        status TEXT DEFAULT 'PENDING',
        concierge_notes TEXT,
        confirmed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS employee_pay_rates (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) UNIQUE,
        hourly_rate DECIMAL(10,2) DEFAULT 5000,
        overtime_multiplier DECIMAL(3,1) DEFAULT 1.5,
        night_shift_premium DECIMAL(3,1) DEFAULT 1.25,
        weekend_premium DECIMAL(3,1) DEFAULT 1.5,
        holiday_premium DECIMAL(3,1) DEFAULT 2.0,
        currency TEXT DEFAULT 'NGN',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS hotel_config (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("COMMIT");
    console.log("[MIGRATE] Schema ready");
  } catch (e) { await client.query("ROLLBACK"); console.error("[MIGRATE] Error:", e.message); }
  finally { client.release(); }
}

// ═══════════════════════════════════════════════════════════════════
// SEED DATA
// ═══════════════════════════════════════════════════════════════════
async function seed() {
  const client = await pool.connect();
  try {
    const { rows: existing } = await client.query("SELECT COUNT(*)::int AS c FROM users");
    if (existing[0].c > 0) { console.log("[SEED] Data exists, skipping."); return; }

    await client.query("BEGIN");

    // Admin user
    const adminHash = await bcrypt.hash("admin123", SALT_ROUNDS);
    const { rows: [admin] } = await client.query(
      "INSERT INTO users(name,email,password_hash,role,department) VALUES($1,$2,$3,$4,$5) RETURNING id",
      ["Samson Admin", "admin@rhosamhotel.com", adminHash, "ADMIN", "Management"]
    );

    // Staff users
    const staffData = [
      ["Grace Okafor", "grace@rhosamhotel.com", "FRONT_DESK", "Front Office"],
      ["Emeka Nwosu", "emeka@rhosamhotel.com", "HOUSEKEEPING", "Housekeeping"],
      ["Fatima Abubakar", "fatima@rhosamhotel.com", "MANAGER", "Operations"],
      ["Chidi Eze", "chidi@rhosamhotel.com", "RESTAURANT", "Food & Beverage"],
      ["Bola Adeyemi", "bola@rhosamhotel.com", "MAINTENANCE", "Engineering"],
    ];
    for (const [name, email, role, dept] of staffData) {
      const h = await bcrypt.hash("staff123", SALT_ROUNDS);
      await client.query("INSERT INTO users(name,email,password_hash,role,department) VALUES($1,$2,$3,$4,$5)", [name, email, h, role, dept]);
    }

    // Room types
    const roomTypes = [
      ["Standard Room", "Comfortable room with modern amenities", 45000, 2, ["WiFi","TV","AC","Mini Bar","Safe"]],
      ["Deluxe Room", "Spacious room with city view", 75000, 2, ["WiFi","TV","AC","Mini Bar","Safe","Balcony"]],
      ["Executive Suite", "Premium suite with separate living area", 120000, 3, ["WiFi","TV","AC","Mini Bar","Safe","Balcony","Living Room","Nespresso"]],
      ["Royal Suite", "Luxury suite with panoramic views", 200000, 4, ["WiFi","TV","AC","Mini Bar","Safe","Balcony","Living Room","Dining","Jacuzzi","Butler"]],
        ["Penthouse Suite", "Top-floor presidential suite", 350000, 4, ["WiFi","TV","AC","Mini Bar","Safe","Terrace","Living Room","Dining","Jacuzzi","Private Pool","Butler","Helipad"]],
    ];
    for (const [name, desc, rate, occ, amenities] of roomTypes) {
      await client.query("INSERT INTO room_types(name,description,base_rate,max_occupancy,amenities) VALUES($1,$2,$3,$4,$5)", [name, desc, rate, occ, amenities]);
    }

    // Rooms
    const rooms = [];
    for (let floor = 1; floor <= 10; floor++) {
      for (let num = 1; num <= 5; num++) {
        const roomNum = `${floor}0${num}`;
        const typeIdx = floor <= 2 ? 0 : floor <= 5 ? 1 : floor <= 8 ? 2 : 3;
        const statuses = ["AVAILABLE", "AVAILABLE", "AVAILABLE", "OCCUPIED", "CLEAN", "DIRTY"];
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        rooms.push([roomNum, floor, typeIdx + 1, status]);
      }
    }
    for (const [num, floor, typeId, status] of rooms) {
      await client.query("INSERT INTO rooms(number,floor,room_type_id,status) VALUES($1,$2,$3,$4)", [num, floor, typeId, status]);
    }

    // Guests
    const guestData = [
      ["Adaeze", "Nwosu", "adaeze@email.com", "+234-801-234-5678", "Nigerian", "PLATINUM", 14, 2800000],
      ["David", "Okonkwo", "david@email.com", "+234-802-345-6789", "Nigerian", "GOLD", 8, 960000],
      ["Sarah", "Johnson", "sarah.j@email.com", "+44-7700-900123", "British", "GOLD", 6, 720000],
      ["Ahmed", "Al-Rashid", "ahmed@email.com", "+971-50-123-4567", "Emirati", "PLATINUM", 12, 3600000],
      ["Maria", "Silva", "maria@email.com", "+55-11-98765-4321", "Brazilian", "SILVER", 4, 360000],
      ["Chen", "Wei", "chen@email.com", "+86-138-0013-8000", "Chinese", "GOLD", 7, 840000],
      ["Olivia", "Martinez", "olivia@email.com", "+34-612-345-678", "Spanish", "BRONZE", 2, 150000],
      ["James", "Williams", "james.w@email.com", "+1-212-555-0199", "American", "SILVER", 5, 600000],
      ["Fatima", "Hassan", "fatima.h@email.com", "+971-55-987-6543", "Emirati", "PLATINUM", 10, 2400000],
      ["Ngozi", "Okafor", "ngozi@email.com", "+234-803-456-7890", "Nigerian", "GOLD", 9, 1080000],
    ];
    const guestIds = [];
    for (const [fn, ln, em, ph, nat, tier, stays, spent] of guestData) {
      const { rows } = await client.query(
        "INSERT INTO guests(first_name,last_name,email,phone,nationality,loyalty_tier,total_stays,total_spent) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
        [fn, ln, em, ph, nat, tier, stays, spent]
      );
      guestIds.push(rows[0].id);
    }

    // Reservations
    const today = new Date().toISOString().slice(0, 10);
    const resData = [
      [guestIds[0], 3, 3, today, addDays(today, 3), 1, 0, "CONFIRMED", 120000, 360000, 50000, "PAID", "VIP guest - feather-free room, jasmine tea", "DIRECT", true],
      [guestIds[1], 5, 1, today, addDays(today, 2), 2, 1, "CHECKED_IN", 75000, 150000, 75000, "PARTIAL", "Late checkout preferred", "DIRECT", false],
      [guestIds[2], 8, 2, addDays(today, 1), addDays(today, 4), 1, 0, "CONFIRMED", 45000, 135000, 45000, "PAID", "Airport transfer needed", "BOOKING_COM", false],
      [guestIds[3], 4, 4, today, addDays(today, 5), 2, 0, "CHECKED_IN", 200000, 1000000, 200000, "PAID", "Penthouse preferred. Personal butler.", "DIRECT", true],
      [guestIds[4], 10, 1, addDays(today, 2), addDays(today, 5), 2, 0, "CONFIRMED", 45000, 135000, 0, "UNPAID", "", "EXPEDIA", false],
      [guestIds[5], 12, 2, addDays(today, 1), addDays(today, 3), 1, 0, "PENDING", 75000, 150000, 0, "UNPAID", "", "DIRECT", false],
    ];
    for (const [gid, rid, rtype, ci, co, ad, ch, st, rate, tot, dep, ps, sr, src, vip] of resData) {
      const conf = genConfirmation();
      await client.query(
        `INSERT INTO reservations(confirmation_number,guest_id,room_id,room_type_id,check_in,check_out,adults,children,status,rate,total_amount,deposit_amount,payment_status,special_requests,source,is_vip,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [conf, gid, rid, rtype, ci, co, ad, ch, st, rate, tot, dep, ps, sr, src, vip, admin.id]
      );
    }

    // Restaurant menu items
    const menuItems = [
      ["Jollof Rice Special", "Main Course", "Premium Nigerian jollof with grilled chicken", 8500, true, false, ["Gluten"], 25],
      ["Grilled Tilapia", "Main Course", "Fresh tilapia with plantain and pepper sauce", 12000, true, false, ["Fish"], 30],
      ["Caesar Salad", "Starter", "Classic Caesar with parmesan and croutons", 5500, true, false, ["Gluten","Dairy"], 10],
      ["Pounded Yam & Egusi", "Main Course", "Traditional pounded yam with egusi soup", 7500, true, false, ["Nuts"], 20],
      ["Wagyu Steak", "Main Course", "A5 Wagyu with truffle mash and asparagus", 45000, true, false, ["Dairy"], 35],
      ["Lobster Thermidor", "Main Course", "Atlantic lobster in creamy cognac sauce", 38000, true, false, ["Shellfish","Dairy"], 40],
      ["Tiramisu", "Dessert", "Classic Italian tiramisu", 4500, true, false, ["Gluten","Dairy","Eggs"], 5],
      ["Chocolate Fondant", "Dessert", "Warm chocolate cake with vanilla ice cream", 5500, true, false, ["Gluten","Dairy","Eggs"], 15],
      ["Fresh Fruit Platter", "Dessert", "Seasonal tropical fruits", 3500, true, true, [], 5],
      ["Nigerian Spicy Wings", "Starter", "Crispy chicken wings with suya spice", 6000, true, false, [], 15],
      ["French Onion Soup", "Starter", "Classic onion soup with gruyere crouton", 4500, true, false, ["Gluten","Dairy"], 12],
      ["Champagne Brunch Buffet", "Package", "Weekend brunch with unlimited champagne", 35000, true, false, [], 0],
    ];
    for (const [n, c, d, p, av, veg, all, pt] of menuItems) {
      await client.query(
        "INSERT INTO restaurant_menu(name,category,description,price,is_available,is_vegetarian,allergens,preparation_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [n, c, d, p, av, veg, all, pt]
      );
    }

    // Spa services
    const spaServices = [
      ["Swedish Massage", "Massage", "Full body relaxation massage", 60, 25000],
      ["Deep Tissue Massage", "Massage", "Therapeutic deep tissue treatment", 90, 35000],
      ["Royal Facial", "Facial", "Luxury facial with gold serum", 75, 30000],
      ["Body Scrub & Wrap", "Body Treatment", "Exfoliating body scrub with hydrating wrap", 60, 28000],
      ["Manicure & Pedicure", "Nail Care", "Complete nail grooming service", 90, 15000],
      ["Hot Stone Therapy", "Massage", "Heated stone relaxation therapy", 75, 32000],
      ["Couples Retreat Package", "Package", "Side-by-side massage with champagne", 120, 65000],
    ];
    for (const [n, c, d, dur, p] of spaServices) {
      await client.query("INSERT INTO spa_services(name,category,description,duration_minutes,price) VALUES($1,$2,$3,$4,$5)", [n, c, d, dur, p]);
    }

    // Events
    await client.query(
      `INSERT INTO events(title,event_type,space_name,start_date,end_date,start_time,end_time,guest_count,estimated_revenue,status,contact_name,contact_email,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      ["Nwosu Wedding Reception", "Wedding", "Grand Ballroom", addDays(today, 14), addDays(today, 14), "16:00", "23:00", 250, 8500000, "CONFIRMED", "Chidi Nwosu", "chidi@email.com", admin.id]
    );
    await client.query(
      `INSERT INTO events(title,event_type,space_name,start_date,end_date,start_time,end_time,guest_count,estimated_revenue,status,contact_name,contact_email,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      ["Tech Conference 2026", "Conference", "Royal Conference Hall", addDays(today, 7), addDays(today, 9), "08:00", "17:00", 150, 4200000, "CONFIRMED", "Dr. Adebayo", "adebayo@techconf.ng", admin.id]
    );

    // Expense categories
    const expenseCats = ["Housekeeping Supplies", "Food & Beverage", "Utilities", "Maintenance", "Marketing", "Staff Welfare", "Technology", "Security"];
    for (const name of expenseCats) {
      await client.query("INSERT INTO expense_categories(name,budget) VALUES($1,$2)", [name, Math.floor(Math.random() * 5000000) + 1000000]);
    }

    // Security incidents
    await client.query(
      "INSERT INTO security_incidents(title,incident_type,severity,location,description,reported_by,status) VALUES($1,$2,$3,$4,$5,$6,$7)",
      ["Suspicious visitor at lobby", "Unauthorized Access", "MEDIUM", "Main Lobby", "Unknown individual attempting to access guest floors without key card.", admin.id, "RESOLVED"]
    );

    // Guest requests
    await client.query(
      "INSERT INTO guest_requests(guest_id,reservation_id,room_id,request_type,description,status,priority) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [guestIds[0], 1, 3, "ROOM_SERVICE", "Extra pillows and jasmine tea", "COMPLETED", "HIGH"]
    );
    await client.query(
      "INSERT INTO guest_requests(guest_id,reservation_id,room_id,request_type,description,status,priority) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [guestIds[3], 4, 4, "CONCIERGE", "Airport transfer for 2 passengers tomorrow 6am", "PENDING", "URGENT"]
    );

    // Local experiences
    const experiences = [
      ["Lekki Conservation Centre", "Nature & Wildlife", "Walk the longest canopy walkway in West Africa and spot rare bird species in this 21-hectare nature reserve.", "A 15-minute drive from the hotel through Victoria Island.", 8.5, 3.0, 5000, 4.7, 128, true, '["Canopy walkway","Bird watching","Nature trails","Gift shop"]', '["Guide","Entry fee","Water"]'],
      ["Terra Kulture Art Gallery", "Culture & Arts", "Nigeria's premier art and cultural centre with rotating exhibitions, live theatre, and a restaurant.", "Located in the heart of Victoria Island.", 2.3, 2.5, 3000, 4.6, 95, true, '["Art exhibitions","Live performances","Art library","Restaurant"]', '["Entry fee","Guided tour"]'],
      ["Eko Atlantic City Tour", "Sightseeing", "Tour the futuristic Eko Atlantic city built on reclaimed land, featuring the iconic Azikiwe Tower and Marina district.", "Adjacent to Victoria Island.", 3.0, 2.0, 0, 4.5, 67, false, '["Marina views","Modern architecture","Waterfront dining","Shopping"]', '["Walking guide","City map"]'],
      ["Lagos Business Boat Cruise", "Water Activities", "Luxury boat cruise along Lagos Lagoon with cocktails, live music, and sunset views over the Third Mainland Bridge.", "Departing from Victoria Island Marina.", 1.5, 3.0, 45000, 4.8, 210, true, '["Sunset views","Open bar","Live DJ","Photography"]', '["Cruise","Drinks","Snacks","Life jacket"]'],
      ["Nike Art Gallery & Workshop", "Culture & Arts", "West Africa's largest art gallery with over 3,000 artworks and hands-on adire textile workshop experience.", "Located in Lekki Phase 1.", 5.2, 3.5, 8000, 4.9, 156, true, '["Art gallery","Textile workshop","Sculpture garden","Cafe"]', '["Workshop materials","Guide","Refreshments"]'],
      ["Tensega Hills Resort Day Pass", "Luxury & Leisure", "Exclusive day pass to the hilltop resort with infinity pool, spa, tennis courts and gourmet dining.", "In Ibeju-Lekki area.", 35.0, 8.0, 65000, 4.7, 89, false, '["Infinity pool","Spa access","Tennis court","Gourmet lunch"]', '["Day pass","Lunch","Pool access","Towel"]'],
      ["Lagos Food Tour — Street Eats", "Food & Drink", "Guided culinary adventure through Lagos' best street food spots — suya, puff-puff, jollof rice, and more.", "Starting from Balogun Market.", 6.0, 4.0, 15000, 4.8, 312, true, '["8 tastings","Local guide","Market tour","Transport"]', '["All food tastings","Guide","Transport","Water"]'],
      ["Abuja Day Trip by Private Jet", "Exclusive Experiences", "Fly to Abuja for a day of sightseeing — visit Aso Rock, Millennium Park, and the National Mosque.", "Private jet from Lagos.", 0, 12.0, 850000, 4.9, 24, false, '["Private jet","VIP lounge","Chauffeur","Lunch"]', '["Flight","Ground transport","Lunch","Guide"]'],
      ["Cooking Class — Nigerian Cuisine", "Food & Drink", "Learn to prepare authentic Nigerian dishes — jollof rice, egusi soup, pounded yam, and pepper soup.", "At the hotel cooking studio.", 0.5, 3.0, 25000, 4.6, 78, true, '["Hands-on cooking","Recipe booklet","Tasting","Ingredients"]', '["Instructor","Ingredients","Recipe booklet","Meal"]'],
      ["Obudu Mountain Resort Weekend", "Adventure", "Two-day adventure at Nigeria's premier mountain resort with horse riding, swimming and hiking.", "Fly to Calabar then drive.", 450, 48.0, 320000, 4.8, 45, false, '["Horse riding","Hiking","Pool","Mountain views"]', '["Transport","Accommodation","Meals","Activities"]'],
    ];
    for (const [name, cat, desc, loc, dist, dur, price, rating, reviews, featured, highlights, includes] of experiences) {
      await client.query(
        `INSERT INTO local_experiences(name,category,description,location,distance_km,duration_hours,price_from,rating,review_count,is_featured,highlights,includes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [name, cat, desc, loc, dist, dur, price, rating, reviews, featured, highlights, includes]
      );
    }

    await client.query("COMMIT");
    console.log("[SEED] Demo data inserted successfully");
  } catch (e) { await client.query("ROLLBACK"); console.error("[SEED] Error:", e.message); }
  finally { client.release(); }
}

function addDays(dateStr, days) {
  const d = new Date(dateStr); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
}

function genConfirmation() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let r = "RH-";
  for (let i = 0; i < 8; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

// ═══════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════
app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password required." });
    const { rows } = await pool.query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [email]);
    const user = rows[0];
    if (!user || !user.is_active) return res.status(401).json({ message: "Invalid credentials." });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ message: "Invalid credentials." });
    await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);
    await audit(pool, user.id, "LOGIN", "USER", user.id, { email }, req);
    const token = jwt.sign({ id: user.id, role: user.role, name: user.name, department: user.department }, SECRET, { expiresIn: "12h" });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department } });
  } catch (e) { next(e); }
});

app.get("/api/auth/me", auth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id,name,email,role,department,phone,is_active FROM users WHERE id=$1", [req.user.id]);
    if (!rows[0]) return res.status(404).json({ message: "User not found." });
    res.json({ user: rows[0] });
  } catch (e) { next(e); }
});

app.post("/api/auth/change-password", auth, async (req, res, next) => {
  try {
    const { current, newPassword } = req.body;
    if (!current || !newPassword) return res.status(400).json({ message: "Current and new password required." });
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
    const valid = await bcrypt.compare(current, rows[0].password_hash);
    if (!valid) return res.status(401).json({ message: "Current password incorrect." });
    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, req.user.id]);
    res.json({ message: "Password updated." });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// USERS / TEAM
// ═══════════════════════════════════════════════════════════════════
app.get("/api/users", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT id,name,email,role,department,phone,is_active,last_login_at,created_at FROM users ORDER BY name");
    res.json(rows);
  } catch (e) { next(e); }
});

app.post("/api/users", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const { name, email, password, role, department, phone } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Name, email and password required." });
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows } = await pool.query(
      "INSERT INTO users(name,email,password_hash,role,department,phone) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,email,role,department",
      [name, email.toLowerCase(), hash, role || "STAFF", department || null, phone || null]
    );
    await audit(pool, req.user.id, "CREATE", "USER", rows[0].id, { name, email, role }, req);
    res.status(201).json(rows[0]);
  } catch (e) { e.code === "23505" ? res.status(409).json({ message: "Email already exists." }) : next(e); }
});

app.patch("/api/users/:id", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, email, role, department, isActive, password } = req.body;
    if (password) {
      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, id]);
    }
    const { rows } = await pool.query(
      `UPDATE users SET name=COALESCE($1,name),email=COALESCE($2,email),role=COALESCE($3,role),
       department=COALESCE($4,department),is_active=COALESCE($5,is_active) WHERE id=$6 RETURNING id,name,email,role,department,is_active`,
      [name, email?.toLowerCase(), role, department, isActive, id]
    );
    if (!rows[0]) return res.status(404).json({ message: "User not found." });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// ROOM TYPES
// ═══════════════════════════════════════════════════════════════════
app.get("/api/room-types", auth, async (req, res, next) => {
  try { const { rows } = await pool.query("SELECT * FROM room_types WHERE is_active=TRUE ORDER BY base_rate"); res.json(rows); }
  catch (e) { next(e); }
});

app.post("/api/room-types", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { name, description, baseRate, maxOccupancy, amenities, imageUrl } = req.body;
    if (!name || !baseRate) return res.status(400).json({ message: "Name and base rate required." });
    const { rows } = await pool.query(
      `INSERT INTO room_types(name,description,base_rate,max_occupancy,amenities,image_url) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, description || null, baseRate, maxOccupancy || 2, amenities || [], imageUrl || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// ROOMS
// ═══════════════════════════════════════════════════════════════════
app.get("/api/rooms", auth, async (req, res, next) => {
  try {
    const { status, floor, roomTypeId } = req.query;
    let sql = `SELECT r.*, rt.name AS type_name, rt.base_rate, rt.amenities FROM rooms r LEFT JOIN room_types rt ON rt.id = r.room_type_id WHERE r.is_active=TRUE`;
    const params = []; let idx = 1;
    if (status) { sql += ` AND r.status=$${idx++}`; params.push(status); }
    if (floor) { sql += ` AND r.floor=$${idx++}`; params.push(Number(floor)); }
    if (roomTypeId) { sql += ` AND r.room_type_id=$${idx++}`; params.push(Number(roomTypeId)); }
    sql += " ORDER BY r.number";
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

app.get("/api/rooms/availability", auth, async (req, res, next) => {
  try {
    const { checkIn, checkOut } = req.query;
    if (!checkIn || !checkOut) return res.status(400).json({ message: "Dates required." });
    const { rows } = await pool.query(
      `SELECT r.*, rt.name AS type_name, rt.base_rate, rt.amenities,
              CASE WHEN EXISTS (
                SELECT 1 FROM reservations res WHERE res.room_id=r.id AND res.status IN ('CONFIRMED','CHECKED_IN')
                AND res.check_in < $2 AND res.check_out > $1
              ) THEN 'OCCUPIED' ELSE r.status END AS availability
       FROM rooms r LEFT JOIN room_types rt ON rt.id=r.room_type_id WHERE r.is_active=TRUE ORDER BY r.number`, [checkIn, checkOut]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.post("/api/rooms", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { number, floor, roomTypeId, status, notes } = req.body;
    if (!number || floor == null || !roomTypeId) return res.status(400).json({ message: "Number, floor and room type required." });
    const { rows } = await pool.query("INSERT INTO rooms(number,floor,room_type_id,status,notes) VALUES($1,$2,$3,$4,$5) RETURNING *", [number, floor, roomTypeId, status || "AVAILABLE", notes || null]);
    res.status(201).json(rows[0]);
  } catch (e) { e.code === "23505" ? res.status(409).json({ message: "Room number already exists." }) : next(e); }
});

app.patch("/api/rooms/:id/status", auth, allow("ADMIN", "MANAGER", "HOUSEKEEPING", "FRONT_DESK"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status, notes } = req.body;
    const valid = ["AVAILABLE", "OCCUPIED", "DIRTY", "CLEAN", "INSPECTING", "OUT_OF_ORDER"];
    if (!valid.includes(status)) return res.status(400).json({ message: `Invalid status.` });
    const { rows } = await pool.query("UPDATE rooms SET status=$1, notes=COALESCE($2,notes) WHERE id=$3 RETURNING *", [status, notes, id]);
    if (!rows[0]) return res.status(404).json({ message: "Room not found." });
    await audit(pool, req.user.id, "UPDATE_STATUS", "ROOM", id, { status }, req);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// GUESTS / CRM
// ═══════════════════════════════════════════════════════════════════
app.get("/api/guests", auth, async (req, res, next) => {
  try {
    const { search, tier } = req.query;
    let sql = "SELECT * FROM guests WHERE 1=1";
    const params = []; let idx = 1;
    if (search) { sql += ` AND LOWER(first_name || ' ' || last_name) LIKE LOWER($${idx++})`; params.push(`%${search}%`); }
    if (tier) { sql += ` AND loyalty_tier=$${idx++}`; params.push(tier); }
    sql += " ORDER BY last_name, first_name LIMIT 200";
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

app.get("/api/guests/:id", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM guests WHERE id=$1", [Number(req.params.id)]);
    if (!rows[0]) return res.status(404).json({ message: "Guest not found." });
    const { rows: stays } = await pool.query(
      `SELECT res.*, r.number AS room_number, rt.name AS type_name FROM reservations res
       LEFT JOIN rooms r ON r.id=res.room_id LEFT JOIN room_types rt ON rt.id=res.room_type_id
       WHERE res.guest_id=$1 ORDER BY res.check_in DESC LIMIT 20`, [Number(req.params.id)]
    );
    res.json({ ...rows[0], stays });
  } catch (e) { next(e); }
});

app.post("/api/guests", auth, async (req, res, next) => {
  try {
    const { firstName, lastName, email, phone, nationality, idType, idNumber, dateOfBirth, gender, address, preferences, allergies, dietaryNotes, vipNotes, notes } = req.body;
    if (!firstName || !lastName) return res.status(400).json({ message: "First and last name required." });
    const { rows } = await pool.query(
      `INSERT INTO guests(first_name,last_name,email,phone,nationality,id_type,id_number,date_of_birth,gender,address,preferences,allergies,dietary_notes,vip_notes,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [firstName, lastName, email || null, phone || null, nationality || null, idType || null, idNumber || null, dateOfBirth || null, gender || null, address || null, JSON.stringify(preferences || {}), allergies || null, dietaryNotes || null, vipNotes || null, notes || null]
    );
    await audit(pool, req.user.id, "CREATE", "GUEST", rows[0].id, { name: `${firstName} ${lastName}` }, req);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.put("/api/guests/:id", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { firstName, lastName, email, phone, nationality, idType, idNumber, loyaltyTier, preferences, allergies, dietaryNotes, vipNotes, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE guests SET first_name=COALESCE($1,first_name),last_name=COALESCE($2,last_name),
       email=COALESCE($3,email),phone=COALESCE($4,phone),nationality=COALESCE($5,nationality),
       id_type=COALESCE($6,id_type),id_number=COALESCE($7,id_number),
       loyalty_tier=COALESCE($8,loyalty_tier),preferences=COALESCE($9,preferences),
       allergies=COALESCE($10,allergies),dietary_notes=COALESCE($11,dietary_notes),
       vip_notes=COALESCE($12,vip_notes),notes=COALESCE($13,notes) WHERE id=$14 RETURNING *`,
      [firstName, lastName, email, phone, nationality, idType, idNumber, loyaltyTier, preferences ? JSON.stringify(preferences) : null, allergies, dietaryNotes, vipNotes, notes, id]
    );
    if (!rows[0]) return res.status(404).json({ message: "Guest not found." });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// RESERVATIONS
// ═══════════════════════════════════════════════════════════════════
app.get("/api/reservations", auth, async (req, res, next) => {
  try {
    const { status, from, to } = req.query;
    let sql = `SELECT res.*, g.first_name || ' ' || g.last_name AS guest_name, g.loyalty_tier,
                      r.number AS room_number, rt.name AS type_name, u.name AS created_by_name
               FROM reservations res LEFT JOIN guests g ON g.id=res.guest_id LEFT JOIN rooms r ON r.id=res.room_id
               LEFT JOIN room_types rt ON rt.id=res.room_type_id LEFT JOIN users u ON u.id=res.created_by WHERE 1=1`;
    const params = []; let idx = 1;
    if (status) { sql += ` AND res.status=$${idx++}`; params.push(status); }
    if (from) { sql += ` AND res.check_in>=$${idx++}`; params.push(from); }
    if (to) { sql += ` AND res.check_out<=$${idx++}`; params.push(to); }
    sql += " ORDER BY res.created_at DESC LIMIT 200";
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

app.get("/api/reservations/:id", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT res.*, g.*, g.first_name || ' ' || g.last_name AS guest_name,
              r.number AS room_number, rt.name AS type_name, rt.amenities, u.name AS created_by_name
       FROM reservations res LEFT JOIN guests g ON g.id=res.guest_id LEFT JOIN rooms r ON r.id=res.room_id
       LEFT JOIN room_types rt ON rt.id=res.room_type_id LEFT JOIN users u ON u.id=res.created_by WHERE res.id=$1`, [id]
    );
    if (!rows[0]) return res.status(404).json({ message: "Not found." });
    const { rows: folioItems } = await pool.query(
      `SELECT fi.*, u.name AS posted_by_name FROM folio_items fi LEFT JOIN users u ON u.id=fi.posted_by
       WHERE fi.folio_id=(SELECT id FROM folios WHERE reservation_id=$1) ORDER BY fi.created_at`, [id]
    );
    res.json({ ...rows[0], folioItems });
  } catch (e) { next(e); }
});

app.post("/api/reservations", auth, allow("ADMIN", "MANAGER", "FRONT_DESK"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { guestId, roomId, roomTypeId, checkIn, checkOut, adults, children, rate, deposit, specialRequests, source, isVip } = req.body;
    if (!guestId || !checkIn || !checkOut) return res.status(400).json({ message: "Guest, check-in and check-out dates required." });
    await client.query("BEGIN");

    if (roomId) {
      const { rows: conflicts } = await client.query(
        `SELECT id FROM reservations WHERE room_id=$1 AND status IN ('CONFIRMED','CHECKED_IN') AND check_in < $3 AND check_out > $2`, [roomId, checkOut, checkIn]
      );
      if (conflicts.length) { await client.query("ROLLBACK"); client.release(); return res.status(409).json({ message: "Room already booked for these dates." }); }
    }

    let assignedRoomId = roomId || null;
    if (!assignedRoomId && roomTypeId) {
      const { rows: available } = await client.query(
        `SELECT r.id FROM rooms r WHERE r.room_type_id=$1 AND r.is_active=TRUE AND r.status != 'OUT_OF_ORDER'
         AND NOT EXISTS (SELECT 1 FROM reservations res WHERE res.room_id=r.id AND res.status IN ('CONFIRMED','CHECKED_IN') AND res.check_in < $3 AND res.check_out > $2)
         ORDER BY r.number LIMIT 1`, [roomTypeId, checkOut, checkIn]
      );
      if (available.length) assignedRoomId = available[0].id;
    }

    const nights = Math.max(1, Math.ceil((new Date(checkOut) - new Date(checkIn)) / 86400000));
    const roomRate = rate || (roomTypeId ? (await client.query("SELECT base_rate FROM room_types WHERE id=$1", [roomTypeId])).rows[0]?.base_rate || 0 : 0);
    const totalAmount = Number(roomRate) * nights;
    const confirmationNumber = genConfirmation();

    const { rows } = await client.query(
      `INSERT INTO reservations(confirmation_number,guest_id,room_id,room_type_id,check_in,check_out,adults,children,status,rate,total_amount,deposit_amount,special_requests,source,is_vip,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'CONFIRMED',$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [confirmationNumber, guestId, assignedRoomId, roomTypeId || null, checkIn, checkOut, adults || 1, children || 0, roomRate, totalAmount, deposit || 0, specialRequests || null, source || "DIRECT", isVip || false, req.user.id]
    );

    await client.query("INSERT INTO folios(reservation_id, guest_id) VALUES($1, $2)", [rows[0].id, guestId]);
    await client.query("UPDATE guests SET total_stays = total_stays + 1 WHERE id = $1", [guestId]);
    if (assignedRoomId) await client.query("UPDATE rooms SET status = 'OCCUPIED' WHERE id = $1", [assignedRoomId]);

    await audit(pool, req.user.id, "CREATE", "RESERVATION", rows[0].id, { confirmationNumber, guestId, checkIn, checkOut }, req);
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

app.patch("/api/reservations/:id/status", auth, allow("ADMIN", "MANAGER", "FRONT_DESK"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    const valid = ["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW"];
    if (!valid.includes(status)) return res.status(400).json({ message: `Invalid status.` });

    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM reservations WHERE id=$1 FOR UPDATE", [id]);
    if (!rows[0]) { await client.query("ROLLBACK"); client.release(); return res.status(404).json({ message: "Not found." }); }
    const resv = rows[0];

    await client.query("UPDATE reservations SET status=$1, updated_at=NOW() WHERE id=$2", [status, id]);

    if (status === "CHECKED_IN" && resv.room_id) {
      await client.query("UPDATE rooms SET status='OCCUPIED' WHERE id=$1", [resv.room_id]);
    } else if (status === "CHECKED_OUT" && resv.room_id) {
      await client.query("UPDATE rooms SET status='DIRTY' WHERE id=$1", [resv.room_id]);
      await client.query("UPDATE guests SET total_spent = total_spent + $1 WHERE id = $2", [resv.total_amount, resv.guest_id]);
    } else if (status === "CANCELLED" && resv.room_id) {
      await client.query("UPDATE rooms SET status='AVAILABLE' WHERE id=$1", [resv.room_id]);
    }

    await audit(pool, req.user.id, "UPDATE_STATUS", "RESERVATION", id, { status }, req);
    await client.query("COMMIT");
    const { rows: updated } = await pool.query("SELECT * FROM reservations WHERE id=$1", [id]);
    res.json(updated[0]);
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

// ═══════════════════════════════════════════════════════════════════
// FOLIO / CHARGES
// ═══════════════════════════════════════════════════════════════════
app.post("/api/folios/:id/charge", auth, allow("ADMIN", "MANAGER", "FRONT_DESK", "RESTAURANT"), async (req, res, next) => {
  try {
    const folioId = Number(req.params.id);
    const { description, amount, category } = req.body;
    if (!description || !amount) return res.status(400).json({ message: "Description and amount required." });
    const { rows } = await pool.query("INSERT INTO folio_items(folio_id,description,amount,category,posted_by) VALUES($1,$2,$3,$4,$5) RETURNING *", [folioId, description, Number(amount), category || "OTHER", req.user.id]);
    await pool.query("UPDATE folios SET total_charges=total_charges+$1, balance=balance+$1 WHERE id=$2", [Number(amount), folioId]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.post("/api/folios/:id/payment", auth, allow("ADMIN", "MANAGER", "FRONT_DESK"), async (req, res, next) => {
  try {
    const folioId = Number(req.params.id);
    const { amount, method } = req.body;
    if (!amount) return res.status(400).json({ message: "Amount required." });
    const { rows } = await pool.query("INSERT INTO folio_items(folio_id,description,amount,category,posted_by) VALUES($1,$2,$3,'PAYMENT',$4) RETURNING *", [folioId, `Payment (${method || "CASH"})`, -Number(amount), req.user.id]);
    await pool.query("UPDATE folios SET total_payments=total_payments+$1, balance=balance-$1 WHERE id=$2", [Number(amount), folioId]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// HOUSEKEEPING
// ═══════════════════════════════════════════════════════════════════
app.get("/api/housekeeping", auth, async (req, res, next) => {
  try {
    const { status } = req.query;
    let sql = `SELECT ht.*, r.number AS room_number, rt.name AS type_name, u.name AS assigned_name
               FROM housekeeping_tasks ht LEFT JOIN rooms r ON r.id=ht.room_id LEFT JOIN room_types rt ON rt.id=r.room_type_id
               LEFT JOIN users u ON u.id=ht.assigned_to WHERE 1=1`;
    const params = []; let idx = 1;
    if (status) { sql += ` AND ht.status=$${idx++}`; params.push(status); }
    sql += " ORDER BY CASE ht.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END, ht.created_at DESC";
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

app.post("/api/housekeeping", auth, allow("ADMIN", "MANAGER", "HOUSEKEEPING"), async (req, res, next) => {
  try {
    const { roomId, taskType, priority, assignedTo, notes } = req.body;
    if (!roomId) return res.status(400).json({ message: "Room required." });
    const { rows } = await pool.query(
      "INSERT INTO housekeeping_tasks(room_id,task_type,priority,assigned_to,notes) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [roomId, taskType || "CLEANING", priority || "NORMAL", assignedTo || null, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.patch("/api/housekeeping/:id", auth, allow("ADMIN", "MANAGER", "HOUSEKEEPING"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status, assignedTo, notes, inspectionScore } = req.body;
    const updates = []; const params = []; let idx = 1;
    if (status) { updates.push(`status=$${idx++}`); params.push(status); }
    if (status === "IN_PROGRESS") updates.push(`started_at=NOW()`);
    if (status === "COMPLETED") updates.push(`completed_at=NOW()`);
    if (assignedTo) { updates.push(`assigned_to=$${idx++}`); params.push(assignedTo); }
    if (notes) { updates.push(`notes=$${idx++}`); params.push(notes); }
    if (inspectionScore != null) { updates.push(`inspection_score=$${idx++}`); params.push(inspectionScore); }
    if (!updates.length) return res.status(400).json({ message: "Nothing to update." });
    params.push(id);
    const { rows } = await pool.query(`UPDATE housekeeping_tasks SET ${updates.join(",")} WHERE id=$${idx} RETURNING *`, params);
    if (!rows[0]) return res.status(404).json({ message: "Not found." });
    if (status === "COMPLETED" && rows[0].room_id) {
      await pool.query("UPDATE rooms SET status='CLEAN' WHERE id=$1 AND status='DIRTY'", [rows[0].room_id]);
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// MAINTENANCE
// ═══════════════════════════════════════════════════════════════════
app.get("/api/maintenance", auth, async (req, res, next) => {
  try {
    const { status } = req.query;
    let sql = `SELECT mr.*, r.number AS room_number, u.name AS assigned_name
               FROM maintenance_requests mr LEFT JOIN rooms r ON r.id=mr.room_id
               LEFT JOIN users u ON u.id=mr.assigned_to WHERE 1=1`;
    const params = []; let idx = 1;
    if (status) { sql += ` AND mr.status=$${idx++}`; params.push(status); }
    sql += " ORDER BY CASE mr.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END, mr.created_at DESC";
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

app.post("/api/maintenance", auth, async (req, res, next) => {
  try {
    const { roomId, title, description, priority, assignedTo, estimatedCost, category } = req.body;
    if (!title) return res.status(400).json({ message: "Title required." });
    const { rows } = await pool.query(
      "INSERT INTO maintenance_requests(room_id,title,description,priority,assigned_to,estimated_cost,category) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [roomId || null, title, description || null, priority || "NORMAL", assignedTo || null, estimatedCost || 0, category || "GENERAL"]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.patch("/api/maintenance/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status, assignedTo, actualCost, partsUsed } = req.body;
    const updates = []; const params = []; let idx = 1;
    if (status) { updates.push(`status=$${idx++}`); params.push(status); }
    if (status === "IN_PROGRESS") updates.push(`started_at=NOW()`);
    if (status === "COMPLETED") updates.push(`completed_at=NOW()`);
    if (assignedTo) { updates.push(`assigned_to=$${idx++}`); params.push(assignedTo); }
    if (actualCost != null) { updates.push(`actual_cost=$${idx++}`); params.push(actualCost); }
    if (partsUsed) { updates.push(`parts_used=$${idx++}`); params.push(partsUsed); }
    if (!updates.length) return res.status(400).json({ message: "Nothing to update." });
    params.push(id);
    const { rows } = await pool.query(`UPDATE maintenance_requests SET ${updates.join(",")} WHERE id=$${idx} RETURNING *`, params);
    if (!rows[0]) return res.status(404).json({ message: "Not found." });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// RESTAURANT / F&B
// ═══════════════════════════════════════════════════════════════════
app.get("/api/restaurant/menu", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM restaurant_menu ORDER BY category, name");
    res.json(rows);
  } catch (e) { next(e); }
});

app.post("/api/restaurant/menu", auth, allow("ADMIN", "MANAGER", "RESTAURANT"), async (req, res, next) => {
  try {
    const { name, category, description, price, isVegetarian, isVegan, allergens, preparationTime } = req.body;
    const { rows } = await pool.query(
      "INSERT INTO restaurant_menu(name,category,description,price,is_vegetarian,is_vegan,allergens,preparation_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [name, category, description, price, isVegetarian || false, isVegan || false, allergens || [], preparationTime || 15]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.get("/api/restaurant/orders", auth, async (req, res, next) => {
  try {
    const { status } = req.query;
    let sql = `SELECT ro.*, r.number AS room_number, u.name AS ordered_by_name,
               (SELECT json_agg(json_build_object('name',rm.name,'qty',roi.quantity,'price',roi.unit_price))
                FROM restaurant_order_items roi JOIN restaurant_menu rm ON rm.id=roi.menu_item_id WHERE roi.order_id=ro.id) AS items
               FROM restaurant_orders ro LEFT JOIN rooms r ON r.id=ro.room_id LEFT JOIN users u ON u.id=ro.ordered_by WHERE 1=1`;
    const params = []; let idx = 1;
    if (status) { sql += ` AND ro.status=$${idx++}`; params.push(status); }
    sql += " ORDER BY ro.created_at DESC LIMIT 100";
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

app.post("/api/restaurant/orders", auth, allow("ADMIN", "MANAGER", "RESTAURANT", "FRONT_DESK"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { reservationId, roomId, orderType, notes, items } = req.body;
    if (!items || !items.length) return res.status(400).json({ message: "At least one item required." });
    await client.query("BEGIN");

    // Resolve prices from menu if not provided
    let totalAmount = 0;
    const resolvedItems = [];
    for (const item of items) {
      let unitPrice = Number(item.unitPrice);
      if (!unitPrice) {
        const { rows: menuRows } = await client.query("SELECT price FROM restaurant_menu WHERE id=$1", [item.menuItemId]);
        unitPrice = Number(menuRows[0]?.price || 0);
      }
      const subtotal = unitPrice * Number(item.quantity);
      totalAmount += subtotal;
      resolvedItems.push({ ...item, unitPrice, subtotal });
    }

    const { rows: [order] } = await client.query(
      "INSERT INTO restaurant_orders(reservation_id,room_id,order_type,notes,total_amount,ordered_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [reservationId || null, roomId || null, orderType || "ROOM_SERVICE", notes || null, totalAmount, req.user.id]
    );

    for (const item of resolvedItems) {
      await client.query(
        "INSERT INTO restaurant_order_items(order_id,menu_item_id,quantity,unit_price,subtotal,special_instructions) VALUES($1,$2,$3,$4,$5,$6)",
        [order.id, item.menuItemId, item.quantity, item.unitPrice, item.subtotal, item.specialInstructions || null]
      );
    }

    await client.query("COMMIT");
    res.status(201).json(order);
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

app.patch("/api/restaurant/orders/:id", auth, allow("ADMIN", "MANAGER", "RESTAURANT"), async (req, res, next) => {
  try {
    const { status } = req.body;
    const updates = ["status=$1"];
    const params = [status];
    if (status === "COMPLETED") updates.push("completed_at=NOW()");
    params.push(Number(req.params.id));
    const { rows } = await pool.query(`UPDATE restaurant_orders SET ${updates.join(",")} WHERE id=$${params.length} RETURNING *`, params);
    if (!rows[0]) return res.status(404).json({ message: "Not found." });

    // Push real-time notification to guest if room service
    if (rows[0].order_type === "ROOM_SERVICE" && rows[0].reservation_id) {
      try {
        const { rows: resv } = await pool.query(
          `SELECT guest_id FROM reservations WHERE id=$1`, [rows[0].reservation_id]
        );
        if (resv[0]?.guest_id) {
          const statusLabels = { PREPARING: "is being prepared", IN_PROGRESS: "is in progress", COMPLETED: "is ready for delivery", DELIVERED: "has been delivered" };
          const label = statusLabels[status] || `updated to ${status}`;
          await createNotification(
            resv[0].guest_id,
            `Room Service Update`,
            `Your order #${rows[0].id} ${label}.`,
            "ROOM_SERVICE",
            "restaurant_order",
            rows[0].id
          );
        }
      } catch (nErr) { console.error("[Notify] Room service error:", nErr.message); }
    }

    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// SPA & WELLNESS
// ═══════════════════════════════════════════════════════════════════
app.get("/api/spa/services", auth, async (req, res, next) => {
  try { const { rows } = await pool.query("SELECT * FROM spa_services WHERE is_available=TRUE ORDER BY category, name"); res.json(rows); }
  catch (e) { next(e); }
});

app.get("/api/spa/appointments", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT sa.*, ss.name AS service_name, ss.category AS service_category, ss.duration_minutes, ss.price,
              g.first_name || ' ' || g.last_name AS guest_name
       FROM spa_appointments sa LEFT JOIN spa_services ss ON ss.id=sa.service_id
       LEFT JOIN guests g ON g.id=sa.guest_id ORDER BY sa.appointment_date, sa.appointment_time`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.post("/api/spa/appointments", auth, allow("ADMIN", "MANAGER", "FRONT_DESK"), async (req, res, next) => {
  try {
    const { guestId, serviceId, reservationId, appointmentDate, appointmentTime, therapistName, notes } = req.body;
    const { rows } = await pool.query(
      "INSERT INTO spa_appointments(guest_id,service_id,reservation_id,appointment_date,appointment_time,therapist_name,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [guestId, serviceId, reservationId || null, appointmentDate, appointmentTime, therapistName || null, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.patch("/api/spa/appointments/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { status, therapistName } = req.body;
    const { rows } = await pool.query(
      "UPDATE spa_appointments SET status=COALESCE($1,status),therapist_name=COALESCE($2,therapist_name) WHERE id=$3 RETURNING *",
      [status, therapistName, Number(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ message: "Not found." });

    // Push real-time notification to guest
    if (rows[0].guest_id && status) {
      try {
        const { rows: svc } = await pool.query(`SELECT name FROM spa_services WHERE id=$1`, [rows[0].service_id]);
        const serviceName = svc[0]?.name || "appointment";
        const statusLabels = { CONFIRMED: "has been confirmed", IN_PROGRESS: "is starting now", COMPLETED: "has been completed", CANCELLED: "has been cancelled" };
        const label = statusLabels[status] || `updated to ${status}`;
        await createNotification(
          rows[0].guest_id,
          `Spa Appointment Update`,
          `Your ${serviceName} appointment ${label} for ${rows[0].appointment_date} at ${rows[0].appointment_time}.`,
          "SPA",
          "spa_appointment",
          rows[0].id
        );
      } catch (nErr) { console.error("[Notify] Spa error:", nErr.message); }
    }

    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// EVENTS & BANQUETING
// ═══════════════════════════════════════════════════════════════════
app.get("/api/events", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, u.name AS created_by_name,
              (SELECT COALESCE(SUM(total_price),0) FROM event_services WHERE event_id=e.id) AS services_total
       FROM events e LEFT JOIN users u ON u.id=e.created_by ORDER BY e.start_date`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.post("/api/events", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { title, eventType, spaceName, startDate, endDate, startTime, endTime, guestCount, estimatedRevenue, contactName, contactEmail, contactPhone, notes, services } = req.body;
    const { rows: [event] } = await pool.query(
      `INSERT INTO events(title,event_type,space_name,start_date,end_date,start_time,end_time,guest_count,estimated_revenue,status,contact_name,contact_email,contact_phone,notes,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'INQUIRY',$10,$11,$12,$13,$14) RETURNING *`,
      [title, eventType, spaceName, startDate, endDate, startTime || null, endTime || null, guestCount || 0, estimatedRevenue || 0, contactName || null, contactEmail || null, contactPhone || null, notes || null, req.user.id]
    );
    if (services && services.length) {
      for (const s of services) {
        await pool.query(
          "INSERT INTO event_services(event_id,service_name,description,quantity,unit_price,total_price) VALUES($1,$2,$3,$4,$5,$6)",
          [event.id, s.serviceName, s.description || null, s.quantity || 1, s.unitPrice || 0, (s.quantity || 1) * (s.unitPrice || 0)]
        );
      }
    }
    res.status(201).json(event);
  } catch (e) { next(e); }
});

app.patch("/api/events/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { status, actualRevenue } = req.body;
    const { rows } = await pool.query(
      "UPDATE events SET status=COALESCE($1,status),actual_revenue=COALESCE($2,actual_revenue) WHERE id=$3 RETURNING *",
      [status, actualRevenue, Number(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ message: "Not found." });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// FINANCE
// ═══════════════════════════════════════════════════════════════════
app.get("/api/finance/summary", auth, async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [totalRevenue, todayRevenue, totalExpenses, outstandingBalance, recentPayments] = await Promise.all([
      pool.query("SELECT COALESCE(SUM(total_amount),0)::numeric AS total FROM reservations WHERE status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT')"),
      pool.query("SELECT COALESCE(SUM(ABS(amount)),0)::numeric AS total FROM folio_items WHERE category='PAYMENT' AND DATE(created_at)=$1", [today]),
      pool.query("SELECT COALESCE(SUM(amount),0)::numeric AS total FROM expenses WHERE status='APPROVED'"),
      pool.query("SELECT COALESCE(SUM(balance),0)::numeric AS total FROM folios WHERE status='OPEN'"),
      pool.query(`SELECT fi.*, f.reservation_id, g.first_name || ' ' || g.last_name AS guest_name
                  FROM folio_items fi JOIN folios f ON f.id=fi.folio_id JOIN guests g ON g.id=f.guest_id
                  WHERE fi.category='PAYMENT' ORDER BY fi.created_at DESC LIMIT 20`),
    ]);
    res.json({
      totalRevenue: Number(totalRevenue.rows[0].total),
      todayRevenue: Number(todayRevenue.rows[0].total),
      totalExpenses: Number(totalExpenses.rows[0].total),
      outstandingBalance: Number(outstandingBalance.rows[0].total),
      netIncome: Number(totalRevenue.rows[0].total) - Number(totalExpenses.rows[0].total),
      recentPayments: recentPayments.rows,
    });
  } catch (e) { next(e); }
});

app.get("/api/finance/expenses", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, ec.name AS category_name, u.name AS created_by_name, a.name AS approved_by_name
       FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id
       LEFT JOIN users u ON u.id=e.created_by LEFT JOIN users a ON a.id=e.approved_by ORDER BY e.created_at DESC LIMIT 100`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.post("/api/finance/expenses", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { categoryId, description, amount, vendor, receiptNumber, expenseDate } = req.body;
    const { rows } = await pool.query(
      "INSERT INTO expenses(category_id,description,amount,vendor,receipt_number,created_by,expense_date) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [categoryId, description, amount, vendor || null, receiptNumber || null, req.user.id, expenseDate || new Date().toISOString().slice(0, 10)]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.patch("/api/finance/expenses/:id", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const { status } = req.body;
    const { rows } = await pool.query(
      "UPDATE expenses SET status=$1, approved_by=$2 WHERE id=$3 RETURNING *",
      [status, req.user.id, Number(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ message: "Not found." });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.get("/api/finance/expense-categories", auth, async (req, res, next) => {
  try { const { rows } = await pool.query("SELECT * FROM expense_categories WHERE is_active=TRUE ORDER BY name"); res.json(rows); }
  catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// SECURITY
// ═══════════════════════════════════════════════════════════════════
app.get("/api/security/incidents", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT si.*, u.name AS reported_by_name FROM security_incidents si LEFT JOIN users u ON u.id=si.reported_by ORDER BY si.created_at DESC`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.post("/api/security/incidents", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { title, incidentType, severity, location, description } = req.body;
    const { rows } = await pool.query(
      "INSERT INTO security_incidents(title,incident_type,severity,location,description,reported_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [title, incidentType, severity || "LOW", location || null, description || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.patch("/api/security/incidents/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { status } = req.body;
    const updates = ["status=$1"];
    const params = [status];
    if (status === "RESOLVED") updates.push("resolved_at=NOW()");
    params.push(Number(req.params.id));
    const { rows } = await pool.query(`UPDATE security_incidents SET ${updates.join(",")} WHERE id=$${params.length} RETURNING *`, params);
    if (!rows[0]) return res.status(404).json({ message: "Not found." });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// GUEST REQUESTS / CONCIERGE
// ═══════════════════════════════════════════════════════════════════
app.get("/api/guest-requests", auth, async (req, res, next) => {
  try {
    const { status } = req.query;
    let sql = `SELECT gr.*, g.first_name || ' ' || g.last_name AS guest_name, r.number AS room_number, u.name AS assigned_name
               FROM guest_requests gr LEFT JOIN guests g ON g.id=gr.guest_id LEFT JOIN rooms r ON r.id=gr.room_id
               LEFT JOIN users u ON u.id=gr.assigned_to WHERE 1=1`;
    const params = []; let idx = 1;
    if (status) { sql += ` AND gr.status=$${idx++}`; params.push(status); }
    sql += " ORDER BY CASE gr.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END, gr.created_at DESC";
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

app.post("/api/guest-requests", auth, async (req, res, next) => {
  try {
    const { guestId, reservationId, roomId, requestType, description, priority } = req.body;
    const { rows } = await pool.query(
      "INSERT INTO guest_requests(guest_id,reservation_id,room_id,request_type,description,priority) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [guestId, reservationId || null, roomId || null, requestType, description, priority || "NORMAL"]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.patch("/api/guest-requests/:id", auth, async (req, res, next) => {
  try {
    const { status, assignedTo, responseNotes } = req.body;
    const updates = []; const params = []; let idx = 1;
    if (status) { updates.push(`status=$${idx++}`); params.push(status); }
    if (status === "COMPLETED") updates.push(`completed_at=NOW()`);
    if (assignedTo) { updates.push(`assigned_to=$${idx++}`); params.push(assignedTo); }
    if (responseNotes) { updates.push(`response_notes=$${idx++}`); params.push(responseNotes); }
    if (!updates.length) return res.status(400).json({ message: "Nothing to update." });
    params.push(Number(req.params.id));
    const { rows } = await pool.query(`UPDATE guest_requests SET ${updates.join(",")} WHERE id=$${idx} RETURNING *`, params);
    if (!rows[0]) return res.status(404).json({ message: "Not found." });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// SHIFTS / SCHEDULING
// ═══════════════════════════════════════════════════════════════════

// Get shifts with date range, department, and user filters
app.get("/api/shifts", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { from, to, department, userId } = req.query;
    let sql = `SELECT es.*, u.name AS employee_name, u.department, u.role AS employee_role
               FROM employee_shifts es LEFT JOIN users u ON u.id=es.user_id WHERE 1=1`;
    const params = []; let idx = 1;
    if (from) { sql += ` AND es.shift_date >= $${idx++}`; params.push(from); }
    if (to) { sql += ` AND es.shift_date <= $${idx++}`; params.push(to); }
    if (department) { sql += ` AND u.department = $${idx++}`; params.push(department); }
    if (userId) { sql += ` AND es.user_id = $${idx++}`; params.push(Number(userId)); }
    sql += " ORDER BY es.shift_date, es.shift_start, u.name";
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// Get shift stats for a date range
app.get("/api/shifts/stats", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    let sql = `SELECT es.shift_date, u.department, COUNT(*)::int AS shift_count,
                      SUM(CASE WHEN es.status='SCHEDULED' THEN 1 ELSE 0 END)::int AS scheduled,
                      SUM(CASE WHEN es.status='COMPLETED' THEN 1 ELSE 0 END)::int AS completed,
                      SUM(CASE WHEN es.status='ABSENT' THEN 1 ELSE 0 END)::int AS absent
               FROM employee_shifts es LEFT JOIN users u ON u.id=es.user_id WHERE 1=1`;
    const params = []; let idx = 1;
    if (from) { sql += ` AND es.shift_date >= $${idx++}`; params.push(from); }
    if (to) { sql += ` AND es.shift_date <= $${idx++}`; params.push(to); }
    sql += " GROUP BY es.shift_date, u.department ORDER BY es.shift_date";
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// Create a single shift
app.post("/api/shifts", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { userId, shiftDate, shiftStart, shiftEnd, department, notes, shiftType } = req.body;
    if (!userId || !shiftDate || !shiftStart || !shiftEnd) {
      return res.status(400).json({ message: "Employee, date, start and end time required." });
    }
    // Check for overlapping shifts
    const { rows: overlaps } = await pool.query(
      `SELECT id FROM employee_shifts WHERE user_id=$1 AND shift_date=$2
       AND shift_start < $4 AND shift_end > $3`,
      [userId, shiftDate, shiftStart, shiftEnd]
    );
    if (overlaps.length) {
      return res.status(409).json({ message: "Employee already has a shift that overlaps with this time." });
    }
    const { rows } = await pool.query(
      `INSERT INTO employee_shifts(user_id,shift_date,shift_start,shift_end,department,notes)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [userId, shiftDate, shiftStart, shiftEnd, department || null, notes || null]
    );
    // Fetch with employee details
    const { rows: full } = await pool.query(
      `SELECT es.*, u.name AS employee_name, u.department, u.role AS employee_role
       FROM employee_shifts es LEFT JOIN users u ON u.id=es.user_id WHERE es.id=$1`, [rows[0].id]
    );

    // Auto-check for critical conflicts after shift creation (fire-and-forget)
    detectAndAlertConflicts(shiftDate, shiftDate).catch(e =>
      console.error('[Conflict Auto-Check] Error:', e.message)
    );

    res.status(201).json(full[0]);
  } catch (e) { next(e); }
});

// Update a shift (drag-and-drop reassignment)
app.patch("/api/shifts/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { userId, shiftDate, shiftStart, shiftEnd, department, notes, status } = req.body;

    // If changing employee or time, check for overlaps
    if (userId || shiftDate || shiftStart || shiftEnd) {
      const { rows: existing } = await pool.query("SELECT * FROM employee_shifts WHERE id=$1", [id]);
      if (!existing[0]) return res.status(404).json({ message: "Shift not found." });
      const tgtUser = userId || existing[0].user_id;
      const tgtDate = shiftDate || existing[0].shift_date;
      const tgtStart = shiftStart || existing[0].shift_start;
      const tgtEnd = shiftEnd || existing[0].shift_end;
      const { rows: overlaps } = await pool.query(
        `SELECT id FROM employee_shifts WHERE user_id=$1 AND shift_date=$2 AND id!=$5
         AND shift_start < $4 AND shift_end > $3`,
        [tgtUser, tgtDate, tgtStart, tgtEnd, id]
      );
      if (overlaps.length) {
        return res.status(409).json({ message: "Overlapping shift exists for this employee." });
      }
    }

    const updates = []; const params = []; let idx = 1;
    if (userId) { updates.push(`user_id=$${idx++}`); params.push(userId); }
    if (shiftDate) { updates.push(`shift_date=$${idx++}`); params.push(shiftDate); }
    if (shiftStart) { updates.push(`shift_start=$${idx++}`); params.push(shiftStart); }
    if (shiftEnd) { updates.push(`shift_end=$${idx++}`); params.push(shiftEnd); }
    if (department !== undefined) { updates.push(`department=$${idx++}`); params.push(department || null); }
    if (notes !== undefined) { updates.push(`notes=$${idx++}`); params.push(notes || null); }
    if (status) { updates.push(`status=$${idx++}`); params.push(status); }
    if (!updates.length) return res.status(400).json({ message: "Nothing to update." });
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE employee_shifts SET ${updates.join(",")} WHERE id=$${idx} RETURNING *`, params
    );
    if (!rows[0]) return res.status(404).json({ message: "Shift not found." });
    const { rows: full } = await pool.query(
      `SELECT es.*, u.name AS employee_name, u.department, u.role AS employee_role
       FROM employee_shifts es LEFT JOIN users u ON u.id=es.user_id WHERE es.id=$1`, [id]
    );
    res.json(full[0]);
  } catch (e) { next(e); }
});

// Delete a shift
app.delete("/api/shifts/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM employee_shifts WHERE id=$1", [Number(req.params.id)]);
    if (!rowCount) return res.status(404).json({ message: "Shift not found." });
    res.json({ message: "Shift deleted." });
  } catch (e) { next(e); }
});

// Bulk create shifts (weekly template)
app.post("/api/shifts/bulk", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { shifts } = req.body; // [{ userId, shiftDate, shiftStart, shiftEnd, department, notes }]
    if (!shifts || !shifts.length) return res.status(400).json({ message: "Shifts array required." });
    await client.query("BEGIN");
    const created = [];
    for (const s of shifts) {
      // Skip overlaps silently
      const { rows: overlaps } = await client.query(
        `SELECT id FROM employee_shifts WHERE user_id=$1 AND shift_date=$2 AND shift_start < $4 AND shift_end > $3`,
        [s.userId, s.shiftDate, s.shiftStart, s.shiftEnd]
      );
      if (overlaps.length) continue;
      const { rows } = await client.query(
        `INSERT INTO employee_shifts(user_id,shift_date,shift_start,shift_end,department,notes)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [s.userId, s.shiftDate, s.shiftStart, s.shiftEnd, s.department || null, s.notes || null]
      );
      created.push(rows[0]);
    }
    await client.query("COMMIT");

    // Auto-check for critical conflicts after bulk creation (fire-and-forget)
    if (created.length) {
      const dates = [...new Set(created.map(s => typeof s.shift_date === 'string' ? s.shift_date.slice(0,10) : new Date(s.shift_date).toISOString().slice(0,10)))];
      if (dates.length) {
        detectAndAlertConflicts(dates[0], dates[dates.length - 1]).catch(e =>
          console.error('[Conflict Auto-Check] Bulk error:', e.message)
        );
      }
    }

    res.status(201).json({ created: created.length, skipped: shifts.length - created.length, shifts: created });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

// Get employees grouped by department (for scheduling sidebar)
app.get("/api/shifts/employees", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { department } = req.query;
    let sql = `SELECT id, name, email, role, department FROM users WHERE is_active=TRUE`;
    const params = [];
    if (department) { sql += ` AND department=$1`; params.push(department); }
    sql += ` ORDER BY department, name`;
    const { rows } = await pool.query(sql, params);
    // Group by department
    const grouped = rows.reduce((acc, u) => {
      const dept = u.department || "Unassigned";
      if (!acc[dept]) acc[dept] = [];
      acc[dept].push(u);
      return acc;
    }, {});
    res.json(grouped);
  } catch (e) { next(e); }
});

// Seed demo shifts for current week
app.post("/api/shifts/seed-demo", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const users = (await pool.query(`SELECT id, department FROM users WHERE is_active=TRUE AND role != 'ADMIN'`)).rows;
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + 1); // Monday
    const shifts = [];
    const templates = [
      { start: "06:00", end: "14:00" }, // Morning
      { start: "14:00", end: "22:00" }, // Afternoon
      { start: "22:00", end: "06:00" }, // Night
    ];
    for (const user of users) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + d);
        const dateStr = date.toISOString().slice(0, 10);
        // Assign 5 days of work, 2 days off
        const dayOfWeek = date.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Skip weekends
        const template = templates[d % 3];
        // Check no overlap
        const { rows: existing } = await pool.query(
          `SELECT id FROM employee_shifts WHERE user_id=$1 AND shift_date=$2`, [user.id, dateStr]
        );
        if (!existing.length) {
          shifts.push([user.id, dateStr, template.start, template.end, user.department, null]);
        }
      }
    }
    for (const [uid, sd, ss, se, dept, notes] of shifts) {
      await pool.query(
        `INSERT INTO employee_shifts(user_id,shift_date,shift_start,shift_end,department,notes) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uid, sd, ss, se, dept, notes]
      );
    }
    res.json({ message: `Seeded ${shifts.length} demo shifts for the current week.` });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// LABOR COST OPTIMIZATION
// ═══════════════════════════════════════════════════════════════════
app.get("/api/labor/pay-rates", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT pr.*, u.name as employee_name, u.department
       FROM employee_pay_rates pr LEFT JOIN users u ON u.id=pr.user_id
       ORDER BY u.department, u.name`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.post("/api/labor/pay-rates", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const { userId, hourlyRate, overtimeMultiplier, nightShiftPremium, weekendPremium, holidayPremium } = req.body;
    if (!userId) return res.status(400).json({ message: "userId required." });
    const { rows } = await pool.query(
      `INSERT INTO employee_pay_rates(user_id,hourly_rate,overtime_multiplier,night_shift_premium,weekend_premium,holiday_premium,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT(user_id) DO UPDATE SET hourly_rate=$2, overtime_multiplier=$3, night_shift_premium=$4, weekend_premium=$5, holiday_premium=$6, updated_at=NOW()
       RETURNING *`,
      [userId, hourlyRate || 5000, overtimeMultiplier || 1.5, nightShiftPremium || 1.25, weekendPremium || 1.5, holidayPremium || 2.0]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.post("/api/labor/pay-rates/bulk", auth, allow("ADMIN"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { rates } = req.body; // [{ userId, hourlyRate, overtimeMultiplier, nightShiftPremium, weekendPremium, holidayPremium }]
    if (!rates || !rates.length) return res.status(400).json({ message: "rates array required." });
    await client.query("BEGIN");
    let count = 0;
    for (const r of rates) {
      await client.query(
        `INSERT INTO employee_pay_rates(user_id,hourly_rate,overtime_multiplier,night_shift_premium,weekend_premium,holiday_premium,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT(user_id) DO UPDATE SET hourly_rate=$2, overtime_multiplier=$3, night_shift_premium=$4, weekend_premium=$5, holiday_premium=$6, updated_at=NOW()`,
        [r.userId, r.hourlyRate || 5000, r.overtimeMultiplier || 1.5, r.nightShiftPremium || 1.25, r.weekendPremium || 1.5, r.holidayPremium || 2.0]
      );
      count++;
    }
    await client.query("COMMIT");
    res.status(201).json({ updated: count });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

app.get("/api/labor/cost-analysis", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ message: "from and to dates required." });

    // Get all shifts in range with employee pay rates
    const { rows: shifts } = await pool.query(
      `SELECT es.*, u.name as employee_name, u.department,
              COALESCE(pr.hourly_rate, 5000) as hourly_rate,
              COALESCE(pr.overtime_multiplier, 1.5) as overtime_multiplier,
              COALESCE(pr.night_shift_premium, 1.25) as night_shift_premium,
              COALESCE(pr.weekend_premium, 1.5) as weekend_premium,
              COALESCE(pr.holiday_premium, 2.0) as holiday_premium
       FROM employee_shifts es
       LEFT JOIN users u ON u.id = es.user_id
       LEFT JOIN employee_pay_rates pr ON pr.user_id = es.user_id
       WHERE es.shift_date >= $1 AND es.shift_date <= $2
       ORDER BY es.shift_date, u.department, u.name`, [from, to]
    );

    // Calculate cost for each shift
    const shiftCosts = shifts.map(s => {
      const [sh, sm] = (s.shift_start || "0:0").split(":").map(Number);
      const [eh, em] = (s.shift_end || "0:0").split(":").map(Number);
      let hours = (eh * 60 + em) - (sh * 60 + sm);
      if (hours <= 0) hours += 1440;
      hours = hours / 60;

      const shiftDate = new Date(s.shift_date);
      const dow = shiftDate.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isNight = sh >= 20 || sh < 6;
      const isOvertime = hours > 8;

      let rate = Number(s.hourly_rate);
      let premium = 1;
      let premiumReasons = [];

      if (isNight) { premium *= Number(s.night_shift_premium); premiumReasons.push(`Night +${Math.round((Number(s.night_shift_premium) - 1) * 100)}%`); }
      if (isWeekend) { premium *= Number(s.weekend_premium); premiumReasons.push(`Weekend +${Math.round((Number(s.weekend_premium) - 1) * 100)}%`); }
      if (isOvertime) {
        const regularHours = 8;
        const overtimeHours = hours - 8;
        const regularCost = regularHours * rate * premium;
        const overtimeCost = overtimeHours * rate * premium * Number(s.overtime_multiplier);
        premiumReasons.push(`OT ${overtimeHours.toFixed(1)}h ×${s.overtime_multiplier}`);
        return {
          shiftId: s.id, employeeName: s.employee_name, department: s.department,
          date: typeof s.shift_date === 'string' ? s.shift_date.slice(0,10) : new Date(s.shift_date).toISOString().slice(0,10),
          startTime: s.shift_start, endTime: s.shift_end,
          hours, baseRate: rate, premium, premiumReasons,
          regularHours, overtimeHours, regularCost: Math.round(regularCost),
          overtimeCost: Math.round(overtimeCost),
          totalCost: Math.round(regularCost + overtimeCost),
          isWeekend, isNight, isOvertime
        };
      }

      const totalCost = Math.round(hours * rate * premium);
      return {
        shiftId: s.id, employeeName: s.employee_name, department: s.department,
        date: typeof s.shift_date === 'string' ? s.shift_date.slice(0,10) : new Date(s.shift_date).toISOString().slice(0,10),
        startTime: s.shift_start, endTime: s.shift_end,
        hours, baseRate: rate, premium, premiumReasons,
        regularHours: hours, overtimeHours: 0, regularCost: totalCost,
        overtimeCost: 0, totalCost,
        isWeekend, isNight, isOvertime: false
      };
    });

    // Summary by department
    const byDepartment = {};
    let grandTotal = 0;
    let totalRegular = 0;
    let totalOvertime = 0;
    let totalPremium = 0;
    shiftCosts.forEach(sc => {
      const dept = sc.department || "Unassigned";
      if (!byDepartment[dept]) byDepartment[dept] = { totalHours: 0, totalCost: 0, regularCost: 0, overtimeCost: 0, shiftCount: 0, employees: {} };
      byDepartment[dept].totalHours += sc.hours;
      byDepartment[dept].totalCost += sc.totalCost;
      byDepartment[dept].regularCost += sc.regularCost;
      byDepartment[dept].overtimeCost += sc.overtimeCost;
      byDepartment[dept].shiftCount++;
      if (!byDepartment[dept].employees[sc.employeeName]) byDepartment[dept].employees[sc.employeeName] = { hours: 0, cost: 0 };
      byDepartment[dept].employees[sc.employeeName].hours += sc.hours;
      byDepartment[dept].employees[sc.employeeName].cost += sc.totalCost;
      grandTotal += sc.totalCost;
      totalRegular += sc.regularCost;
      totalOvertime += sc.overtimeCost;
      totalPremium += sc.totalCost - sc.regularCost;
    });

    // Optimization suggestions
    const suggestions = [];

    // Find employees with overtime that could be redistributed
    const empTotals = {};
    shiftCosts.forEach(sc => {
      if (!empTotals[sc.employeeName]) empTotals[sc.employeeName] = { hours: 0, cost: 0, overtimeHours: 0, department: sc.department };
      empTotals[sc.employeeName].hours += sc.hours;
      empTotals[sc.employeeName].cost += sc.totalCost;
      empTotals[sc.employeeName].overtimeHours += sc.overtimeHours;
    });

    Object.entries(empTotals).forEach(([name, data]) => {
      if (data.overtimeHours > 0) {
        const empRate = shiftCosts.find(sc => sc.employeeName === name);
        const otCost = Math.round(data.overtimeHours * (empRate?.baseRate || 5000) * (empRate?.premium || 1) * ((empRate?.overtime_multiplier || 1.5) - 1));
        suggestions.push({
          type: "OVERTIME_REDUCTION",
          severity: "HIGH",
          title: `Reduce overtime for ${name}`,
          description: `${name} (${data.department}) has ${data.overtimeHours.toFixed(1)}h overtime costing extra ₦${otCost.toLocaleString()}. Consider splitting shifts to avoid overtime premiums.`,
          potentialSavings: otCost,
          employee: name,
          department: data.department,
        });
      }
    });

    // Find departments where weekend premium is high
    Object.entries(byDepartment).forEach(([dept, data]) => {
      const weekendShifts = shiftCosts.filter(sc => sc.department === dept && sc.isWeekend);
      if (weekendShifts.length > 3) {
        const weekendCost = weekendShifts.reduce((s, sc) => s + sc.totalCost, 0);
        const weekendSavings = Math.round(weekendShifts.reduce((s, sc) => s + sc.hours * sc.baseRate * (sc.weekend_premium - 1), 0));
        if (weekendSavings > 10000) {
          suggestions.push({
            type: "WEEKEND_OPTIMIZATION",
            severity: "MEDIUM",
            title: `Optimize ${dept} weekend staffing`,
            description: `${dept} has ${weekendShifts.length} weekend shifts with ₦${weekendSavings.toLocaleString()} in weekend premiums. Consider using fewer staff with longer shifts or cross-training.`,
            potentialSavings: weekendSavings,
            department: dept,
          });
        }
      }
    });

    // Find underutilized employees
    const avgHours = Object.values(empTotals).reduce((s, e) => s + e.hours, 0) / Math.max(Object.keys(empTotals).length, 1);
    Object.entries(empTotals).forEach(([name, data]) => {
      if (data.hours < avgHours * 0.5 && data.overtimeHours === 0) {
        suggestions.push({
          type: "UNDERUTILIZED",
          severity: "LOW",
          title: `${name} is underutilized`,
          description: `${name} (${data.department}) worked only ${data.hours.toFixed(1)}h vs avg ${avgHours.toFixed(1)}h. Consider increasing their hours to reduce overtime for others.`,
          employee: name,
          department: data.department,
        });
      }
    });

    // Sort suggestions by potential savings
    suggestions.sort((a, b) => (b.potentialSavings || 0) - (a.potentialSavings || 0));

    res.json({
      shifts: shiftCosts,
      summary: {
        grandTotal,
        totalRegular,
        totalOvertime,
        totalPremium,
        totalShifts: shiftCosts.length,
        totalHours: Math.round(shiftCosts.reduce((s, sc) => s + sc.hours, 0) * 10) / 10,
        avgCostPerShift: Math.round(grandTotal / Math.max(shiftCosts.length, 1)),
        avgCostPerHour: Math.round(grandTotal / Math.max(shiftCosts.reduce((s, sc) => s + sc.hours, 0), 1)),
      },
      byDepartment,
      suggestions,
    });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// CONFLICT DETECTION & UNDERSTAFFING ALERTS
// ═══════════════════════════════════════════════════════════════════
app.get("/api/shifts/conflicts", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ message: "from and to dates required." });

    const conflicts = [];

    // 1. Overlapping shifts for same employee
    const { rows: overlaps } = await pool.query(
      `SELECT a.id as shift_a_id, b.id as shift_b_id,
              a.user_id, u.name as employee_name, u.department,
              a.shift_date, a.shift_start as a_start, a.shift_end as a_end,
              b.shift_start as b_start, b.shift_end as b_end
       FROM employee_shifts a
       JOIN employee_shifts b ON a.user_id = b.user_id AND a.id < b.id
         AND a.shift_date = b.shift_date
         AND a.shift_start < b.shift_end AND a.shift_end > b.shift_start
       JOIN users u ON u.id = a.user_id
       WHERE a.shift_date >= $1 AND a.shift_date <= $2`, [from, to]
    );
    overlaps.forEach(o => {
      conflicts.push({
        type: "OVERLAP",
        severity: "CRITICAL",
        date: typeof o.shift_date === 'string' ? o.shift_date.slice(0,10) : new Date(o.shift_date).toISOString().slice(0,10),
        employee: o.employee_name,
        employeeId: o.user_id,
        department: o.department,
        message: `${o.employee_name} has overlapping shifts on ${o.shift_date?.slice(0,10)}: ${o.a_start?.slice(0,5)}–${o.a_end?.slice(5)} vs ${o.b_start?.slice(0,5)}–${o.b_end?.slice(5)}`,
        shiftIds: [o.shift_a_id, o.shift_b_id],
      });
    });

    // 2. Max weekly hours violations
    const { rows: employees } = await pool.query(`SELECT id, name, department FROM users WHERE is_active=TRUE AND role != 'ADMIN'`);
    for (const emp of employees) {
      const { rows: prefs } = await pool.query(`SELECT max_hours_weekly FROM employee_preferences WHERE user_id=$1`, [emp.id]);
      const maxHrs = prefs[0]?.max_hours_weekly || 40;

      const { rows: weekShifts } = await pool.query(
        `SELECT shift_date, shift_start, shift_end FROM employee_shifts
         WHERE user_id=$1 AND shift_date >= $2 AND shift_date <= $3`, [emp.id, from, to]
      );
      let totalHours = 0;
      weekShifts.forEach(s => {
        const [sh, sm] = (s.shift_start || "0:0").split(":").map(Number);
        const [eh, em] = (s.shift_end || "0:0").split(":").map(Number);
        let mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins <= 0) mins += 1440;
        totalHours += mins / 60;
      });
      if (totalHours > maxHrs) {
        conflicts.push({
          type: "MAX_HOURS",
          severity: "WARNING",
          date: from,
          employee: emp.name,
          employeeId: emp.id,
          department: emp.department,
          message: `${emp.name} scheduled for ${Math.round(totalHours)}h this week (max: ${maxHrs}h)`,
          hours: Math.round(totalHours),
          maxHours: maxHrs,
        });
      }
    }

    // 3. Understaffing per department per day
    const { rows: roomCount } = await pool.query(`SELECT COUNT(*) as total FROM rooms`);
    const totalRooms = Number(roomCount[0]?.total || 220);

    const DEPT_NEEDS = {
      "Front Office": (rooms) => Math.max(3, Math.round(rooms / 30)),
      "Housekeeping": (rooms) => Math.max(4, Math.round(rooms / 15)),
      "Food & Beverage": (rooms) => Math.max(3, Math.round(rooms / 25)),
      "Engineering": (rooms) => Math.max(1, Math.round(rooms / 80)),
      "Security": (rooms, isWknd) => Math.max(2, isWknd ? 4 : 3),
      "Spa": (rooms, isWknd) => Math.max(1, isWknd ? 3 : 2),
    };

    const startDate = new Date(from);
    const endDate = new Date(to);
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const dow = d.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const estOcc = isWeekend ? 0.88 : 0.75;
      const estRooms = Math.round(totalRooms * estOcc);

      // Get shift counts per department for this day
      const { rows: dayShifts } = await pool.query(
        `SELECT department, COUNT(*) as count FROM employee_shifts
         WHERE shift_date=$1 GROUP BY department`, [dateStr]
      );
      const deptCounts = {};
      dayShifts.forEach(s => { deptCounts[s.department || "Unassigned"] = Number(s.count); });

      for (const [dept, calcNeeded] of Object.entries(DEPT_NEEDS)) {
        const needed = calcNeeded(estRooms, isWeekend);
        const have = deptCounts[dept] || 0;
        if (have < needed) {
          const gap = needed - have;
          conflicts.push({
            type: "UNDERSTAFFED",
            severity: gap >= 2 ? "CRITICAL" : "WARNING",
            date: dateStr,
            department: dept,
            message: `${dept} on ${dateStr}: ${have}/${needed} staff (${gap} short)`,
            current: have,
            needed,
            gap,
          });
        }
      }

      // 4. Unassigned shifts (no department)
      const { rows: unassigned } = await pool.query(
        `SELECT COUNT(*) as count FROM employee_shifts WHERE shift_date=$1 AND (department IS NULL OR department='')`, [dateStr]
      );
      if (Number(unassigned[0]?.count) > 0) {
        conflicts.push({
          type: "UNASSIGNED",
          severity: "WARNING",
          date: dateStr,
          message: `${unassigned[0].count} shift(s) on ${dateStr} have no department assigned`,
          count: Number(unassigned[0].count),
        });
      }
    }

    // 5. No shifts scheduled at all for upcoming days
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const { rows: dayCount } = await pool.query(`SELECT COUNT(*) as count FROM employee_shifts WHERE shift_date=$1`, [dateStr]);
      if (Number(dayCount[0]?.count) === 0) {
        conflicts.push({
          type: "NO_SHIFTS",
          severity: "CRITICAL",
          date: dateStr,
          message: `No shifts scheduled for ${dateStr}!`,
        });
      }
    }

    // Sort: CRITICAL first, then by date
    conflicts.sort((a, b) => {
      if (a.severity === "CRITICAL" && b.severity !== "CRITICAL") return -1;
      if (b.severity === "CRITICAL" && a.severity !== "CRITICAL") return 1;
      return (a.date || "").localeCompare(b.date || "");
    });

    const summary = {
      total: conflicts.length,
      critical: conflicts.filter(c => c.severity === "CRITICAL").length,
      warnings: conflicts.filter(c => c.severity === "WARNING").length,
      byType: conflicts.reduce((acc, c) => { acc[c.type] = (acc[c.type] || 0) + 1; return acc; }, {}),
    };

    res.json({ conflicts, summary });
  } catch (e) { next(e); }
});

// ── Conflict Email/SMS Notification Helpers ───────────────────
async function getManagerContacts() {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone FROM users u
     WHERE u.is_active=TRUE AND u.role IN ('ADMIN','MANAGER') AND (u.email IS NOT NULL OR u.phone IS NOT NULL)`
  );
  return rows;
}

async function sendConflictAlertEmails(contacts, conflicts) {
  const criticals = conflicts.filter(c => c.severity === 'CRITICAL');
  if (!criticals.length || !contacts.length) return;

  const conflictRows = criticals.map(c =>
    `<tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:13px;">${c.type}</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:13px;">${c.date || ''}</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:13px;">${c.department || '—'}</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:13px;color:#dc2626;">${c.message}</td></tr>`
  ).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:#dc2626;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="margin:0;font-size:18px;">🚨 Critical Scheduling Alert</h1>
        <p style="margin:6px 0 0;opacity:0.9;font-size:13px;">${criticals.length} critical issue${criticals.length > 1 ? 's' : ''} detected</p>
      </div>
      <div style="background:#f9fafb;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
        <p style="color:#374151;margin:0 0 16px;">The following critical scheduling issues require immediate attention:</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          <thead><tr style="background:#fee2e2;">
            <th style="padding:8px 12px;text-align:left;border:1px solid #e5e7eb;font-size:12px;">TYPE</th>
            <th style="padding:8px 12px;text-align:left;border:1px solid #e5e7eb;font-size:12px;">DATE</th>
            <th style="padding:8px 12px;text-align:left;border:1px solid #e5e7eb;font-size:12px;">DEPARTMENT</th>
            <th style="padding:8px 12px;text-align:left;border:1px solid #e5e7eb;font-size:12px;">DETAIL</th>
          </tr></thead>
          <tbody>${conflictRows}</tbody>
        </table>
        <p style="color:#666;font-size:12px;">Please review and resolve these issues in the RHoSAM Hotel scheduling dashboard.</p>
        <div style="text-align:center;padding:16px;color:#9ca3af;font-size:11px;">RHoSAM Hotel & Scheduling System · ${new Date().toLocaleString('en-NG')}</div>
      </div>
    </div>`;

  const emailPromises = contacts
    .filter(c => c.email)
    .map(c => sendEmail(c.email, `🚨 RHoSAM Hotel: ${criticals.length} Critical Scheduling Alert`, html).catch(e =>
      console.error(`[Conflict Alert] Email to ${c.email} failed:`, e.message)
    ));
  await Promise.allSettled(emailPromises);
}

async function sendConflictAlertSMS(contacts, conflicts) {
  const criticals = conflicts.filter(c => c.severity === 'CRITICAL');
  if (!criticals.length || !contacts.length) return;

  const summary = criticals.slice(0, 3).map(c => c.message).join('; ');
  const suffix = criticals.length > 3 ? ` (+${criticals.length - 3} more)` : '';
  const smsBody = `RHoSAM HOTEL ALERT: ${criticals.length} critical scheduling issue${criticals.length > 1 ? 's' : ''}. ${summary}${suffix}`;

  const smsPromises = contacts
    .filter(c => c.phone)
    .map(c => sendSMS(c.phone, smsBody).catch(e =>
      console.error(`[Conflict Alert] SMS to ${c.phone} failed:`, e.message)
    ));
  await Promise.allSettled(smsPromises);
}

async function notifyConflictAlerts(conflicts) {
  const criticals = conflicts.filter(c => c.severity === 'CRITICAL');
  if (!criticals.length) return;
  const contacts = await getManagerContacts();
  if (!contacts.length) return;
  await Promise.allSettled([
    sendConflictAlertEmails(contacts, conflicts),
    sendConflictAlertSMS(contacts, conflicts),
  ]);
  // Also create in-app notifications for each manager
  for (const c of criticals) {
    await notifyByRole(['ADMIN', 'MANAGER'],
      `🚨 ${c.type} Alert`,
      c.message,
      'SECURITY', 'conflict_alert', null
    ).catch(() => {});
  }
  console.log(`[Conflict Alert] Sent ${criticals.length} critical alerts to ${contacts.length} managers`);
}

// Auto-detect and alert for critical conflicts (fire-and-forget)
async function detectAndAlertConflicts(from, to) {
  const conflicts = [];

  // Overlaps
  const { rows: overlaps } = await pool.query(
    `SELECT a.id, u.name as employee_name, u.department, a.shift_date, a.shift_start, a.shift_end,
            b.shift_start as b_start, b.shift_end as b_end
     FROM employee_shifts a
     JOIN employee_shifts b ON a.user_id = b.user_id AND a.id < b.id
       AND a.shift_date = b.shift_date AND a.shift_start < b.shift_end AND a.shift_end > b.shift_start
     JOIN users u ON u.id = a.user_id
     WHERE a.shift_date >= $1 AND a.shift_date <= $2`, [from, to]
  );
  overlaps.forEach(o => conflicts.push({
    type: 'OVERLAP', severity: 'CRITICAL',
    date: typeof o.shift_date === 'string' ? o.shift_date.slice(0,10) : new Date(o.shift_date).toISOString().slice(0,10),
    employee: o.employee_name, department: o.department,
    message: `${o.employee_name} has overlapping shifts on ${o.shift_date?.slice(0,10)}: ${o.shift_start?.slice(0,5)}–${o.shift_end?.slice(5)} vs ${o.b_start?.slice(0,5)}–${o.b_end?.slice(5)}`,
  }));

  // Understaffing
  const { rows: roomCount } = await pool.query(`SELECT COUNT(*) as total FROM rooms`);
  const totalRooms = Number(roomCount[0]?.total || 220);
  const DEPT_NEEDS = {
    'Front Office': (r) => Math.max(3, Math.round(r / 30)),
    'Housekeeping': (r) => Math.max(4, Math.round(r / 15)),
    'Food & Beverage': (r) => Math.max(3, Math.round(r / 25)),
    'Engineering': (r) => Math.max(1, Math.round(r / 80)),
    'Security': (r, w) => Math.max(2, w ? 4 : 3),
    'Spa': (r, w) => Math.max(1, w ? 3 : 2),
  };
  const startDate = new Date(from);
  const endDate = new Date(to);
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const dow = d.getDay(); const isWeekend = dow === 0 || dow === 6;
    const estRooms = Math.round(totalRooms * (isWeekend ? 0.88 : 0.75));
    const { rows: dayShifts } = await pool.query(
      `SELECT department, COUNT(*) as count FROM employee_shifts WHERE shift_date=$1 GROUP BY department`, [dateStr]
    );
    const deptCounts = {};
    dayShifts.forEach(s => { deptCounts[s.department || 'Unassigned'] = Number(s.count); });
    for (const [dept, calcNeeded] of Object.entries(DEPT_NEEDS)) {
      const needed = calcNeeded(estRooms, isWeekend);
      const have = deptCounts[dept] || 0;
      if (have < needed) {
        const gap = needed - have;
        if (gap >= 2) {
          conflicts.push({ type: 'UNDERSTAFFED', severity: 'CRITICAL', date: dateStr, department: dept,
            message: `${dept} on ${dateStr}: ${have}/${needed} staff (${gap} short)`, current: have, needed, gap });
        }
      }
    }
  }

  // Only alert if there are CRITICAL conflicts
  const criticals = conflicts.filter(c => c.severity === 'CRITICAL');
  if (criticals.length) {
    console.log(`[Conflict Auto-Check] Found ${criticals.length} critical conflicts, sending alerts...`);
    await notifyConflictAlerts(conflicts);
  }
}

// Send conflict alerts on demand
app.post("/api/shifts/conflicts/notify", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ message: "from and to dates required." });

    // Re-run conflict detection
    const { rows: roomCount } = await pool.query(`SELECT COUNT(*) as total FROM rooms`);
    const totalRooms = Number(roomCount[0]?.total || 220);
    const DEPT_NEEDS = {
      'Front Office': (rooms) => Math.max(3, Math.round(rooms / 30)),
      'Housekeeping': (rooms) => Math.max(4, Math.round(rooms / 15)),
      'Food & Beverage': (rooms) => Math.max(3, Math.round(rooms / 25)),
      'Engineering': (rooms) => Math.max(1, Math.round(rooms / 80)),
      'Security': (rooms, isWknd) => Math.max(2, isWknd ? 4 : 3),
      'Spa': (rooms, isWknd) => Math.max(1, isWknd ? 3 : 2),
    };
    const conflicts = [];

    // Overlaps
    const { rows: overlaps } = await pool.query(
      `SELECT a.id as shift_a_id, b.id as shift_b_id, a.user_id, u.name as employee_name, u.department,
              a.shift_date, a.shift_start as a_start, a.shift_end as a_end, b.shift_start as b_start, b.shift_end as b_end
       FROM employee_shifts a JOIN employee_shifts b ON a.user_id = b.user_id AND a.id < b.id
         AND a.shift_date = b.shift_date AND a.shift_start < b.shift_end AND a.shift_end > b.shift_start
       JOIN users u ON u.id = a.user_id
       WHERE a.shift_date >= $1 AND a.shift_date <= $2`, [from, to]
    );
    overlaps.forEach(o => conflicts.push({
      type: 'OVERLAP', severity: 'CRITICAL',
      date: typeof o.shift_date === 'string' ? o.shift_date.slice(0,10) : new Date(o.shift_date).toISOString().slice(0,10),
      employee: o.employee_name, department: o.department,
      message: `${o.employee_name} has overlapping shifts on ${o.shift_date?.slice(0,10)}: ${o.a_start?.slice(0,5)}–${o.a_end?.slice(5)} vs ${o.b_start?.slice(0,5)}–${o.b_end?.slice(5)}`,
    }));

    // Understaffing
    const startDate = new Date(from);
    const endDate = new Date(to);
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const dow = d.getDay(); const isWeekend = dow === 0 || dow === 6;
      const estRooms = Math.round(totalRooms * (isWeekend ? 0.88 : 0.75));
      const { rows: dayShifts } = await pool.query(
        `SELECT department, COUNT(*) as count FROM employee_shifts WHERE shift_date=$1 GROUP BY department`, [dateStr]
      );
      const deptCounts = {};
      dayShifts.forEach(s => { deptCounts[s.department || 'Unassigned'] = Number(s.count); });
      for (const [dept, calcNeeded] of Object.entries(DEPT_NEEDS)) {
        const needed = calcNeeded(estRooms, isWeekend);
        const have = deptCounts[dept] || 0;
        if (have < needed) {
          const gap = needed - have;
          conflicts.push({
            type: 'UNDERSTAFFED', severity: gap >= 2 ? 'CRITICAL' : 'WARNING',
            date: dateStr, department: dept,
            message: `${dept} on ${dateStr}: ${have}/${needed} staff (${gap} short)`,
            current: have, needed, gap,
          });
        }
      }
    }

    const criticals = conflicts.filter(c => c.severity === 'CRITICAL');
    if (!criticals.length) {
      return res.json({ message: 'No critical conflicts found.', sent: 0 });
    }

    await notifyConflictAlerts(conflicts);
    res.json({ message: `Alerts sent for ${criticals.length} critical issues.`, sent: criticals.length, conflicts: criticals });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// SHIFT SWAP & TRADE REQUESTS
// ═══════════════════════════════════════════════════════════════════
app.get("/api/shift-swaps", auth, async (req, res, next) => {
  try {
    const { status, userId } = req.query;
    const userRole = req.user.role;
    const userIdNum = req.user.id;
    let sql = `
      SELECT ss.*,
        requester.name as requester_name, requester.department as requester_department,
        rs.shift_date as requester_date, rs.shift_start as requester_start, rs.shift_end as requester_end,
        target.name as target_name, target.department as target_department,
        ts.shift_date as target_date, ts.shift_start as target_start, ts.shift_end as target_end,
        reviewer.name as reviewer_name
      FROM shift_swaps ss
      LEFT JOIN users requester ON requester.id = ss.requester_id
      LEFT JOIN employee_shifts rs ON rs.id = ss.requester_shift_id
      LEFT JOIN users target ON target.id = ss.target_id
      LEFT JOIN employee_shifts ts ON ts.id = ss.target_shift_id
      LEFT JOIN users reviewer ON reviewer.id = ss.reviewer_id
      WHERE 1=1`;
    const params = [];
    let idx = 1;
    if (status) { sql += ` AND ss.status=$${idx++}`; params.push(status); }
    // Non-managers can only see their own swaps
    if (userRole === 'ADMIN' || userRole === 'MANAGER') {
      if (userId) { sql += ` AND (ss.requester_id=$${idx} OR ss.target_id=$${idx})`; params.push(userId); idx++; }
    } else {
      sql += ` AND (ss.requester_id=$${idx} OR ss.target_id=$${idx})`;
      params.push(userIdNum); idx++;
    }
    sql += ` ORDER BY ss.created_at DESC`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

app.get("/api/shift-swaps/:id", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ss.*,
        requester.name as requester_name, requester.department as requester_department,
        rs.shift_date as requester_date, rs.shift_start as requester_start, rs.shift_end as requester_end,
        target.name as target_name, target.department as target_department,
        ts.shift_date as target_date, ts.shift_start as target_start, ts.shift_end as target_end,
        reviewer.name as reviewer_name
      FROM shift_swaps ss
      LEFT JOIN users requester ON requester.id = ss.requester_id
      LEFT JOIN employee_shifts rs ON rs.id = ss.requester_shift_id
      LEFT JOIN users target ON target.id = ss.target_id
      LEFT JOIN employee_shifts ts ON ts.id = ss.target_shift_id
      LEFT JOIN users reviewer ON reviewer.id = ss.reviewer_id
      WHERE ss.id=$1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: "Swap request not found." });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.post("/api/shift-swaps", auth, async (req, res, next) => {
  try {
    const { requesterShiftId, targetUserId, targetShiftId, swapType, reason } = req.body;
    if (!requesterShiftId) return res.status(400).json({ message: "requesterShiftId required." });
    // Verify the shift belongs to the requester
    const { rows: shift } = await pool.query(
      `SELECT * FROM employee_shifts WHERE id=$1`, [requesterShiftId]
    );
    if (!shift.length) return res.status(404).json({ message: "Shift not found." });
    if (shift[0].user_id !== req.user.id && (req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER')) {
      return res.status(403).json({ message: "You can only request swaps for your own shifts." });
    }
    // Check for existing pending swap on this shift
    const { rows: existing } = await pool.query(
      `SELECT id FROM shift_swaps WHERE requester_shift_id=$1 AND status='PENDING'`, [requesterShiftId]
    );
    if (existing.length) return res.status(400).json({ message: "A pending swap request already exists for this shift." });

    const { rows } = await pool.query(
      `INSERT INTO shift_swaps(requester_id, requester_shift_id, target_id, target_shift_id, swap_type, reason)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, requesterShiftId, targetUserId || null, targetShiftId || null, swapType || 'TRADE', reason || null]
    );

    // Notify managers about new swap request
    try {
      const swapTypeLabel = (swapType || 'TRADE') === 'TRADE' ? 'shift trade' : 'shift take-over';
      const shiftDate = shift[0]?.date || '';
      await notifyByRole(
        ['ADMIN', 'MANAGER'],
        'New Shift Swap Request',
        `A ${swapTypeLabel} request has been submitted for ${shiftDate}. Reason: ${reason || 'Not specified'}.`,
        'SHIFT', 'shift_swap', rows[0].id
      );
      // Also notify the target employee if specified
      if (targetUserId) {
        await createNotification(
          targetUserId,
          'Shift Swap Request',
          `You have been requested for a ${swapTypeLabel} for ${shiftDate}. Reason: ${reason || 'Not specified'}.`,
          'SHIFT', 'shift_swap', rows[0].id
        );
      }
    } catch (nErr) { console.error('[Notify] Swap create error:', nErr.message); }

    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.post("/api/shift-swaps/:id/approve", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { reviewerNotes } = req.body;
    const { rows: swap } = await client.query(`SELECT * FROM shift_swaps WHERE id=$1`, [req.params.id]);
    if (!swap.length) return res.status(404).json({ message: "Swap request not found." });
    if (swap[0].status !== 'PENDING') return res.status(400).json({ message: "Request already processed." });

    await client.query("BEGIN");

    // Update swap status
    await client.query(
      `UPDATE shift_swaps SET status='APPROVED', reviewer_id=$1, reviewer_notes=$2, reviewed_at=NOW() WHERE id=$3`,
      [req.user.id, reviewerNotes || null, req.params.id]
    );

    // Execute the swap if both shifts exist
    const s = swap[0];
    if (s.target_shift_id) {
      // TRADE: swap user_ids on both shifts
      const { rows: reqShift } = await client.query(`SELECT user_id FROM employee_shifts WHERE id=$1`, [s.requester_shift_id]);
      const { rows: tgtShift } = await client.query(`SELECT user_id FROM employee_shifts WHERE id=$1`, [s.target_shift_id]);
      if (reqShift.length && tgtShift.length) {
        await client.query(`UPDATE employee_shifts SET user_id=$1 WHERE id=$2`, [tgtShift[0].user_id, s.requester_shift_id]);
        await client.query(`UPDATE employee_shifts SET user_id=$1 WHERE id=$2`, [reqShift[0].user_id, s.target_shift_id]);
      }
    } else if (s.target_id) {
      // TAKE OVER: transfer requester's shift to target user
      await client.query(`UPDATE employee_shifts SET user_id=$1 WHERE id=$2`, [s.target_id, s.requester_shift_id]);
    }

    await client.query("COMMIT");
    const { rows: updated } = await client.query(`SELECT * FROM shift_swaps WHERE id=$1`, [req.params.id]);

    // Notify requester that swap was approved
    try {
      const swapTypeLabel = swap[0].swap_type === 'TRADE' ? 'trade' : 'take-over';
      await createNotification(
        swap[0].requester_id,
        'Shift Swap Approved',
        `Your ${swapTypeLabel} request has been approved${reviewerNotes ? ': ' + reviewerNotes : ''}.`,
        'SHIFT', 'shift_swap', swap[0].id
      );
      // If it's a trade, also notify the target
      if (swap[0].target_id && swap[0].target_id !== swap[0].requester_id) {
        await createNotification(
          swap[0].target_id,
          'Shift Swap Approved',
          `A ${swapTypeLabel} request involving you has been approved${reviewerNotes ? ': ' + reviewerNotes : ''}.`,
          'SHIFT', 'shift_swap', swap[0].id
        );
      }
    } catch (nErr) { console.error('[Notify] Swap approve error:', nErr.message); }

    res.json(updated[0]);
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

app.post("/api/shift-swaps/:id/reject", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { reviewerNotes } = req.body;
    const { rows: swap } = await pool.query(`SELECT * FROM shift_swaps WHERE id=$1`, [req.params.id]);
    if (!swap.length) return res.status(404).json({ message: "Swap request not found." });
    if (swap[0].status !== 'PENDING') return res.status(400).json({ message: "Request already processed." });
    const { rows } = await pool.query(
      `UPDATE shift_swaps SET status='REJECTED', reviewer_id=$1, reviewer_notes=$2, reviewed_at=NOW() WHERE id=$3 RETURNING *`,
      [req.user.id, reviewerNotes || null, req.params.id]
    );

    // Notify requester that swap was rejected
    try {
      const swapTypeLabel = swap[0].swap_type === 'TRADE' ? 'trade' : 'take-over';
      await createNotification(
        swap[0].requester_id,
        'Shift Swap Rejected',
        `Your ${swapTypeLabel} request has been rejected${reviewerNotes ? ': ' + reviewerNotes : ''}.`,
        'SHIFT', 'shift_swap', swap[0].id
      );
    } catch (nErr) { console.error('[Notify] Swap reject error:', nErr.message); }

    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.delete("/api/shift-swaps/:id", auth, async (req, res, next) => {
  try {
    const { rows: swap } = await pool.query(`SELECT * FROM shift_swaps WHERE id=$1`, [req.params.id]);
    if (!swap.length) return res.status(404).json({ message: "Swap request not found." });
    // Only requester or admin can cancel
    if (swap[0].requester_id !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: "Not authorized." });
    }
    if (swap[0].status !== 'PENDING') return res.status(400).json({ message: "Only pending requests can be cancelled." });
    await pool.query(`DELETE FROM shift_swaps WHERE id=$1`, [req.params.id]);

    // Notify managers that swap was cancelled
    try {
      const swapTypeLabel = swap[0].swap_type === 'TRADE' ? 'trade' : 'take-over';
      const shiftDate = '';
      await notifyByRole(
        ['ADMIN', 'MANAGER'],
        'Shift Swap Cancelled',
        `A ${swapTypeLabel} request has been cancelled by the requester.`,
        'SHIFT', 'shift_swap', null
      );
      if (swap[0].target_id && swap[0].target_id !== swap[0].requester_id) {
        await createNotification(
          swap[0].target_id,
          'Shift Swap Cancelled',
          `A ${swapTypeLabel} request involving you has been cancelled.`,
          'SHIFT', 'shift_swap', null
        );
      }
    } catch (nErr) { console.error('[Notify] Swap cancel error:', nErr.message); }

    res.json({ message: "Swap request cancelled." });
  } catch (e) { next(e); }
});

app.get("/api/shift-swaps/potential-targets/:shiftId", auth, async (req, res, next) => {
  try {
    const { rows: shift } = await pool.query(`SELECT * FROM employee_shifts WHERE id=$1`, [req.params.shiftId]);
    if (!shift.length) return res.status(404).json({ message: "Shift not found." });
    const s = shift[0];
    // Find employees in the same department who have a shift that could be swapped
    const { rows: targets } = await pool.query(
      `SELECT es.id as shift_id, es.shift_date, es.shift_start, es.shift_end, es.department,
              u.id as user_id, u.name as employee_name, u.department as emp_department
       FROM employee_shifts es
       JOIN users u ON u.id = es.user_id
       WHERE es.shift_date = $1 AND es.id != $2 AND u.is_active = TRUE
       ORDER BY u.name`, [s.shift_date, req.params.shiftId]
    );
    res.json(targets);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// EMPLOYEE PREFERENCES
// ═══════════════════════════════════════════════════════════════════
app.get("/api/employee-preferences", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ep.*, u.name as employee_name, u.department FROM employee_preferences ep
       LEFT JOIN users u ON u.id=ep.user_id ORDER BY u.department, u.name`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.get("/api/employee-preferences/:userId", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ep.*, u.name as employee_name FROM employee_preferences ep
       LEFT JOIN users u ON u.id=ep.user_id WHERE ep.user_id=$1`, [req.params.userId]
    );
    res.json(rows[0] || { user_id: Number(req.params.userId), preferred_shift: "Morning", preferred_days: "[1,2,3,4,5]", max_hours_weekly: 40 });
  } catch (e) { next(e); }
});

app.post("/api/employee-preferences", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { userId, preferredShift, preferredDays, maxHoursWeekly, preferredDepartment, notes } = req.body;
    if (!userId) return res.status(400).json({ message: "userId required." });
    const { rows } = await pool.query(
      `INSERT INTO employee_preferences(user_id,preferred_shift,preferred_days,max_hours_weekly,preferred_department,notes,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT(user_id) DO UPDATE SET preferred_shift=$2, preferred_days=$3, max_hours_weekly=$4, preferred_department=$5, notes=$6, updated_at=NOW()
       RETURNING *`,
      [userId, preferredShift || "Morning", JSON.stringify(preferredDays || [1,2,3,4,5]), maxHoursWeekly || 40, preferredDepartment || null, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.post("/api/employee-preferences/bulk", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { preferences } = req.body; // [{ userId, preferredShift, preferredDays, maxHoursWeekly, preferredDepartment, notes }]
    if (!preferences || !preferences.length) return res.status(400).json({ message: "preferences array required." });
    await client.query("BEGIN");
    let count = 0;
    for (const p of preferences) {
      await client.query(
        `INSERT INTO employee_preferences(user_id,preferred_shift,preferred_days,max_hours_weekly,preferred_department,notes,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT(user_id) DO UPDATE SET preferred_shift=$2, preferred_days=$3, max_hours_weekly=$4, preferred_department=$5, notes=$6, updated_at=NOW()`,
        [p.userId, p.preferredShift || "Morning", JSON.stringify(p.preferredDays || [1,2,3,4,5]), p.maxHoursWeekly || 40, p.preferredDepartment || null, p.notes || null]
      );
      count++;
    }
    await client.query("COMMIT");
    res.status(201).json({ updated: count });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

// ═══════════════════════════════════════════════════════════════════
// DEMAND FORECAST & AI AUTO-SCHEDULING
// ═══════════════════════════════════════════════════════════════════
app.get("/api/shifts/demand-forecast", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ message: "from and to dates required." });

    // Get occupancy forecast (reservations in date range)
    const { rows: reservations } = await pool.query(
      `SELECT check_in_date, check_out_date, COUNT(*) as count FROM reservations
       WHERE status IN ('CONFIRMED','CHECKED_IN')
       AND check_in_date <= $2 AND check_out_date >= $1
       GROUP BY check_in_date, check_out_date`, [from, to]
    );

    // Get historical demand pattern from past shifts
    const { rows: historicalShifts } = await pool.query(
      `SELECT shift_date, COUNT(*) as shift_count, department FROM employee_shifts
       WHERE shift_date >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY shift_date, department ORDER BY shift_date`
    );

    // Get existing shifts in range
    const { rows: existingShifts } = await pool.query(
      `SELECT shift_date, COUNT(*) as count FROM employee_shifts
       WHERE shift_date >= $1 AND shift_date <= $2
       GROUP BY shift_date ORDER BY shift_date`, [from, to]
    );

    // Calculate total rooms
    const { rows: roomCount } = await pool.query(`SELECT COUNT(*) as total FROM rooms`);
    const totalRooms = Number(roomCount[0]?.total || 220);

    // Build daily forecast
    const startDate = new Date(from);
    const endDate = new Date(to);
    const forecast = [];
    const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const dow = d.getDay();
      const isWeekend = dow === 0 || dow === 6;

      // Estimate occupancy (weekends higher)
      const baseOccupancy = isWeekend ? 0.88 : 0.75;
      const estimatedOccupancy = Math.min(1, baseOccupancy + (Math.random() * 0.1 - 0.05));
      const estimatedRooms = Math.round(totalRooms * estimatedOccupancy);

      // Department staffing needs based on occupancy
      const needs = {
        "Front Office": Math.max(3, Math.round(estimatedRooms / 30)),
        "Housekeeping": Math.max(4, Math.round(estimatedRooms / 15)),
        "Food & Beverage": Math.max(3, Math.round(estimatedRooms / 25)),
        "Engineering": Math.max(1, Math.round(estimatedRooms / 80)),
        "Security": Math.max(2, isWeekend ? 4 : 3),
        "Spa": Math.max(1, isWeekend ? 3 : 2),
      };

      const totalNeeded = Object.values(needs).reduce((a, b) => a + b, 0);
      const existingCount = existingShifts.find(s => s.shift_date?.slice(0, 10) === dateStr);
      const currentCount = existingCount ? Number(existingCount.count) : 0;

      forecast.push({
        date: dateStr,
        dayName: dayNames[dow],
        isWeekend,
        estimatedOccupancy: Math.round(estimatedOccupancy * 100),
        estimatedRooms,
        departmentNeeds: needs,
        totalStaffNeeded: totalNeeded,
        currentStaffScheduled: currentCount,
        gap: totalNeeded - currentCount,
        status: currentCount >= totalNeeded ? "fully_staffed" : currentCount >= totalNeeded * 0.8 ? "adequate" : "understaffed",
      });
    }

    // Historical average
    const histByDow = {};
    historicalShifts.forEach(h => {
      const d = new Date(h.shift_date);
      const dow = d.getDay();
      if (!histByDow[dow]) histByDow[dow] = { total: 0, count: 0, departments: {} };
      histByDow[dow].total += Number(h.shift_count);
      histByDow[dow].count++;
      histByDow[dow].departments[h.department] = (histByDow[dow].departments[h.department] || 0) + Number(h.shift_count);
    });

    res.json({ forecast, historicalPattern: histByDow, totalRooms });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// AI AUTO-SCHEDULE
// ═══════════════════════════════════════════════════════════════════
app.post("/api/shifts/auto-schedule", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { from, to, clearExisting, constraints } = req.body;
    if (!from || !to) return res.status(400).json({ message: "from and to dates required." });

    // Get all active employees with preferences
    const { rows: employees } = await client.query(
      `SELECT u.id, u.name, u.department, u.role,
              ep.preferred_shift, ep.preferred_days, ep.max_hours_weekly, ep.notes as pref_notes
       FROM users u
       LEFT JOIN employee_preferences ep ON ep.user_id = u.id
       WHERE u.is_active=TRUE AND u.role != 'ADMIN' ORDER BY u.department, u.name`
    );

    // Get existing shifts in range
    const { rows: existingShifts } = await client.query(
      `SELECT * FROM employee_shifts WHERE shift_date >= $1 AND shift_date <= $2`, [from, to]
    );

    // Get total rooms for demand calc
    const { rows: roomCount } = await client.query(`SELECT COUNT(*) as total FROM rooms`);
    const totalRooms = Number(roomCount[0]?.total || 220);

    // Clear existing if requested
    if (clearExisting) {
      await client.query(`DELETE FROM employee_shifts WHERE shift_date >= $1 AND shift_date <= $2`, [from, to]);
    }

    // Shift templates
    const SHIFT_MAP = {
      "Morning": { start: "06:00", end: "14:00" },
      "Afternoon": { start: "14:00", end: "22:00" },
      "Night": { start: "22:00", end: "06:00" },
      "Full Day": { start: "08:00", end: "18:00" },
      "Split": { start: "08:00", end: "12:00" },
    };

    // Group employees by department
    const empByDept = {};
    employees.forEach(e => {
      const dept = e.department || "Unassigned";
      if (!empByDept[dept]) empByDept[dept] = [];
      empByDept[dept].push(e);
    });

    const startDate = new Date(from);
    const endDate = new Date(to);
    const proposed = [];
    const warnings = [];
    let totalCreated = 0;
    let totalSkipped = 0;

    // Walk each day
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const dow = d.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const estimatedOccupancy = isWeekend ? 0.88 : 0.75;
      const estimatedRooms = Math.round(totalRooms * estimatedOccupancy);

      // Department staffing needs
      const deptNeeds = {
        "Front Office": Math.max(3, Math.round(estimatedRooms / 30)),
        "Housekeeping": Math.max(4, Math.round(estimatedRooms / 15)),
        "Food & Beverage": Math.max(3, Math.round(estimatedRooms / 25)),
        "Engineering": Math.max(1, Math.round(estimatedRooms / 80)),
        "Security": Math.max(2, isWeekend ? 4 : 3),
        "Spa": Math.max(1, isWeekend ? 3 : 2),
      };

      for (const [dept, needed] of Object.entries(deptNeeds)) {
        const candidates = empByDept[dept] || [];
        if (!candidates.length) { warnings.push(`No employees in ${dept} for ${dateStr}`); continue; }

        // Sort by preference match, then random for fairness
        const sorted = [...candidates].sort((a, b) => {
          const aPref = SHIFT_MAP[a.preferred_shift] ? 1 : 0;
          const bPref = SHIFT_MAP[b.preferred_shift] ? 1 : 0;
          return bPref - aPref;
        });

        let assigned = 0;
        for (const emp of sorted) {
          if (assigned >= needed) break;

          // Check if employee prefers this day off
          let preferredDays = [1, 2, 3, 4, 5];
          try { preferredDays = JSON.parse(emp.preferred_days); } catch {}
          if (!preferredDays.includes(dow) && !isWeekend) {
            // Give preference but still assign if under-pressure
            if (assigned < needed - 1) continue;
          }

          // Determine shift based on preference
          let shiftName = emp.preferred_shift || (dow % 3 === 0 ? "Morning" : dow % 3 === 1 ? "Afternoon" : "Night");
          if (!SHIFT_MAP[shiftName]) shiftName = "Morning";
          const shift = SHIFT_MAP[shiftName];

          // Check max hours weekly
          const { rows: weekShifts } = await client.query(
            `SELECT shift_start, shift_end FROM employee_shifts
             WHERE user_id=$1 AND shift_date >= date($2) - INTERVAL '7 days' AND shift_date <= $2`,
            [emp.id, dateStr]
          );
          let weekHours = 0;
          weekShifts.forEach(s => {
            const [sh, sm] = (s.shift_start || "0:0").split(":").map(Number);
            const [eh, em] = (s.shift_end || "0:0").split(":").map(Number);
            let mins = (eh * 60 + em) - (sh * 60 + sm);
            if (mins <= 0) mins += 1440;
            weekHours += mins / 60;
          });
          const maxHrs = emp.max_hours_weekly || 40;
          if (weekHours + 8 > maxHrs) {
            warnings.push(`${emp.name} approaching max hours (${Math.round(weekHours)}h/${maxHrs}h) on ${dateStr}`);
            continue;
          }

          // Check overlap
          const { rows: overlaps } = await client.query(
            `SELECT id FROM employee_shifts WHERE user_id=$1 AND shift_date=$2 AND shift_start < $4 AND shift_end > $3`,
            [emp.id, dateStr, shift.start, shift.end]
          );
          if (overlaps.length) { totalSkipped++; continue; }

          // Create shift
          const { rows } = await client.query(
            `INSERT INTO employee_shifts(user_id,shift_date,shift_start,shift_end,department,notes)
             VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
            [emp.id, dateStr, shift.start, shift.end, dept, `AI auto-scheduled`]
          );
          proposed.push({ ...rows[0], employee_name: emp.name });
          assigned++;
          totalCreated++;
        }

        if (assigned < needed) {
          warnings.push(`${dept} on ${dateStr}: need ${needed}, only assigned ${assigned}`);
        }
      }
    }

    await client.query("COMMIT");

    // Group proposed shifts by date for summary
    const byDate = {};
    proposed.forEach(s => {
      const key = s.shift_date?.slice(0, 10);
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(s);
    });

    res.json({
      created: totalCreated,
      skipped: totalSkipped,
      warnings,
      summary: Object.entries(byDate).map(([date, shifts]) => ({
        date,
        count: shifts.length,
        departments: [...new Set(shifts.map(s => s.department))],
      })),
      shifts: proposed,
    });

    // Auto-check for critical conflicts after AI scheduling (fire-and-forget)
    if (from && to) {
      detectAndAlertConflicts(from, to).catch(e =>
        console.error('[Conflict Auto-Check] AI schedule error:', e.message)
      );
    }
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════
app.get("/api/notifications", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [req.user.id]
    );
    const unread = rows.filter(n => !n.is_read).length;
    res.json({ notifications: rows, unread });
  } catch (e) { next(e); }
});

app.patch("/api/notifications/read", auth, async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (ids && ids.length) {
      await pool.query("UPDATE notifications SET is_read=TRUE WHERE id=ANY($1) AND user_id=$2", [ids, req.user.id]);
    } else {
      await pool.query("UPDATE notifications SET is_read=TRUE WHERE user_id=$1", [req.user.id]);
    }
    res.json({ message: "Updated." });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATION PREFERENCES
// ═══════════════════════════════════════════════════════════════════
app.get("/api/notification-preferences", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM notification_preferences WHERE user_id=$1`, [req.user.id]);
    res.json(rows[0] || {
      user_id: req.user.id, room_service_updates: true, spa_reminders: true,
      housekeeping_updates: true, maintenance_updates: true, guest_requests: true,
      shift_updates: true, security_alerts: true, general: true, sound_enabled: true, email_enabled: false
    });
  } catch (e) { next(e); }
});

app.patch("/api/notification-preferences", auth, async (req, res, next) => {
  try {
    const { roomServiceUpdates, spaReminders, housekeepingUpdates, maintenanceUpdates, guestRequests, shiftUpdates, securityAlerts, general, soundEnabled, emailEnabled } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO notification_preferences(user_id,room_service_updates,spa_reminders,housekeeping_updates,maintenance_updates,guest_requests,shift_updates,security_alerts,general,sound_enabled,email_enabled,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
       ON CONFLICT(user_id) DO UPDATE SET room_service_updates=$2, spa_reminders=$3, housekeeping_updates=$4, maintenance_updates=$5, guest_requests=$6, shift_updates=$7, security_alerts=$8, general=$9, sound_enabled=$10, email_enabled=$11, updated_at=NOW()
       RETURNING *`,
      [req.user.id, roomServiceUpdates ?? true, spaReminders ?? true, housekeepingUpdates ?? true, maintenanceUpdates ?? true, guestRequests ?? true, shiftUpdates ?? true, securityAlerts ?? true, general ?? true, soundEnabled ?? true, emailEnabled ?? false]
    );
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ── Guest Auth Middleware ────────────────────────────────────────
const guestAuth = (req, res, next) => {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!t) return res.status(401).json({ message: "Authentication required." });
  try {
    const decoded = jwt.verify(t, SECRET);
    if (decoded.type !== "guest") return res.status(401).json({ message: "Invalid guest token." });
    req.guest = decoded; next();
  } catch { return res.status(401).json({ message: "Session expired." }); }
};

// Guest notifications
app.get("/api/guest/notifications", guestAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`, [req.guest.guestId]
    );
    const unread = rows.filter(n => !n.is_read).length;
    res.json({ notifications: rows, unread });
  } catch (e) { next(e); }
});

app.patch("/api/guest/notifications/read", guestAuth, async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (ids && ids.length) {
      await pool.query("UPDATE notifications SET is_read=TRUE WHERE id=ANY($1) AND user_id=$2", [ids, req.guest.guestId]);
    } else {
      await pool.query("UPDATE notifications SET is_read=TRUE WHERE user_id=$1", [req.guest.guestId]);
    }
    res.json({ message: "Updated." });
  } catch (e) { next(e); }
});

// Guest notification preferences
app.get("/api/guest/notification-preferences", guestAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM guest_notification_preferences WHERE guest_id=$1`, [req.guest.guestId]);
    res.json(rows[0] || {
      guest_id: req.guest.guestId, email_enabled: true, sms_enabled: true,
      room_service_updates: true, spa_updates: true, checkin_checkout: true, promotions: false
    });
  } catch (e) { next(e); }
});

app.patch("/api/guest/notification-preferences", guestAuth, async (req, res, next) => {
  try {
    const { emailEnabled, smsEnabled, roomServiceUpdates, spaUpdates, checkinCheckout, promotions } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO guest_notification_preferences(guest_id, email_enabled, sms_enabled, room_service_updates, spa_updates, checkin_checkout, promotions, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT(guest_id) DO UPDATE SET email_enabled=$2, sms_enabled=$3, room_service_updates=$4, spa_updates=$5, checkin_checkout=$6, promotions=$7, updated_at=NOW()
       RETURNING *`,
      [req.guest.guestId, emailEnabled ?? true, smsEnabled ?? true, roomServiceUpdates ?? true, spaUpdates ?? true, checkinCheckout ?? true, promotions ?? false]
    );
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Guest notification delivery log (for admin)
app.get("/api/guest/notification-log", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { guestId, type, limit } = req.query;
    let sql = `SELECT gnl.*, g.first_name, g.last_name, g.email, g.phone FROM guest_notification_log gnl LEFT JOIN guests g ON g.id=gnl.guest_id`;
    const params = [];
    const conditions = [];
    if (guestId) { params.push(guestId); conditions.push(`gnl.guest_id=$${params.length}`); }
    if (type) { params.push(type); conditions.push(`gnl.notification_type=$${params.length}`); }
    if (conditions.length) sql += ` WHERE ${conditions.join(" AND ")}`;
    sql += ` ORDER BY gnl.created_at DESC LIMIT ${Number(limit) || 100}`;
    const { rows } = await pool.query(sql, params);
    res.json({ logs: rows, total: rows.length });
  } catch (e) { next(e); }
});

// Admin: Send manual notification to guest via email/SMS
app.post("/api/guest/send-notification", auth, allow("ADMIN", "MANAGER", "FRONT_DESK"), async (req, res, next) => {
  try {
    const { guestId, title, body, sendEmail: doEmail, sendSms: doSms } = req.body;
    if (!guestId || !title || !body) return res.status(400).json({ message: "guestId, title, and body required." });
    const results = await deliverGuestNotification(guestId, title, body, "MANUAL");
    // Override preferences if admin explicitly chose channels
    if (doEmail === false || doSms === false) {
      const { rows: guests } = await pool.query(`SELECT * FROM guests WHERE id=$1`, [guestId]);
      const guest = guests[0];
      if (guest) {
        if (doEmail === false && guest.email) {
          await sendEmail(guest.email, `RHoSAM Hotel: ${title}`, `<h2>${title}</h2><p>${body}</p>`);
        }
        if (doSms === false && guest.phone) {
          await sendSMS(guest.phone, `${title}: ${body}`);
        }
      }
    }
    res.json({ message: "Notification sent.", results });
  } catch (e) { next(e); }
});

// Admin: Send test notification
app.post("/api/guest/test-notification", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const { email, phone, title, body } = req.body;
    const results = { email: null, sms: null };
    if (email) results.email = await sendEmail(email, title || "Test Notification", `<h2>${title || "Test"}</h2><p>${body || "This is a test notification from RHoSAM Hotel."}</p>`);
    if (phone) results.sms = await sendSMS(phone, `${title || "Test"}: ${body || "This is a test notification from RHoSAM Hotel."}`);
    res.json({ message: "Test sent.", results });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// SHIFT SWAP ANALYTICS
// ═══════════════════════════════════════════════════════════════════
app.get("/api/shift-swaps/analytics", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { days } = req.query;
    const dayCount = Math.min(Number(days) || 90, 365);
    const since = new Date(Date.now() - dayCount * 86400000).toISOString();

    const { rows: swaps } = await pool.query(
      `SELECT ss.*, u.name AS requester_name, t.name AS target_name, r.name AS reviewer_name
       FROM shift_swaps ss
       LEFT JOIN users u ON u.id = ss.requester_id
       LEFT JOIN users t ON t.id = ss.target_id
       LEFT JOIN users r ON r.id = ss.reviewer_id
       WHERE ss.created_at >= $1
       ORDER BY ss.created_at`, [since]
    );

    const total = swaps.length;
    const pending = swaps.filter(s => s.status === 'PENDING');
    const approved = swaps.filter(s => s.status === 'APPROVED');
    const rejected = swaps.filter(s => s.status === 'REJECTED');
    const cancelled = swaps.filter(s => s.status === 'CANCELLED');

    // Approval rate
    const resolvedCount = approved.length + rejected.length;
    const approvalRate = resolvedCount ? Math.round((approved.length / resolvedCount) * 100) : 0;

    // Average resolution time (for resolved swaps)
    const resolutionTimes = swaps
      .filter(s => s.reviewed_at && s.created_at)
      .map(s => new Date(s.reviewed_at) - new Date(s.created_at));
    const avgResolutionMs = resolutionTimes.length ? resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length : 0;
    const avgResolutionHours = Math.round(avgResolutionMs / 3600000 * 10) / 10;

    // Swap types breakdown
    const trades = swaps.filter(s => s.swap_type === 'TRADE');
    const takeovers = swaps.filter(s => s.swap_type === 'TAKE_OVER');

    // Top requesters
    const requesterMap = {};
    swaps.forEach(s => {
      const name = s.requester_name || 'Unknown';
      if (!requesterMap[name]) requesterMap[name] = { name, total: 0, approved: 0, rejected: 0 };
      requesterMap[name].total++;
      if (s.status === 'APPROVED') requesterMap[name].approved++;
      if (s.status === 'REJECTED') requesterMap[name].rejected++;
    });
    const topRequesters = Object.values(requesterMap).sort((a, b) => b.total - a.total).slice(0, 10);

    // Top reviewers
    const reviewerMap = {};
    swaps.filter(s => s.reviewer_name).forEach(s => {
      const name = s.reviewer_name;
      if (!reviewerMap[name]) reviewerMap[name] = { name, total: 0, approved: 0, rejected: 0 };
      reviewerMap[name].total++;
      if (s.status === 'APPROVED') reviewerMap[name].approved++;
      if (s.status === 'REJECTED') reviewerMap[name].rejected++;
    });
    const topReviewers = Object.values(reviewerMap).sort((a, b) => b.total - a.total);

    // Daily time series
    const dailyMap = {};
    swaps.forEach(s => {
      const day = String(s.created_at).slice(0, 10);
      if (!dailyMap[day]) dailyMap[day] = { date: day, total: 0, approved: 0, rejected: 0 };
      dailyMap[day].total++;
      if (s.status === 'APPROVED') dailyMap[day].approved++;
      if (s.status === 'REJECTED') dailyMap[day].rejected++;
    });
    const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    // Day-of-week patterns
    const dowMap = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
    const dowCounts = {};
    Object.keys(dowMap).forEach(k => dowCounts[dowMap[k]] = 0);
    swaps.forEach(s => {
      const dow = new Date(s.created_at).getDay();
      dowCounts[dowMap[dow]]++;
    });
    const dayOfWeekPattern = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => ({ day: d, count: dowCounts[d] || 0 }));

    // Hour-of-day patterns
    const hourCounts = Array(24).fill(0);
    swaps.forEach(s => {
      const h = new Date(s.created_at).getHours();
      hourCounts[h]++;
    });
    const hourPattern = hourCounts.map((count, hour) => ({ hour, count }));

    // Common reasons
    const reasonMap = {};
    swaps.filter(s => s.reason).forEach(s => {
      const r = s.reason.trim().substring(0, 80);
      reasonMap[r] = (reasonMap[r] || 0) + 1;
    });
    const topReasons = Object.entries(reasonMap).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([reason, count]) => ({ reason, count }));

    // Recent activity feed
    const recentSwaps = swaps.slice(-10).reverse().map(s => ({
      id: s.id,
      requester: s.requester_name,
      target: s.target_name,
      type: s.swap_type,
      status: s.status,
      date: s.created_at,
    }));

    res.json({
      ok: true,
      period: { days: dayCount, since },
      summary: {
        total, pending: pending.length, approved: approved.length,
        rejected: rejected.length, cancelled: cancelled.length,
        approvalRate, avgResolutionHours,
        trades: trades.length, takeovers: takeovers.length,
      },
      topRequesters, topReviewers,
      daily, dayOfWeekPattern, hourPattern, topReasons, recentSwaps,
    });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATION ANALYTICS
// ═══════════════════════════════════════════════════════════════════
app.get("/api/notification-analytics", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { days } = req.query;
    const dayCount = Math.min(Number(days) || 30, 365);
    const since = new Date(Date.now() - dayCount * 86400000).toISOString();

    // Staff notifications
    const { rows: staffNotifs } = await pool.query(
      `SELECT type, is_read, created_at FROM notifications WHERE created_at >= $1 ORDER BY created_at`, [since]
    );

    // Guest delivery log
    const { rows: guestLogs } = await pool.query(
      `SELECT notification_type, email_sent, email_status, sms_sent, sms_status, created_at FROM guest_notification_log WHERE created_at >= $1 ORDER BY created_at`, [since]
    );

    // === Staff Analytics ===
    const staffTotal = staffNotifs.length;
    const staffRead = staffNotifs.filter(n => n.is_read).length;
    const staffUnread = staffTotal - staffRead;
    const staffReadRate = staffTotal ? Math.round((staffRead / staffTotal) * 100) : 0;

    // Staff by type
    const staffByType = {};
    staffNotifs.forEach(n => {
      const t = n.type || 'GENERAL';
      if (!staffByType[t]) staffByType[t] = { total: 0, read: 0, unread: 0 };
      staffByType[t].total++;
      if (n.is_read) staffByType[t].read++;
      else staffByType[t].unread++;
    });

    // Staff daily time series
    const staffDaily = {};
    staffNotifs.forEach(n => {
      const day = String(n.created_at).slice(0, 10);
      if (!staffDaily[day]) staffDaily[day] = { date: day, total: 0, read: 0 };
      staffDaily[day].total++;
      if (n.is_read) staffDaily[day].read++;
    });

    // === Guest Delivery Analytics ===
    const guestTotal = guestLogs.length;
    const emailSent = guestLogs.filter(g => g.email_sent).length;
    const smsSent = guestLogs.filter(g => g.sms_sent).length;
    const emailFailed = guestLogs.filter(g => g.email_sent && g.email_status !== 'sent').length;
    const smsFailed = guestLogs.filter(g => g.sms_sent && g.sms_status !== 'sent').length;
    const emailSuccess = emailSent - emailFailed;
    const smsSuccess = smsSent - smsFailed;
    const emailSuccessRate = emailSent ? Math.round((emailSuccess / emailSent) * 100) : 0;
    const smsSuccessRate = smsSent ? Math.round((smsSuccess / smsSent) * 100) : 0;

    // Guest by type
    const guestByType = {};
    guestLogs.forEach(g => {
      const t = g.notification_type || 'GENERAL';
      if (!guestByType[t]) guestByType[t] = { total: 0, emailSent: 0, smsSent: 0 };
      guestByType[t].total++;
      if (g.email_sent) guestByType[t].emailSent++;
      if (g.sms_sent) guestByType[t].smsSent++;
    });

    // Guest daily time series
    const guestDaily = {};
    guestLogs.forEach(g => {
      const day = String(g.created_at).slice(0, 10);
      if (!guestDaily[day]) guestDaily[day] = { date: day, total: 0, email: 0, sms: 0 };
      guestDaily[day].total++;
      if (g.email_sent) guestDaily[day].email++;
      if (g.sms_sent) guestDaily[day].sms++;
    });

    // === Channel breakdown ===
    const channels = {
      websocket: { name: 'WebSocket (In-App)', total: staffTotal, icon: '🔔' },
      email: { name: 'Email', total: emailSent, success: emailSuccess, failed: emailFailed, icon: '📧' },
      sms: { name: 'SMS', total: smsSent, success: smsSuccess, failed: smsFailed, icon: '📱' },
    };

    // Total all notifications across channels
    const totalDelivered = staffTotal + emailSent + smsSent;
    const totalFailed = emailFailed + smsFailed;
    const overallSuccessRate = totalDelivered ? Math.round(((totalDelivered - totalFailed) / totalDelivered) * 100) : 0;

    res.json({
      ok: true,
      period: { days: dayCount, since },
      summary: {
        totalNotifications: totalDelivered,
        staffNotifications: staffTotal,
        guestDeliveryAttempts: guestTotal,
        emailSent, emailSuccess, emailFailed, emailSuccessRate,
        smsSent, smsSuccess, smsFailed, smsSuccessRate,
        staffReadRate, overallSuccessRate,
      },
      staff: {
        total: staffTotal, read: staffRead, unread: staffUnread, readRate: staffReadRate,
        byType: staffByType,
        daily: Object.values(staffDaily).sort((a, b) => a.date.localeCompare(b.date)),
      },
      guest: {
        total: guestTotal, emailSent, smsSent,
        byType: guestByType,
        daily: Object.values(guestDaily).sort((a, b) => a.date.localeCompare(b.date)),
      },
      channels,
    });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════
app.get("/api/audit-logs", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT al.*, u.name AS user_name FROM audit_logs al LEFT JOIN users u ON u.id=al.user_id ORDER BY al.created_at DESC LIMIT 200`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════
app.get("/api/dashboard", auth, async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [totalRooms, occupied, arrivals, departures, revenueToday, pendingTasks, openMaintenance, recentReservations, guestSatisfaction, roomStatuses, pendingGuestRequests, activeEvents] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM rooms WHERE is_active=TRUE"),
      pool.query("SELECT COUNT(*)::int AS count FROM rooms WHERE status='OCCUPIED' AND is_active=TRUE"),
      pool.query("SELECT COUNT(*)::int AS count FROM reservations WHERE check_in=$1 AND status IN ('CONFIRMED','PENDING')", [today]),
      pool.query("SELECT COUNT(*)::int AS count FROM reservations WHERE check_out=$1 AND status='CHECKED_IN'", [today]),
      pool.query("SELECT COALESCE(SUM(ABS(amount)),0)::numeric AS total FROM folio_items WHERE category='PAYMENT' AND DATE(created_at)=$1", [today]),
      pool.query("SELECT COUNT(*)::int AS count FROM housekeeping_tasks WHERE status IN ('PENDING','IN_PROGRESS')"),
      pool.query("SELECT COUNT(*)::int AS count FROM maintenance_requests WHERE status IN ('OPEN','IN_PROGRESS')"),
      pool.query(`SELECT res.*, g.first_name || ' ' || g.last_name AS guest_name, r.number AS room_number, rt.name AS type_name
                  FROM reservations res LEFT JOIN guests g ON g.id=res.guest_id LEFT JOIN rooms r ON r.id=res.room_id
                  LEFT JOIN room_types rt ON rt.id=res.room_type_id ORDER BY res.created_at DESC LIMIT 10`),
      pool.query("SELECT 4.87 AS score"),
      pool.query("SELECT status, COUNT(*)::int AS count FROM rooms WHERE is_active=TRUE GROUP BY status"),
      pool.query("SELECT COUNT(*)::int AS count FROM guest_requests WHERE status IN ('PENDING','IN_PROGRESS')"),
      pool.query("SELECT COUNT(*)::int AS count FROM events WHERE status IN ('CONFIRMED','IN_PROGRESS') AND start_date <= $1 AND end_date >= $1", [today]),
    ]);

    // Revenue chart - last 7 days
    const revenueChart = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const { rows } = await pool.query("SELECT COALESCE(SUM(ABS(amount)),0)::numeric AS total FROM folio_items WHERE category='PAYMENT' AND DATE(created_at)=$1", [dateStr]);
      revenueChart.push({ date: d.toLocaleDateString("en-US", { weekday: "short" }), revenue: Number(rows[0].total) / 1000 });
    }

    const totalRoomCount = totalRooms.rows[0].count;
    const occupiedCount = occupied.rows[0].count;
    const occupancyRate = totalRoomCount ? Math.round((occupiedCount / totalRoomCount) * 100) : 0;

    res.json({
      occupancy: { total: totalRoomCount, occupied: occupiedCount, rate: occupancyRate },
      arrivals: arrivals.rows[0].count,
      departures: departures.rows[0].count,
      revenue: { today: Number(revenueToday.rows[0].total) },
      pendingTasks: pendingTasks.rows[0].count,
      openMaintenance: openMaintenance.rows[0].count,
      satisfaction: Number(guestSatisfaction.rows[0].score),
      recentReservations: recentReservations.rows,
      revenueChart,
      roomStatuses: roomStatuses.rows.reduce((acc, r) => { acc[r.status] = r.count; return acc; }, {}),
      pendingGuestRequests: pendingGuestRequests.rows[0].count,
      activeEvents: activeEvents.rows[0].count,
    });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// GLOBAL SEARCH
// ═══════════════════════════════════════════════════════════════════
app.get("/api/search", auth, async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ rooms: [], guests: [], reservations: [] });
    const term = `%${q}%`;
    const [rooms, guests, reservations] = await Promise.all([
      pool.query("SELECT r.*, rt.name AS type_name FROM rooms r LEFT JOIN room_types rt ON rt.id=r.room_type_id WHERE r.number ILIKE $1 OR rt.name ILIKE $1 LIMIT 10", [term]),
      pool.query("SELECT * FROM guests WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 LIMIT 10", [term]),
      pool.query(`SELECT res.*, g.first_name || ' ' || g.last_name AS guest_name, r.number AS room_number FROM reservations res
                  LEFT JOIN guests g ON g.id=res.guest_id LEFT JOIN rooms r ON r.id=res.room_id
                  WHERE res.confirmation_number ILIKE $1 OR g.first_name ILIKE $1 OR g.last_name ILIKE $1 OR r.number ILIKE $1 LIMIT 10`, [term]),
    ]);
    res.json({ rooms: rooms.rows, guests: guests.rows, reservations: reservations.rows });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// GUEST-FACING API (Mobile App)
// ═══════════════════════════════════════════════════════════════════
// Guest login with confirmation number + last name
app.post("/api/guest/login", async (req, res, next) => {
  try {
    const { confirmationNumber, lastName } = req.body;
    if (!confirmationNumber || !lastName) return res.status(400).json({ message: "Confirmation number and last name required." });
    const { rows } = await pool.query(
      `SELECT res.*, g.id AS guest_id, g.first_name, g.last_name, g.email, g.phone, g.nationality,
              g.loyalty_tier, g.loyalty_points, g.preferences, g.allergies, g.dietary_notes,
              r.number AS room_number, rt.name AS type_name, rt.amenities
       FROM reservations res
       LEFT JOIN guests g ON g.id=res.guest_id
       LEFT JOIN rooms r ON r.id=res.room_id
       LEFT JOIN room_types rt ON rt.id=res.room_type_id
       WHERE UPPER(res.confirmation_number) = UPPER($1) AND LOWER(g.last_name) = LOWER($2)`,
      [confirmationNumber, lastName]
    );
    if (!rows[0]) return res.status(401).json({ message: "Reservation not found. Please check your confirmation number and last name." });
    const resv = rows[0];
    const token = jwt.sign({ type: "guest", guestId: resv.guest_id, reservationId: resv.id, name: `${resv.first_name} ${resv.last_name}` }, SECRET, { expiresIn: "24h" });
    await audit(pool, null, "GUEST_LOGIN", "RESERVATION", resv.id, { confirmationNumber: resv.confirmation_number }, req);
    res.json({
      token,
      guest: { id: resv.guest_id, firstName: resv.first_name, lastName: resv.last_name, email: resv.email, phone: resv.phone, nationality: resv.nationality, loyaltyTier: resv.loyalty_tier, loyaltyPoints: resv.loyalty_points, allergies: resv.allergies, dietaryNotes: resv.dietary_notes, preferences: resv.preferences },
      reservation: { id: resv.id, confirmationNumber: resv.confirmation_number, roomNumber: resv.room_number, roomType: resv.type_name, amenities: resv.amenities, checkIn: resv.check_in, checkOut: resv.check_out, adults: resv.adults, children: resv.children, status: resv.status, rate: resv.rate, totalAmount: resv.total_amount, specialRequests: resv.special_requests, isVip: resv.is_vip }
    });
  } catch (e) { next(e); }
});

// Guest: get my stay info
app.get("/api/guest/stay", guestAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT res.*, g.first_name, g.last_name, g.loyalty_tier, g.loyalty_points,
              r.number AS room_number, rt.name AS type_name, rt.amenities,
              (SELECT balance FROM folios WHERE reservation_id=res.id) AS folio_balance
       FROM reservations res
       LEFT JOIN guests g ON g.id=res.guest_id
       LEFT JOIN rooms r ON r.id=res.room_id
       LEFT JOIN room_types rt ON rt.id=res.room_type_id
       WHERE res.id=$1`, [req.guest.reservationId]
    );
    if (!rows[0]) return res.status(404).json({ message: "Not found." });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Guest: digital check-in
app.post("/api/guest/check-in", guestAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const resvId = req.guest.reservationId;
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM reservations WHERE id=$1 FOR UPDATE", [resvId]);
    if (!rows[0]) { await client.query("ROLLBACK"); client.release(); return res.status(404).json({ message: "Not found." }); }
    if (rows[0].status !== "CONFIRMED") { await client.query("ROLLBACK"); client.release(); return res.status(400).json({ message: `Cannot check in. Current status: ${rows[0].status}` }); }
    await client.query("UPDATE reservations SET status='CHECKED_IN', updated_at=NOW() WHERE id=$1", [resvId]);
    if (rows[0].room_id) await client.query("UPDATE rooms SET status='OCCUPIED' WHERE id=$1", [rows[0].room_id]);
    await audit(pool, null, "GUEST_CHECK_IN", "RESERVATION", resvId, {}, req);
    await client.query("COMMIT");

    // Send check-in confirmation via email/SMS
    const guestId = rows[0].guest_id;
    const roomNum = rows[0].room_id ? (await pool.query("SELECT number FROM rooms WHERE id=$1", [rows[0].room_id])).rows[0]?.number : null;
    deliverGuestNotification(guestId,
      "Welcome to RHoSAM Hotel & Suites",
      `Your check-in is complete! ${roomNum ? 'Room ' + roomNum + '. ' : ''}We hope you enjoy your stay. For any assistance, use the in-room tablet or contact the front desk.`,
      "CHECK_IN"
    ).catch(e => console.error("[Check-in notification]", e.message));

    res.json({ message: "Checked in successfully!", roomNumber: roomNum });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

// Guest: digital check-out
app.post("/api/guest/check-out", guestAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const resvId = req.guest.reservationId;
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM reservations WHERE id=$1 FOR UPDATE", [resvId]);
    if (!rows[0]) { await client.query("ROLLBACK"); client.release(); return res.status(404).json({ message: "Not found." }); }
    if (rows[0].status !== "CHECKED_IN") { await client.query("ROLLBACK"); client.release(); return res.status(400).json({ message: `Cannot check out. Current status: ${rows[0].status}` }); }
    await client.query("UPDATE reservations SET status='CHECKED_OUT', updated_at=NOW() WHERE id=$1", [resvId]);
    if (rows[0].room_id) await client.query("UPDATE rooms SET status='DIRTY' WHERE id=$1", [rows[0].room_id]);
    await client.query("UPDATE guests SET total_spent = total_spent + $1 WHERE id = $2", [rows[0].total_amount, rows[0].guest_id]);
    await audit(pool, null, "GUEST_CHECK_OUT", "RESERVATION", resvId, {}, req);
    await client.query("COMMIT");

    // Send check-out confirmation via email/SMS
    const checkoutGuestId = rows[0].guest_id;
    deliverGuestNotification(checkoutGuestId,
      "Thank You for Staying with Us",
      `Your check-out is complete. We hope you had a wonderful stay at RHoSAM Hotel & Suites. We'd love to welcome you back soon!`,
      "CHECK_OUT"
    ).catch(e => console.error("[Check-out notification]", e.message));

    res.json({ message: "Checked out successfully! Thank you for staying with us." });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

// Guest: get menu
app.get("/api/guest/menu", guestAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT id, name, category, description, price, is_vegetarian, is_vegan, allergens, preparation_time FROM restaurant_menu WHERE is_available=TRUE ORDER BY category, name");
    res.json(rows);
  } catch (e) { next(e); }
});

// Guest: order room service
app.post("/api/guest/room-service", guestAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { items, notes } = req.body;
    if (!items || !items.length) return res.status(400).json({ message: "At least one item required." });
    const { rows: resv } = await client.query("SELECT room_id FROM reservations WHERE id=$1", [req.guest.reservationId]);
    await client.query("BEGIN");
    // Resolve prices from menu if not provided
    let totalAmount = 0;
    const resolvedItems = [];
    for (const item of items) {
      let unitPrice = Number(item.unitPrice);
      if (!unitPrice) {
        const { rows: menuRows } = await client.query("SELECT price FROM restaurant_menu WHERE id=$1", [item.menuItemId]);
        unitPrice = Number(menuRows[0]?.price || 0);
      }
      const subtotal = unitPrice * Number(item.quantity);
      totalAmount += subtotal;
      resolvedItems.push({ ...item, unitPrice, subtotal });
    }
    const { rows: [order] } = await client.query(
      "INSERT INTO restaurant_orders(reservation_id,room_id,order_type,notes,total_amount,ordered_by) VALUES($1,$2,'ROOM_SERVICE',$3,$4,NULL) RETURNING *",
      [req.guest.reservationId, resv[0]?.room_id || null, notes || null, totalAmount]
    );
    for (const item of resolvedItems) {
      await client.query(
        "INSERT INTO restaurant_order_items(order_id,menu_item_id,quantity,unit_price,subtotal,special_instructions) VALUES($1,$2,$3,$4,$5,$6)",
        [order.id, item.menuItemId, item.quantity, item.unitPrice, item.subtotal, item.specialInstructions || null]
      );
    }
    await client.query("COMMIT");

    // Notify restaurant staff
    try {
      const itemNames = items.map(i => i.name || `#${i.menuItemId}`).join(", ");
      await notifyByRole(["ADMIN", "MANAGER", "RESTAURANT"],
        "New Room Service Order",
        `Order #${order.id} from Room ${resv[0]?.room_id || "?"}: ${itemNames} (₦${Number(totalAmount).toLocaleString()})`,
        "ROOM_SERVICE", "restaurant_order", order.id
      );
    } catch (nErr) { console.error("[Notify] Room service staff error:", nErr.message); }

    res.status(201).json({ message: "Room service order placed!", orderId: order.id, totalAmount });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

// Guest: get my room service orders
app.get("/api/guest/room-service", guestAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ro.*, (SELECT json_agg(json_build_object('name',rm.name,'qty',roi.quantity,'price',roi.unit_price,'instructions',roi.special_instructions))
       FROM restaurant_order_items roi JOIN restaurant_menu rm ON rm.id=roi.menu_item_id WHERE roi.order_id=ro.id) AS items
       FROM restaurant_orders ro WHERE ro.reservation_id=$1 ORDER BY ro.created_at DESC`, [req.guest.reservationId]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// Guest: get spa services
app.get("/api/guest/spa/services", guestAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM spa_services WHERE is_available=TRUE ORDER BY category, name");
    res.json(rows);
  } catch (e) { next(e); }
});

// Guest: book spa appointment
app.post("/api/guest/spa/book", guestAuth, async (req, res, next) => {
  try {
    const { serviceId, appointmentDate, appointmentTime, therapistName, notes } = req.body;
    if (!serviceId || !appointmentDate || !appointmentTime) return res.status(400).json({ message: "Service, date and time required." });
    const { rows } = await pool.query(
      "INSERT INTO spa_appointments(guest_id,service_id,reservation_id,appointment_date,appointment_time,therapist_name,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [req.guest.guestId, serviceId, req.guest.reservationId, appointmentDate, appointmentTime, therapistName || null, notes || null]
    );
    // Notify spa staff
    try {
      const { rows: svc } = await pool.query(`SELECT name FROM spa_services WHERE id=$1`, [serviceId]);
      const guestName = req.guest?.firstName ? `${req.guest.firstName} ${req.guest.lastName}` : "Guest";
      await notifyByRole(["ADMIN", "MANAGER"],
        "New Spa Booking",
        `${guestName} booked ${svc[0]?.name || "service"} for ${appointmentDate} at ${appointmentTime}`,
        "SPA", "spa_appointment", rows[0].id
      );
    } catch (nErr) { console.error("[Notify] Spa staff error:", nErr.message); }

    res.status(201).json({ message: "Spa appointment booked!", appointment: rows[0] });
  } catch (e) { next(e); }
});

// Guest: my spa appointments
app.get("/api/guest/spa/my-appointments", guestAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT sa.*, ss.name AS service_name, ss.category AS service_category, ss.duration_minutes, ss.price
       FROM spa_appointments sa LEFT JOIN spa_services ss ON ss.id=sa.service_id
       WHERE sa.guest_id=$1 ORDER BY sa.appointment_date, sa.appointment_time`, [req.guest.guestId]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// Guest: submit concierge request
app.post("/api/guest/concierge", guestAuth, async (req, res, next) => {
  try {
    const { requestType, description, priority } = req.body;
    if (!requestType || !description) return res.status(400).json({ message: "Type and description required." });
    const { rows: resv } = await pool.query("SELECT room_id FROM reservations WHERE id=$1", [req.guest.reservationId]);
    const { rows } = await pool.query(
      "INSERT INTO guest_requests(guest_id,reservation_id,room_id,request_type,description,priority) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [req.guest.guestId, req.guest.reservationId, resv[0]?.room_id || null, requestType, description, priority || "NORMAL"]
    );
    res.status(201).json({ message: "Request submitted! Our team will attend to you shortly.", request: rows[0] });
  } catch (e) { next(e); }
});

// Guest: my concierge requests
app.get("/api/guest/concierge", guestAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM guest_requests WHERE guest_id=$1 AND reservation_id=$2 ORDER BY created_at DESC",
      [req.guest.guestId, req.guest.reservationId]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// Guest: get folio / charges
app.get("/api/guest/folio", guestAuth, async (req, res, next) => {
  try {
    const { rows: folios } = await pool.query("SELECT * FROM folios WHERE reservation_id=$1", [req.guest.reservationId]);
    if (!folios[0]) return res.json({ folio: null, items: [] });
    const { rows: items } = await pool.query(
      "SELECT * FROM folio_items WHERE folio_id=$1 ORDER BY created_at", [folios[0].id]
    );
    res.json({ folio: folios[0], items });
  } catch (e) { next(e); }
});

// Guest: get hotel info / services
app.get("/api/guest/hotel-info", guestAuth, async (req, res, next) => {
  res.json({
    hotel: {
      name: "RHoSAM Hotel & Suites",
      address: "Victoria Island, Lagos, Nigeria",
      phone: "+234 1 234 5678",
      reception: "+234 1 234 5680",
      concierge: "+234 1 234 5681",
      restaurants: [
        { name: "The Amber Restaurant", hours: "6:00 AM - 11:00 PM", cuisine: "International & Nigerian" },
        { name: "Skyline Rooftop Bar", hours: "5:00 PM - 2:00 AM", cuisine: "Cocktails & Light Bites" },
        { name: "Garden Terrace Café", hours: "7:00 AM - 10:00 PM", cuisine: "Coffee & Pastries" }
      ],
      spa: { name: "RHoSAM Wellness Spa", hours: "9:00 AM - 9:00 PM", phone: "+234 1 234 5682" },
      gym: { name: "RHoSAM Fitness Centre", hours: "24 Hours", equipment: "Cardio, Weights, Yoga Studio" },
      pool: { name: "Infinity Pool & Cabanas", hours: "7:00 AM - 8:00 PM" },
      wifi: { network: "RHoSAM-Guest", password: "Welcome2026" },
      checkout: "12:00 PM",
      lateCheckout: "Available upon request (subject to availability)",
      services: ["24-Hour Room Service", "Concierge", "Airport Transfer", "Laundry & Dry Cleaning", "Valet Parking", "Business Centre", "Tour Desk", "Baby-sitting Service"]
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// DIGITAL ROOM KEY
// ═══════════════════════════════════════════════════════════════════
app.get("/api/guest/digital-key", guestAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT dk.*, r.number AS room_number
       FROM digital_keys dk
       LEFT JOIN rooms r ON r.id = dk.room_id
       WHERE dk.guest_id=$1 AND dk.is_active=TRUE AND dk.is_revoked=FALSE
       ORDER BY dk.created_at DESC LIMIT 1`, [req.guest.guestId]
    );
    if (!rows.length) return res.json(null);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.post("/api/guest/digital-key/activate", guestAuth, async (req, res, next) => {
  try {
    // Check for existing active key
    const { rows: existing } = await pool.query(
      `SELECT * FROM digital_keys WHERE guest_id=$1 AND is_active=TRUE AND is_revoked=FALSE`, [req.guest.guestId]
    );
    if (existing.length) return res.json(existing[0]);

    // Get reservation and room info
    const { rows: resv } = await pool.query(
      `SELECT r.id as reservation_id, r.room_id, rm.number AS room_number
       FROM reservations r LEFT JOIN rooms rm ON rm.id = r.room_id
       WHERE r.id=$1 AND r.status='CHECKED_IN'`, [req.guest.reservationId]
    );
    if (!resv.length) return res.status(400).json({ message: "No active checked-in reservation found." });

    // Generate unique key code
    const keyCode = `RK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const expiresAt = new Date(resv[0].check_out_date || Date.now() + 7 * 86400000);

    const { rows } = await pool.query(
      `INSERT INTO digital_keys(guest_id, reservation_id, room_id, key_code, key_type, permissions, activated_at, expires_at)
       VALUES($1,$2,$3,$4,'QR', '{"lock":true,"lights":true,"ac":true,"tv":true}', NOW(), $5) RETURNING *`,
      [req.guest.guestId, resv[0].reservation_id, resv[0].room_id, keyCode, expiresAt]
    );

    // Ensure room has controls
    await pool.query(
      `INSERT INTO room_controls(room_id) VALUES($1) ON CONFLICT DO NOTHING`, [resv[0].room_id]
    );

    // Log access
    await pool.query(
      `INSERT INTO key_access_log(key_id, room_id, guest_id, action, method) VALUES($1,$2,$3,'ACTIVATE','DIGITAL')`,
      [rows[0].id, resv[0].room_id, req.guest.guestId]
    );

    res.status(201).json({ ...rows[0], room_number: resv[0].room_number, room_type: resv[0].room_type });
  } catch (e) { next(e); }
});

app.post("/api/guest/digital-key/unlock", guestAuth, async (req, res, next) => {
  try {
    const { keyCode } = req.body;
    const { rows } = await pool.query(
      `SELECT dk.*, rm.number AS room_number FROM digital_keys dk
       LEFT JOIN rooms rm ON rm.id = dk.room_id
       WHERE dk.guest_id=$1 AND dk.is_active=TRUE AND dk.is_revoked=FALSE AND dk.expires_at > NOW()`,
      [req.guest.guestId]
    );
    if (!rows.length) return res.status(400).json({ message: "No valid digital key found." });

    const key = rows[0];
    const valid = !keyCode || key.key_code === keyCode;

    // Log access
    await pool.query(
      `INSERT INTO key_access_log(key_id, room_id, guest_id, action, method, success)
       VALUES($1,$2,$3,'UNLOCK',$4,$5)`,
      [key.id, key.room_id, req.guest.guestId, keyCode ? 'QR' : 'NFC', valid]
    );

    if (!valid) return res.status(403).json({ message: "Invalid key code." });

    // Update room status to occupied
    await pool.query(`UPDATE rooms SET status='OCCUPIED' WHERE id=$1`, [key.room_id]);

    res.json({ success: true, roomNumber: key.room_number, message: "Room unlocked!" });
  } catch (e) { next(e); }
});

app.post("/api/guest/digital-key/revoke", guestAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE digital_keys SET is_revoked=TRUE, is_active=FALSE WHERE guest_id=$1 AND is_active=TRUE RETURNING *`,
      [req.guest.guestId]
    );
    if (!rows.length) return res.status(404).json({ message: "No active key found." });
    res.json({ message: "Digital key revoked." });
  } catch (e) { next(e); }
});

app.get("/api/guest/digital-key/access-log", guestAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT kal.*, r.number AS room_number FROM key_access_log kal
       LEFT JOIN rooms r ON r.id = kal.room_id
       WHERE kal.guest_id=$1 ORDER BY kal.created_at DESC LIMIT 20`,
      [req.guest.guestId]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// ROOM CONTROLS
// ═══════════════════════════════════════════════════════════════════
app.get("/api/guest/room-controls", guestAuth, async (req, res, next) => {
  try {
    const { rows: resv } = await pool.query(
      `SELECT room_id FROM reservations WHERE id=$1`, [req.guest.reservationId]
    );
    if (!resv.length) return res.status(404).json({ message: "No reservation found." });

    // Ensure controls exist
    await pool.query(`INSERT INTO room_controls(room_id) VALUES($1) ON CONFLICT DO NOTHING`, [resv[0].room_id]);

    const { rows } = await pool.query(
      `SELECT rc.*, r.number AS room_number FROM room_controls rc
       LEFT JOIN rooms r ON r.id = rc.room_id
       WHERE rc.room_id=$1`, [resv[0].room_id]
    );
    res.json(rows[0] || {});
  } catch (e) { next(e); }
});

app.patch("/api/guest/room-controls", guestAuth, async (req, res, next) => {
  try {
    const { rows: resv } = await pool.query(
      `SELECT room_id FROM reservations WHERE id=$1 AND status='CHECKED_IN'`, [req.guest.reservationId]
    );
    if (!resv.length) return res.status(404).json({ message: "No active reservation found." });

    const allowed = ["lights_main","lights_bedroom","lights_bathroom","lights_mood","ac_enabled","ac_temperature","ac_mode","ac_fan_speed","tv_on","tv_channel","tv_volume","curtains_open","do_not_disturb"];
    const updates = [];
    const params = [];
    let idx = 1;

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key}=$${idx++}`);
        params.push(req.body[key]);
      }
    }
    if (!updates.length) return res.status(400).json({ message: "No valid fields to update." });

    updates.push(`updated_at=NOW()`);
    params.push(resv[0].room_id);

    const { rows } = await pool.query(
      `UPDATE room_controls SET ${updates.join(",")} WHERE room_id=$${idx} RETURNING *`, params
    );

    // Broadcast control change via WebSocket
    broadcastAll({ type: 'room_control', data: { roomId: resv[0].room_id, controls: rows[0] } });

    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// LOCAL EXPERIENCES & ATTRACTIONS
// ═══════════════════════════════════════════════════════════════════
app.get("/api/guest/experiences", guestAuth, async (req, res, next) => {
  try {
    const { category, featured } = req.query;
    let sql = `SELECT * FROM local_experiences WHERE is_active=TRUE`;
    const params = [];
    let idx = 1;
    if (category) { sql += ` AND category=$${idx++}`; params.push(category); }
    if (featured === 'true') { sql += ` AND is_featured=TRUE`; }
    sql += ` ORDER BY is_featured DESC, rating DESC, review_count DESC`;
    const { rows } = await pool.query(sql, params);
    // Parse JSON fields
    const experiences = rows.map(r => ({
      ...r,
      highlights: typeof r.highlights === 'string' ? JSON.parse(r.highlights) : r.highlights,
      includes: typeof r.includes === 'string' ? JSON.parse(r.includes) : r.includes,
    }));
    res.json(experiences);
  } catch (e) { next(e); }
});

app.get("/api/guest/experiences/:id", guestAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM local_experiences WHERE id=$1 AND is_active=TRUE`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: "Experience not found." });
    const exp = rows[0];
    exp.highlights = typeof exp.highlights === 'string' ? JSON.parse(exp.highlights) : exp.highlights;
    exp.includes = typeof exp.includes === 'string' ? JSON.parse(exp.includes) : exp.includes;
    res.json(exp);
  } catch (e) { next(e); }
});

app.get("/api/guest/experience-categories", guestAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT category, COUNT(*) as count, MIN(price_from) as price_from, MIN(distance_km) as distance_km
       FROM local_experiences WHERE is_active=TRUE GROUP BY category ORDER BY count DESC`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.post("/api/guest/experience-book", guestAuth, async (req, res, next) => {
  try {
    const { experienceId, bookingDate, bookingTime, groupSize, specialRequests, contactPhone } = req.body;
    if (!experienceId || !bookingDate) return res.status(400).json({ message: "Experience and date required." });

    // Get experience details
    const { rows: exp } = await pool.query(`SELECT * FROM local_experiences WHERE id=$1 AND is_active=TRUE`, [experienceId]);
    if (!exp.length) return res.status(404).json({ message: "Experience not found." });

    const size = Number(groupSize) || 1;
    if (size > exp[0].max_group_size) return res.status(400).json({ message: `Maximum group size is ${exp[0].max_group_size}.` });

    const totalPrice = Number(exp[0].price_from) * size;
    const guestName = req.guest?.firstName ? `${req.guest.firstName} ${req.guest.lastName}` : "Guest";

    const { rows } = await pool.query(
      `INSERT INTO experience_bookings(guest_id, reservation_id, experience_id, booking_date, booking_time, group_size, total_price, special_requests, contact_phone, status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING') RETURNING *`,
      [req.guest.guestId, req.guest.reservationId, experienceId, bookingDate, bookingTime || null, size, totalPrice, specialRequests || null, contactPhone || null]
    );

    // Notify concierge staff
    try {
      await notifyByRole(["ADMIN", "MANAGER", "FRONT_DESK"],
        "New Experience Booking",
        `${guestName} wants to book "${exp[0].name}" for ${bookingDate} (${size} guests, ₦${Number(totalPrice).toLocaleString()})`,
        "EXPERIENCE", "experience_booking", rows[0].id
      );
    } catch (nErr) { console.error("[Notify] Experience booking error:", nErr.message); }

    res.status(201).json({ message: "Booking request submitted! Our concierge team will confirm shortly.", booking: rows[0] });
  } catch (e) { next(e); }
});

app.get("/api/guest/experience-bookings", guestAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT eb.*, le.name as experience_name, le.category as experience_category, le.location, le.duration_hours, le.image_url
       FROM experience_bookings eb
       LEFT JOIN local_experiences le ON le.id = eb.experience_id
       WHERE eb.guest_id=$1 ORDER BY eb.created_at DESC`, [req.guest.guestId]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.delete("/api/guest/experience-bookings/:id", guestAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE experience_bookings SET status='CANCELLED' WHERE id=$1 AND guest_id=$2 AND status='PENDING' RETURNING *`,
      [req.params.id, req.guest.guestId]
    );
    if (!rows.length) return res.status(404).json({ message: "Booking not found or cannot be cancelled." });
    res.json({ message: "Booking cancelled." });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// Guest: submit feedback / rating
// ═══════════════════════════════════════════════════════════════════
app.post("/api/guest/feedback", guestAuth, async (req, res, next) => {
  try {
    const { rating, category, comment } = req.body;
    if (!rating) return res.status(400).json({ message: "Rating required." });
    // Store as a notification for management
    const { rows: users } = await pool.query("SELECT id FROM users WHERE role='ADMIN' LIMIT 1");
    if (users[0]) {
      await pool.query(
        "INSERT INTO notifications(user_id,title,body,type) VALUES($1,$2,$3,'FEEDBACK')",
        [users[0].id, `Guest Feedback (${category || 'General'})`, `Rating: ${rating}/5 — ${comment || 'No comment'} (Guest: ${req.guest.name})`]
      );
    }
    res.json({ message: "Thank you for your feedback!" });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// MULTI-CURRENCY & PAYMENT GATEWAYS
// ═══════════════════════════════════════════════════════════════════

const SUPPORTED_CURRENCIES = {
  NGN: { name: "Nigerian Naira", symbol: "₦", code: "NGN", rate: 1 },
  USD: { name: "US Dollar", symbol: "$", code: "USD", rate: 0.00065 },
  GBP: { name: "British Pound", symbol: "£", code: "GBP", rate: 0.00052 },
  EUR: { name: "Euro", symbol: "€", code: "EUR", rate: 0.00060 },
  AED: { name: "UAE Dirham", symbol: "د.إ", code: "AED", rate: 0.0024 },
  ZAR: { name: "South African Rand", symbol: "R", code: "ZAR", rate: 0.012 },
  GHS: { name: "Ghanaian Cedi", symbol: "₵", code: "GHS", rate: 0.010 },
  KES: { name: "Kenyan Shilling", symbol: "KSh", code: "KES", rate: 0.084 },
  CNY: { name: "Chinese Yuan", symbol: "¥", code: "CNY", rate: 0.0047 },
  INR: { name: "Indian Rupee", symbol: "₹", code: "INR", rate: 0.054 },
};

const PAYMENT_GATEWAYS = {
  stripe: { name: "Stripe", supported: ["USD","EUR","GBP","NGN"], enabled: true },
  paystack: { name: "Paystack", supported: ["NGN","USD","GHS","ZAR","KES"], enabled: true },
  flutterwave: { name: "Flutterwave", supported: ["NGN","USD","GBP","EUR","GHS","KES","ZAR"], enabled: true },
  manual: { name: "Manual / Cash", supported: Object.keys(SUPPORTED_CURRENCIES), enabled: true },
};

// Get currency config
app.get("/api/currencies", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT value FROM hotel_config WHERE key='currencies'");
    const config = rows[0]?.value || { baseCurrency: "NGN", enabled: ["NGN","USD","GBP","EUR","AED"] };
    res.json({ currencies: SUPPORTED_CURRENCIES, config, gateways: PAYMENT_GATEWAYS });
  } catch (e) { next(e); }
});

// Update currency config
app.patch("/api/currencies", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const { baseCurrency, enabled, rates } = req.body;
    const { rows: existing } = await pool.query("SELECT value FROM hotel_config WHERE key='currencies'");
    const current = existing[0]?.value || {};
    const updated = { ...current };
    if (baseCurrency) updated.baseCurrency = baseCurrency;
    if (enabled) updated.enabled = enabled;
    if (rates) updated.customRates = { ...(current.customRates || {}), ...rates };
    await pool.query(
      `INSERT INTO hotel_config(key,value,updated_at) VALUES('currencies',$1,NOW())
       ON CONFLICT(key) DO UPDATE SET value=$1, updated_at=NOW()`, [JSON.stringify(updated)]
    );
    res.json({ message: "Currency config updated.", config: updated });
  } catch (e) { next(e); }
});

// Convert amount between currencies
app.post("/api/currencies/convert", auth, async (req, res, next) => {
  try {
    const { amount, from, to } = req.body;
    if (!amount || !from || !to) return res.status(400).json({ message: "Amount, from and to currencies required." });
    const { rows } = await pool.query("SELECT value FROM hotel_config WHERE key='currencies'");
    const config = rows[0]?.value || {};
    const customRates = config.customRates || {};
    const fromRate = customRates[from] || SUPPORTED_CURRENCIES[from]?.rate;
    const toRate = customRates[to] || SUPPORTED_CURRENCIES[to]?.rate;
    if (!fromRate || !toRate) return res.status(400).json({ message: "Unsupported currency." });
    const baseAmount = Number(amount) / fromRate;
    const converted = baseAmount * toRate;
    res.json({
      original: { amount: Number(amount), currency: from, symbol: SUPPORTED_CURRENCIES[from]?.symbol },
      converted: { amount: Math.round(converted * 100) / 100, currency: to, symbol: SUPPORTED_CURRENCIES[to]?.symbol },
      rate: Math.round((toRate / fromRate) * 1000000) / 1000000
    });
  } catch (e) { next(e); }
});

// Get payment gateways config
app.get("/api/payment-gateways", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT value FROM hotel_config WHERE key='payment_gateways'");
    const config = rows[0]?.value || { activeGateway: "paystack", testMode: true };
    res.json({ gateways: PAYMENT_GATEWAYS, config });
  } catch (e) { next(e); }
});

// Update payment gateway config
app.patch("/api/payment-gateways", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const { activeGateway, testMode, stripeKey, paystackKey, flutterwaveKey } = req.body;
    const { rows: existing } = await pool.query("SELECT value FROM hotel_config WHERE key='payment_gateways'");
    const current = existing[0]?.value || {};
    const updated = { ...current };
    if (activeGateway) updated.activeGateway = activeGateway;
    if (testMode !== undefined) updated.testMode = testMode;
    if (stripeKey) updated.stripeKey = stripeKey;
    if (paystackKey) updated.paystackKey = paystackKey;
    if (flutterwaveKey) updated.flutterwaveKey = flutterwaveKey;
    await pool.query(
      `INSERT INTO hotel_config(key,value,updated_at) VALUES('payment_gateways',$1,NOW())
       ON CONFLICT(key) DO UPDATE SET value=$1, updated_at=NOW()`, [JSON.stringify(updated)]
    );
    res.json({ message: "Payment gateway config updated.", config: updated });
  } catch (e) { next(e); }
});

// Process a payment (simulated gateway integration)
app.post("/api/payments/process", auth, allow("ADMIN","MANAGER","FRONT_DESK"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { folioId, amount, currency, gateway, guestEmail, guestName, description, reservationId } = req.body;
    if (!amount || !currency) return res.status(400).json({ message: "Amount and currency required." });
    const gw = gateway || "manual";
    if (!PAYMENT_GATEWAYS[gw]) return res.status(400).json({ message: "Invalid payment gateway." });

    // Simulate gateway processing
    const txnId = `TXN-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const isSimulated = gw !== "manual";
    const status = "COMPLETED"; // Simulated success

    await client.query("BEGIN");

    // Convert to base currency for folio
    const { rows: configRows } = await client.query("SELECT value FROM hotel_config WHERE key='currencies'");
    const config = configRows[0]?.value || {};
    const customRates = config.customRates || {};
    const fromRate = customRates[currency] || SUPPORTED_CURRENCIES[currency]?.rate || 1;
    const baseAmount = Math.round((Number(amount) / fromRate) * 100) / 100;

    // Record payment in folio if folioId provided
    if (folioId) {
      await client.query(
        `INSERT INTO folio_items(folio_id,description,amount,category,posted_by) VALUES($1,$2,$3,'PAYMENT',$4)`,
        [folioId, `Payment via ${PAYMENT_GATEWAYS[gw].name} (${currency} ${Number(amount).toLocaleString()}) — ${txnId}`, -baseAmount, req.user.id]
      );
      await client.query("UPDATE folios SET total_payments=total_payments+$1, balance=balance-$1 WHERE id=$2", [baseAmount, folioId]);
    }

    // Create payment record in hotel_config as a transaction log
    const paymentRecord = {
      id: txnId, gateway: gw, amount: Number(amount), currency, baseAmount,
      symbol: SUPPORTED_CURRENCIES[currency]?.symbol || currency,
      guestName: guestName || null, guestEmail: guestEmail || null,
      description: description || "Hotel payment",
      reservationId: reservationId || null, folioId: folioId || null,
      status, processedBy: req.user.name,
      processedAt: new Date().toISOString(),
      isSimulated
    };

    // Store in payment log
    const { rows: logRows } = await client.query("SELECT value FROM hotel_config WHERE key='payment_log'");
    const log = logRows[0]?.value || [];
    log.unshift(paymentRecord);
    if (log.length > 200) log.length = 200; // Keep last 200
    await client.query(
      `INSERT INTO hotel_config(key,value,updated_at) VALUES('payment_log',$1,NOW())
       ON CONFLICT(key) DO UPDATE SET value=$1, updated_at=NOW()`, [JSON.stringify(log)]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Payment processed successfully!",
      transaction: {
        id: txnId, gateway: PAYMENT_GATEWAYS[gw].name,
        amount: Number(amount), currency, symbol: SUPPORTED_CURRENCIES[currency]?.symbol,
        baseAmount, status, isSimulated
      }
    });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

// Get payment history/log
app.get("/api/payments", auth, allow("ADMIN","MANAGER"), async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT value FROM hotel_config WHERE key='payment_log'");
    res.json(rows[0]?.value || []);
  } catch (e) { next(e); }
});

// Refund a payment (simulated)
app.post("/api/payments/refund/:txnId", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const txnId = req.params.txnId;
    const { rows } = await pool.query("SELECT value FROM hotel_config WHERE key='payment_log'");
    const log = rows[0]?.value || [];
    const txn = log.find(t => t.id === txnId);
    if (!txn) return res.status(404).json({ message: "Transaction not found." });
    if (txn.status === "REFUNDED") return res.status(400).json({ message: "Already refunded." });

    // Add refund record
    const refundRecord = {
      id: `REF-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      gateway: txn.gateway, amount: -txn.amount, currency: txn.currency,
      baseAmount: -txn.baseAmount, symbol: txn.symbol,
      guestName: txn.guestName, guestEmail: txn.guestEmail,
      description: `Refund for ${txnId}`,
      reservationId: txn.reservationId, folioId: txn.folioId,
      status: "REFUNDED", processedBy: req.user.name,
      processedAt: new Date().toISOString(), isRefund: true, originalTxn: txnId
    };
    log.unshift(refundRecord);
    txn.status = "REFUNDED";

    // Update folio if applicable
    if (txn.folioId) {
      await pool.query(
        `INSERT INTO folio_items(folio_id,description,amount,category,posted_by) VALUES($1,$2,$3,'REFUND',$4)`,
        [txn.folioId, `Refund via ${txn.gateway} — ${refundRecord.id}`, txn.baseAmount, req.user.id]
      );
      await pool.query("UPDATE folios SET total_payments=total_payments-$1, balance=balance+$1 WHERE id=$2", [Math.abs(txn.baseAmount), txn.folioId]);
    }

    await pool.query(
      `INSERT INTO hotel_config(key,value,updated_at) VALUES('payment_log',$1,NOW())
       ON CONFLICT(key) DO UPDATE SET value=$1, updated_at=NOW()`, [JSON.stringify(log)]
    );

    res.json({ message: "Refund processed.", refund: refundRecord });
  } catch (e) { next(e); }
});

// Get exchange rates
app.get("/api/exchange-rates", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT value FROM hotel_config WHERE key='currencies'");
    const config = rows[0]?.value || {};
    const customRates = config.customRates || {};
    const rates = {};
    for (const [code, info] of Object.entries(SUPPORTED_CURRENCIES)) {
      rates[code] = { ...info, rate: customRates[code] || info.rate };
    }
    res.json({ baseCurrency: config.baseCurrency || "NGN", rates });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// ERROR HANDLER
// ═══════════════════════════════════════════════════════════════════
app.use((err, req, res, _next) => {
  console.error("[ERROR]", err.message);
  res.status(500).json({ message: "Internal server error." });
});

// ═══════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════
async function start() {
  await migrate();
  await seed();
  server.listen(PORT, () => {
    console.log(`\n  🏨 RHoSAM Hotel & Suites — Backend API`);
    console.log(`  ➜ Running on http://localhost:${PORT}`);
    console.log(`  ➜ WebSocket: ws://localhost:${PORT}/ws`);
    console.log(`  ➜ Database: ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[1] || "connected"}\n`);
  });
}

start().catch(e => { console.error("Failed to start:", e); process.exit(1); });
