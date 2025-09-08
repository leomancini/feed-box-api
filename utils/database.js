import mongoose from "mongoose";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

class Database {
  constructor() {
    this.connection = null;
  }

  async connect() {
    try {
      const mongoUri = process.env.MONGODB_URI;

      this.connection = await mongoose.connect(mongoUri, {
        // Modern MongoDB driver options
      });

      console.log("✅ Successfully connected to MongoDB");

      // Handle connection events
      mongoose.connection.on("error", (error) => {
        console.error("❌ MongoDB connection error:", error);
      });

      mongoose.connection.on("disconnected", () => {
        console.log("🔌 MongoDB disconnected");
      });

      // Graceful shutdown
      process.on("SIGINT", async () => {
        await this.disconnect();
        process.exit(0);
      });

      return this.connection;
    } catch (error) {
      console.error("❌ Failed to connect to MongoDB:", error.message);
      process.exit(1);
    }
  }

  async disconnect() {
    try {
      if (this.connection) {
        await mongoose.connection.close();
        console.log("👋 MongoDB connection closed");
      }
    } catch (error) {
      console.error("❌ Error closing MongoDB connection:", error.message);
    }
  }

  getConnection() {
    return this.connection;
  }

  isConnected() {
    return mongoose.connection.readyState === 1;
  }
}

// Create singleton instance
const database = new Database();

export default database;
export { mongoose };
