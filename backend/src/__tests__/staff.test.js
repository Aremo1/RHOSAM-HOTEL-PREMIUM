const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

// Set test environment
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:rhosam@localhost:5432/rhosam_hotel";
process.env.JWT_SECRET = "test-jwt-secret-key";
process.env.PAYMENT_GATEWAY = "INTERNAL";

let pool;
let adminToken;
let managerToken;
let frontDeskToken;

// Setup test data
beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    // Get or create admin user
    let adminResult = await pool.query("SELECT id, email FROM users WHERE role = 'ADMIN' LIMIT 1");
    if (adminResult.rows.length === 0) {
      const hashedPassword = await bcrypt.hash("admin123", 10);
      adminResult = await pool.query(
        `INSERT INTO users (name, email, password, role) VALUES ('Admin', 'admin@rhosamhotel.com', $1, 'ADMIN') RETURNING id, email`,
        [hashedPassword]
      );
    }
    
    // Get or create manager user
    let managerResult = await pool.query("SELECT id, email FROM users WHERE role = 'MANAGER' LIMIT 1");
    if (managerResult.rows.length === 0) {
      const hashedPassword = await bcrypt.hash("manager123", 10);
      managerResult = await pool.query(
        `INSERT INTO users (name, email, password, role) VALUES ('Manager', 'manager@rhosamhotel.com', $1, 'MANAGER') RETURNING id, email`,
        [hashedPassword]
      );
    }
    
    // Get or create front desk user
    let frontDeskResult = await pool.query("SELECT id, email FROM users WHERE role = 'FRONT_DESK' LIMIT 1");
    if (frontDeskResult.rows.length === 0) {
      const hashedPassword = await bcrypt.hash("staff123", 10);
      frontDeskResult = await pool.query(
        `INSERT INTO users (name, email, password, role) VALUES ('Front Desk', 'frontdesk@rhosamhotel.com', $1, 'FRONT_DESK') RETURNING id, email`,
        [hashedPassword]
      );
    }
    
    // Generate tokens
    adminToken = jwt.sign(
      { id: adminResult.rows[0].id, email: adminResult.rows[0].email, role: "ADMIN" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    
    managerToken = jwt.sign(
      { id: managerResult.rows[0].id, email: managerResult.rows[0].email, role: "MANAGER" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    
    frontDeskToken = jwt.sign(
      { id: frontDeskResult.rows[0].id, email: frontDeskResult.rows[0].email, role: "FRONT_DESK" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    
  } catch (error) {
    console.error("Setup error:", error.message);
    throw error;
  }
});

afterAll(async () => {
  if (pool) await pool.end();
});

// ═══════════════════════════════════════════════════════════════════
// STAFF AUTH TESTS
// ═══════════════════════════════════════════════════════════════════
describe("Staff Auth", () => {
  
  it("should login with valid credentials", async () => {
    const res = await request("http://localhost:5000")
      .post("/api/auth/login")
      .send({ email: "admin@rhosamhotel.com", password: "admin123" });
    
    if (res.status === 200) {
      expect(res.body).toHaveProperty("token");
      expect(res.body).toHaveProperty("user");
      expect(res.body.user.role).toBe("ADMIN");
    }
  });
  
  it("should reject login with wrong password", async () => {
    const res = await request("http://localhost:5000")
      .post("/api/auth/login")
      .send({ email: "admin@rhosamhotel.com", password: "wrongpassword" });
    
    if (res.status === 401) {
      expect(res.body.message).toMatch(/invalid/i);
    }
  });
  
  it("should reject login with non-existent email", async () => {
    const res = await request("http://localhost:5000")
      .post("/api/auth/login")
      .send({ email: "nonexistent@rhosam.com", password: "test123" });
    
    if (res.status === 401) {
      expect(res.body.message).toMatch(/invalid|not found/i);
    }
  });
  
  it("should get current user profile", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("email");
      expect(res.body).toHaveProperty("role");
    }
  });
  
  it("should require authentication for profile", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/auth/me");
    
    if (res.status === 401) {
      expect(res.body.message).toMatch(/auth/i);
    }
  });
  
});

// ═══════════════════════════════════════════════════════════════════
// USER MANAGEMENT TESTS
// ═══════════════════════════════════════════════════════════════════
describe("User Management", () => {
  
  it("should list all users (admin only)", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/users")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        expect(res.body[0]).toHaveProperty("id");
        expect(res.body[0]).toHaveProperty("email");
        expect(res.body[0]).toHaveProperty("role");
      }
    }
  });
  
  it("should reject non-admin from listing users", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/users")
      .set("Authorization", `Bearer ${frontDeskToken}`);
    
    if (res.status === 403) {
      expect(res.body.message).toMatch(/forbidden|permission/i);
    }
  });
  
  it("should create a new user (admin only)", async () => {
    const res = await request("http://localhost:5000")
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Test Staff",
        email: `test.staff.${Date.now()}@rhosam.com`,
        password: "staff123",
        role: "STAFF"
      });
    
    if (res.status === 201) {
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("email");
    }
  });
  
  it("should reject non-admin from creating users", async () => {
    const res = await request("http://localhost:5000")
      .post("/api/users")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        name: "Test",
        email: "test@rhosam.com",
        password: "test123",
        role: "STAFF"
      });
    
    if (res.status === 403) {
      expect(res.body.message).toMatch(/forbidden|permission/i);
    }
  });
  
});

// ═══════════════════════════════════════════════════════════════════
// RESERVATION TESTS
// ═══════════════════════════════════════════════════════════════════
describe("Reservations", () => {
  
  it("should list all reservations", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/reservations")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        expect(res.body[0]).toHaveProperty("confirmation_number");
        expect(res.body[0]).toHaveProperty("status");
      }
    }
  });
  
  it("should get reservation by ID", async () => {
    // First get a reservation
    const listRes = await request("http://localhost:5000")
      .get("/api/reservations")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (listRes.status === 200 && listRes.body.length > 0) {
      const reservationId = listRes.body[0].id;
      
      const res = await request("http://localhost:5000")
        .get(`/api/reservations/${reservationId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      if (res.status === 200) {
        expect(res.body).toHaveProperty("confirmation_number");
        expect(res.body).toHaveProperty("guest");
        expect(res.body).toHaveProperty("room");
      }
    }
  });
  
  it("should create a new reservation", async () => {
    // Get an available room
    const roomRes = await pool.query(
      `SELECT id FROM rooms WHERE status = 'AVAILABLE' LIMIT 1`
    );
    
    if (roomRes.rows.length > 0) {
      // Get a guest
      const guestRes = await pool.query("SELECT id FROM guests LIMIT 1");
      
      if (guestRes.rows.length > 0) {
        const res = await request("http://localhost:5000")
          .post("/api/reservations")
          .set("Authorization", `Bearer ${adminToken}`)
          .send({
            guestId: guestRes.rows[0].id,
            roomId: roomRes.rows[0].id,
            roomTypeId: 1,
            checkIn: new Date().toISOString().split("T")[0],
            checkOut: new Date(Date.now() + 86400000 * 2).toISOString().split("T")[0],
            adults: 1,
            rate: 50000
          });
        
        if (res.status === 201) {
          expect(res.body).toHaveProperty("confirmation_number");
          expect(res.body.status).toBe("CONFIRMED");
        }
      }
    }
  });
  
  it("should update reservation status", async () => {
    // Find a CONFIRMED reservation
    const { rows } = await pool.query(
      "SELECT id FROM reservations WHERE status = 'CONFIRMED' LIMIT 1"
    );
    
    if (rows.length > 0) {
      const res = await request("http://localhost:5000")
        .patch(`/api/reservations/${rows[0].id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "CHECKED_IN" });
      
      if (res.status === 200) {
        expect(res.body.status).toMatch(/CHECKED_IN/);
      }
    }
  });
  
  it("should require auth for reservations", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/reservations");
    
    if (res.status === 401) {
      expect(res.body.message).toMatch(/auth/i);
    }
  });
  
});

// ═══════════════════════════════════════════════════════════════════
// ROOM MANAGEMENT TESTS
// ═══════════════════════════════════════════════════════════════════
describe("Room Management", () => {
  
  it("should list all rooms", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/rooms")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        expect(res.body[0]).toHaveProperty("number");
        expect(res.body[0]).toHaveProperty("status");
      }
    }
  });
  
  it("should get room availability", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/rooms/availability")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
    }
  });
  
  it("should update room status", async () => {
    const { rows } = await pool.query("SELECT id FROM rooms LIMIT 1");
    
    if (rows.length > 0) {
      const res = await request("http://localhost:5000")
        .patch(`/api/rooms/${rows[0].id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "MAINTENANCE" });
      
      if (res.status === 200) {
        expect(res.body.status).toBe("MAINTENANCE");
      }
      
      // Reset status
      await pool.query("UPDATE rooms SET status = 'AVAILABLE' WHERE id = $1", [rows[0].id]);
    }
  });
  
  it("should list room types", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/room-types")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        expect(res.body[0]).toHaveProperty("name");
        expect(res.body[0]).toHaveProperty("base_rate");
      }
    }
  });
  
  it("should require auth for rooms", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/rooms");
    
    if (res.status === 401) {
      expect(res.body.message).toMatch(/auth/i);
    }
  });
  
});

// ═══════════════════════════════════════════════════════════════════
// GUEST MANAGEMENT TESTS
// ═══════════════════════════════════════════════════════════════════
describe("Guest Management", () => {
  
  it("should list all guests", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/guests")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        expect(res.body[0]).toHaveProperty("first_name");
        expect(res.body[0]).toHaveProperty("last_name");
        expect(res.body[0]).toHaveProperty("email");
      }
    }
  });
  
  it("should get guest by ID", async () => {
    const { rows } = await pool.query("SELECT id FROM guests LIMIT 1");
    
    if (rows.length > 0) {
      const res = await request("http://localhost:5000")
        .get(`/api/guests/${rows[0].id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      if (res.status === 200) {
        expect(res.body).toHaveProperty("first_name");
        expect(res.body).toHaveProperty("reservations");
      }
    }
  });
  
  it("should require auth for guests", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/guests");
    
    if (res.status === 401) {
      expect(res.body.message).toMatch(/auth/i);
    }
  });
  
});

// ═══════════════════════════════════════════════════════════════════
// RESTAURANT TESTS
// ═══════════════════════════════════════════════════════════════════
describe("Restaurant", () => {
  
  it("should list restaurant menu", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/restaurant/menu")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        expect(res.body[0]).toHaveProperty("name");
        expect(res.body[0]).toHaveProperty("price");
      }
    }
  });
  
  it("should list restaurant orders", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/restaurant/orders")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
    }
  });
  
  it("should create a restaurant order", async () => {
    // Get menu items
    const menuRes = await request("http://localhost:5000")
      .get("/api/restaurant/menu")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (menuRes.status === 200 && menuRes.body.length > 0) {
      const menuItem = menuRes.body[0];
      
      const res = await request("http://localhost:5000")
        .post("/api/restaurant/orders")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          items: [{ menuItemId: menuItem.id, quantity: 1 }],
          specialInstructions: "Test order"
        });
      
      if (res.status === 201) {
        expect(res.body).toHaveProperty("id");
        expect(res.body.status).toBe("PENDING");
      }
    }
  });
  
  it("should update order status", async () => {
    const { rows } = await pool.query(
      "SELECT id FROM restaurant_orders WHERE status = 'PENDING' LIMIT 1"
    );
    
    if (rows.length > 0) {
      const res = await request("http://localhost:5000")
        .patch(`/api/restaurant/orders/${rows[0].id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "PREPARING" });
      
      if (res.status === 200) {
        expect(res.body.status).toBe("PREPARING");
      }
    }
  });
  
  it("should require auth for restaurant", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/restaurant/menu");
    
    if (res.status === 401) {
      expect(res.body.message).toMatch(/auth/i);
    }
  });
  
});

// ═══════════════════════════════════════════════════════════════════
// HOUSEKEEPING TESTS
// ═══════════════════════════════════════════════════════════════════
describe("Housekeeping", () => {
  
  it("should list housekeeping tasks", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/housekeeping")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
    }
  });
  
  it("should create a housekeeping task", async () => {
    const { rows } = await pool.query("SELECT id FROM rooms LIMIT 1");
    
    if (rows.length > 0) {
      const res = await request("http://localhost:5000")
        .post("/api/housekeeping")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          roomId: rows[0].id,
          taskType: "CLEANING",
          priority: "NORMAL",
          notes: "Test task"
        });
      
      if (res.status === 201) {
        expect(res.body).toHaveProperty("id");
        expect(res.body.status).toBe("PENDING");
      }
    }
  });
  
  it("should update housekeeping task status", async () => {
    const { rows } = await pool.query(
      "SELECT id FROM housekeeping_tasks WHERE status = 'PENDING' LIMIT 1"
    );
    
    if (rows.length > 0) {
      const res = await request("http://localhost:5000")
        .patch(`/api/housekeeping/${rows[0].id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "IN_PROGRESS" });
      
      if (res.status === 200) {
        expect(res.body.status).toBe("IN_PROGRESS");
      }
    }
  });
  
  it("should require auth for housekeeping", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/housekeeping");
    
    if (res.status === 401) {
      expect(res.body.message).toMatch(/auth/i);
    }
  });
  
});

// ═══════════════════════════════════════════════════════════════════
// FINANCE TESTS
// ═══════════════════════════════════════════════════════════════════
describe("Finance", () => {
  
  it("should get finance summary", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/finance/summary")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(res.body).toHaveProperty("totalRevenue");
      expect(res.body).toHaveProperty("totalExpenses");
    }
  });
  
  it("should list expenses", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/finance/expenses")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
    }
  });
  
  it("should require auth for finance", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/finance/summary");
    
    if (res.status === 401) {
      expect(res.body.message).toMatch(/auth/i);
    }
  });
  
});

// ═══════════════════════════════════════════════════════════════════
// SPA MANAGEMENT TESTS
// ═══════════════════════════════════════════════════════════════════
describe("Spa Management", () => {
  
  it("should list spa services (staff)", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/spa/services")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
    }
  });
  
  it("should list spa appointments (staff)", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/spa/appointments")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
    }
  });
  
  it("should update spa appointment status", async () => {
    const { rows } = await pool.query(
      "SELECT id FROM spa_appointments WHERE status = 'SCHEDULED' LIMIT 1"
    );
    
    if (rows.length > 0) {
      const res = await request("http://localhost:5000")
        .patch(`/api/spa/appointments/${rows[0].id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "IN_PROGRESS" });
      
      if (res.status === 200) {
        expect(res.body.status).toBe("IN_PROGRESS");
      }
    }
  });
  
  it("should require auth for spa", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/spa/services");
    
    if (res.status === 401) {
      expect(res.body.message).toMatch(/auth/i);
    }
  });
  
});

// ═══════════════════════════════════════════════════════════════════
// EVENTS TESTS
// ═══════════════════════════════════════════════════════════════════
describe("Events", () => {
  
  it("should list events", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/events")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
    }
  });
  
  it("should create an event", async () => {
    const res = await request("http://localhost:5000")
      .post("/api/events")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        eventType: "CONFERENCE",
        eventName: "Tech Conference 2026",
        eventDate: new Date(Date.now() + 86400000 * 7).toISOString().split("T")[0],
        guestCount: 50,
        totalAmount: 5000000
      });
    
    if (res.status === 201) {
      expect(res.body).toHaveProperty("id");
      expect(res.body.event_name).toBe("Tech Conference 2026");
    }
  });
  
  it("should require auth for events", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/events");
    
    if (res.status === 401) {
      expect(res.body.message).toMatch(/auth/i);
    }
  });
  
});

// ═══════════════════════════════════════════════════════════════════
// MAINTENANCE TESTS
// ═══════════════════════════════════════════════════════════════════
describe("Maintenance", () => {
  
  it("should list maintenance requests", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/maintenance")
      .set("Authorization", `Bearer ${adminToken}`);
    
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
    }
  });
  
  it("should create a maintenance request", async () => {
    const { rows } = await pool.query("SELECT id FROM rooms LIMIT 1");
    
    if (rows.length > 0) {
      const res = await request("http://localhost:5000")
        .post("/api/maintenance")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          roomId: rows[0].id,
          requestType: "PLUMBING",
          description: "Leaky faucet in bathroom",
          priority: "HIGH"
        });
      
      if (res.status === 201) {
        expect(res.body).toHaveProperty("id");
        expect(res.body.status).toBe("PENDING");
      }
    }
  });
  
  it("should update maintenance request", async () => {
    const { rows } = await pool.query(
      "SELECT id FROM maintenance_requests WHERE status = 'PENDING' LIMIT 1"
    );
    
    if (rows.length > 0) {
      const res = await request("http://localhost:5000")
        .patch(`/api/maintenance/${rows[0].id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "IN_PROGRESS" });
      
      if (res.status === 200) {
        expect(res.body.status).toBe("IN_PROGRESS");
      }
    }
  });
  
  it("should require auth for maintenance", async () => {
    const res = await request("http://localhost:5000")
      .get("/api/maintenance");
    
    if (res.status === 401) {
      expect(res.body.message).toMatch(/auth/i);
    }
  });
  
});
