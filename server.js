const express = require("express");
const mysql = require("mysql2/promise");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Allow all origins (for testing, restrict in production)
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json()); // Middleware to parse JSON requests

const WEBHOOK_SECRET = "test"; // Replace with a secure key

// Connect to the primary database (main_db)
const mainDb = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "",
    database: "main_db",
});

// Connect to the backup database (backup_db)
const backupDb = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "",
    database: "backup_db",
});

// Function to sync Volkswagen car inventory
async function syncInventory() {
    try {
        console.log("🔍 Checking for Volkswagen inventory updates...");

        // Get new or updated Volkswagen parts from main_db
        const [rows] = await mainDb.query(`
            SELECT * FROM inventory 
            WHERE last_updated > (SELECT COALESCE(MAX(last_updated), '2000-01-01') FROM backup_db.inventory_backup)
        `);

        if (rows.length > 0) {
            console.log(`🚗 Found ${rows.length} new/updated Volkswagen parts. Syncing...`);

            for (const row of rows) {
                // Check if the part exists in backup_db using VIN
                const [existing] = await backupDb.query("SELECT vin FROM inventory_backup WHERE vin = ?", [row.vin]);

                if (existing.length > 0) {
                    // Update existing record
                    await backupDb.query(`
                        UPDATE inventory_backup 
                        SET car_model = ?, part_name = ?, quantity = ?, price = ?, discount_enabled = ?, last_updated = ? 
                        WHERE vin = ?`,
                        [row.car_model, row.part_name, row.quantity, row.price, row.discount_enabled, row.last_updated, row.vin]
                    );
                } else {
                    // Insert new record
                    await backupDb.query(`
                        INSERT INTO inventory_backup (vin, car_model, part_name, quantity, price, discount_enabled, last_updated)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [row.vin, row.car_model, row.part_name, row.quantity, row.price, row.discount_enabled, row.last_updated]
                    );
                }

                // Notify connected clients
                io.emit("inventory_update", row);
            }

            console.log("✅ Sync completed.");
        } else {
            console.log("📭 No new Volkswagen parts updates.");
        }
    } catch (err) {
        console.error("❌ Sync error:", err);
    }
}

// Sync every 5 seconds
setInterval(syncInventory, 5000);

// Webhook to update stock quantity
app.post("/webhook/update-stock", async (req, res) => {
    const { vin, quantity } = req.body;
    const secret = req.headers["x-webhook-secret"];

    if (secret !== WEBHOOK_SECRET) {
        return res.status(403).json({ error: "Unauthorized webhook request" });
    }

    if (!vin || quantity == null) {
        return res.status(400).json({ error: "VIN and quantity are required" });
    }

    try {
        const [result] = await mainDb.query("UPDATE inventory SET quantity = ? WHERE vin = ?", [quantity, vin]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "VIN not found" });
        }

        console.log(`📦 Stock updated for VIN: ${vin}, new quantity: ${quantity}`);
        io.emit("stock_update", { vin, quantity });

        res.json({ success: true, message: "Stock updated successfully" });
    } catch (err) {
        console.error("❌ Error updating stock:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Webhook to update discount status
app.post("/webhook/update-offer", async (req, res) => {
    const { vin, discount_enabled } = req.body;
    const secret = req.headers["x-webhook-secret"];

    if (secret !== WEBHOOK_SECRET) {
        return res.status(403).json({ error: "Unauthorized webhook request" });
    }

    if (!vin || discount_enabled == null) {
        return res.status(400).json({ error: "VIN and discount_enabled are required" });
    }

    try {
        const [result] = await mainDb.query("UPDATE inventory SET discount_enabled = ? WHERE vin = ?", [discount_enabled, vin]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "VIN not found" });
        }

        console.log(`🏷️ Offer updated for VIN: ${vin}, discount enabled: ${discount_enabled}`);
        io.emit("offer_update", { vin, discount_enabled });

        res.json({ success: true, message: "Offer updated successfully" });
    } catch (err) {
        console.error("❌ Error updating offer:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// WebSocket setup
io.on("connection", (socket) => {
    console.log("📡 Client connected for Volkswagen inventory updates.");
    socket.on("disconnect", () => console.log("📴 Client disconnected."));
});

server.listen(3006, () => console.log("🚀 Sync server running on port 3006"));
