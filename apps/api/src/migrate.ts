import { PostgresDatabase } from "./database.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = new PostgresDatabase(process.env.DATABASE_URL);
try {
  await db.migrate();
  console.log("Orbit database migrations applied.");
} finally {
  await db.close();
}
