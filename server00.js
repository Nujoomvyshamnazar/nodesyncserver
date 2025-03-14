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

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

const WEBHOOK_SECRET = "your_secret_key"; // Change this to a secure secret key

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
                // Check if the part exists in backup_db
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

// Webhook security middleware
const verifyWebhook = (req, res, next) => {
    const receivedSecret = req.headers["x-webhook-secret"];
    if (receivedSecret !== WEBHOOK_SECRET) {
        return res.status(403).json({ success: false, message: "Unauthorized webhook request." });
    }
    next();
};

// Webhook: Update Stock Quantity
app.post("/webhook/update-stock", verifyWebhook, async (req, res) => {
    try {
        const { vin, quantity } = req.body;

        if (!vin || quantity === undefined) {
            return res.status(400).json({ success: false, message: "Missing VIN or quantity." });
        }

        console.log(`📦 Webhook: Updating stock for ${vin} → ${quantity}`);

        await mainDb.query("UPDATE inventory SET quantity = ? WHERE vin = ?", [quantity, vin]);
        await backupDb.query("UPDATE inventory_backup SET quantity = ? WHERE vin = ?", [quantity, vin]);

        io.emit("inventory_update", { vin, quantity });

        console.log(`✅ Stock updated for ${vin}: ${quantity}`);
        res.json({ success: true, message: "Stock updated successfully." });

    } catch (error) {
        console.error("❌ Stock update webhook failed:", error);
        res.status(500).json({ success: false, message: "Stock update failed." });
    }
});

// Webhook: Update Offer/Discount Status
app.post("/webhook/update-offer", verifyWebhook, async (req, res) => {
    try {
        const { vin, discount_enabled } = req.body;

        if (!vin || discount_enabled === undefined) {
            return res.status(400).json({ success: false, message: "Missing VIN or discount status." });
        }

        console.log(`🏷️ Webhook: Updating offer for ${vin} → ${discount_enabled ? "Enabled" : "Disabled"}`);

        await mainDb.query("UPDATE inventory SET discount_enabled = ? WHERE vin = ?", [discount_enabled, vin]);
        await backupDb.query("UPDATE inventory_backup SET discount_enabled = ? WHERE vin = ?", [discount_enabled, vin]);

        io.emit("inventory_update", { vin, discount_enabled });

        console.log(`✅ Offer updated for ${vin}: ${discount_enabled ? "Enabled" : "Disabled"}`);
        res.json({ success: true, message: "Offer updated successfully." });

    } catch (error) {
        console.error("❌ Offer update webhook failed:", error);
        res.status(500).json({ success: false, message: "Offer update failed." });
    }
});

// WebSocket setup
io.on("connection", (socket) => {
    console.log("📡 Client connected for Volkswagen inventory updates.");
    socket.on("disconnect", () => console.log("📴 Client disconnected."));
});

server.listen(3006, () => console.log("🚀 Sync server running on port 3006"));
