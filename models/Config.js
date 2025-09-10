import { mongoose } from "../utils/database.js";

const configSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true
    },
    value: {
      type: mongoose.Schema.Types.Mixed, // Allows any type (object, string, number, etc.)
      required: true
    },
    description: {
      type: String,
      default: ""
    },
    category: {
      type: String,
      enum: ["screens", "cache", "general", "sources", "system"],
      default: "general"
    },
    active: {
      type: Boolean,
      default: true
    },
    // Validation rules for the config value
    validation: {
      type: {
        type: String,
        enum: ["string", "number", "boolean", "object", "array"],
        default: "string"
      },
      required: {
        type: Boolean,
        default: true
      },
      min: Number,
      max: Number,
      options: [String] // For enum-like validation
    },
    // Metadata
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Indexes
configSchema.index({ key: 1 }, { unique: true });
configSchema.index({ category: 1 });
configSchema.index({ active: 1 });

// Static methods
configSchema.statics.getByKey = function (key) {
  return this.findOne({ key, active: true });
};

configSchema.statics.getByCategory = function (category) {
  return this.find({ category, active: true }).sort({ key: 1 });
};

configSchema.statics.getAllActive = function () {
  return this.find({ active: true }).sort({ category: 1, key: 1 });
};

configSchema.statics.getGlobalConfig = async function () {
  const configs = await this.find({ active: true });
  const globalConfig = {};

  configs.forEach((config) => {
    // Create nested object structure based on key
    const keys = config.key.split(".");
    let current = globalConfig;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = config.value;
  });

  return globalConfig;
};

configSchema.statics.setConfig = async function (key, value, options = {}) {
  const { description, category, validation, updatedBy } = options;

  const config = await this.findOneAndUpdate(
    { key },
    {
      value,
      ...(description !== undefined && { description }),
      ...(category !== undefined && { category }),
      ...(validation !== undefined && { validation }),
      ...(updatedBy !== undefined && { updatedBy }),
      active: true
    },
    {
      upsert: true,
      new: true,
      runValidators: true
    }
  );

  return config;
};

// Instance methods
configSchema.methods.validateConfig = function () {
  const { validation, value } = this;

  if (!validation) return true;

  // Type validation
  if (validation.type) {
    const actualType = Array.isArray(value) ? "array" : typeof value;
    if (actualType !== validation.type) {
      throw new Error(
        `Config ${this.key} must be of type ${validation.type}, got ${actualType}`
      );
    }
  }

  // Number range validation
  if (validation.type === "number") {
    if (validation.min !== undefined && value < validation.min) {
      throw new Error(`Config ${this.key} must be at least ${validation.min}`);
    }
    if (validation.max !== undefined && value > validation.max) {
      throw new Error(`Config ${this.key} must be at most ${validation.max}`);
    }
  }

  // Options validation (enum-like)
  if (validation.options && validation.options.length > 0) {
    if (!validation.options.includes(value)) {
      throw new Error(
        `Config ${this.key} must be one of: ${validation.options.join(", ")}`
      );
    }
  }

  return true;
};

// Pre-save middleware
configSchema.pre("save", function (next) {
  try {
    this.validateConfig();
    next();
  } catch (error) {
    next(error);
  }
});

const Config = mongoose.model("Config", configSchema, "config");

export default Config;
