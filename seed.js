const mysql = require("mysql2/promise");
const faker = require("faker");

// Connect to the main database
const mainDb = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "",
    database: "main_db",
});

// List of Volkswagen car models
const volkswagenModels = [
    "Golf", "Passat", "Tiguan", "Jetta", "Touareg",
    "Polo", "Arteon", "ID.4", "ID. Buzz", "T-Roc"
];

// Function to generate 1000 records
async function seedDatabase() {
    try {
        console.log("🚗 Generating 1000 Volkswagen inventory records...");

        for (let i = 1; i <= 1000; i++) {
            const vin = `vin${String(i).padStart(3, '0')}`; // Generates VIN like vin001, vin002
            const carModel = volkswagenModels[Math.floor(Math.random() * volkswagenModels.length)];
            const partName = faker.commerce.productName();
            const quantity = faker.datatype.number({ min: 1, max: 50 });
            const price = parseFloat(faker.commerce.price(10, 500, 2)).toFixed(2);
            const discountEnabled = faker.datatype.boolean();
            const lastUpdated = faker.date.recent(30).toISOString().slice(0, 19).replace("T", " ");

            await mainDb.query(`
                INSERT INTO inventory (vin, car_model, part_name, quantity, price, discount_enabled, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [vin, carModel, partName, quantity, price, discountEnabled, lastUpdated]);
        }

        console.log("✅ Successfully inserted 1000 records into main_db.inventory!");
    } catch (err) {
        console.error("❌ Error inserting records:", err);
    } finally {
        await mainDb.end(); // Properly close the database connection
        process.exit();
    }
}

// Run the script
seedDatabase();
