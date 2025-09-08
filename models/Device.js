import { mongoose } from "../utils/database.js";

const deviceSchema = new mongoose.Schema(
  {
    serialNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    name: {
      type: String,
      required: false,
      trim: true
    },
    source: {
      type: String,
      required: true,
      enum: ["headlines", "sports", "wikipedia", "sample"] // Based on existing sources
    },
    timezone: {
      type: String,
      required: true,
      default: "UTC"
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false // Allow devices to exist without an owner initially
    },
    // Configuration settings
    settings: {
      maxCharacters: {
        type: Number,
        default: null // Will use global config if null
      },
      maxStrings: {
        type: Number,
        default: null // Will use global config if null
      },
      refreshInterval: {
        type: Number,
        default: null // Will use source default if null
      }
    }
  },
  {
    timestamps: true // Adds createdAt and updatedAt
  }
);

// Indexes for faster queries
deviceSchema.index({ serialNumber: 1 }, { unique: true });
deviceSchema.index({ owner: 1 });
deviceSchema.index({ source: 1 });

// Instance methods

deviceSchema.methods.updateSource = function (newSource) {
  this.source = newSource;
  return this.save();
};

deviceSchema.methods.updateTimezone = function (newTimezone) {
  this.timezone = newTimezone;
  return this.save();
};

// Static methods
deviceSchema.statics.findBySerialNumber = function (serialNumber) {
  return this.findOne({ serialNumber: serialNumber.toUpperCase() }).populate(
    "owner"
  );
};

deviceSchema.statics.findByOwner = function (ownerId) {
  return this.find({ owner: ownerId }).populate("owner");
};

deviceSchema.statics.getDeviceStats = function () {
  return this.aggregate([
    {
      $group: {
        _id: "$source",
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

// Pre-save middleware
deviceSchema.pre("save", function (next) {
  // Ensure serial number is uppercase
  if (this.serialNumber) {
    this.serialNumber = this.serialNumber.toUpperCase();
  }
  next();
});

// Pre-remove middleware to clean up user references
deviceSchema.pre(
  "deleteOne",
  { document: true, query: false },
  async function (next) {
    try {
      // Remove this device from the owner's devices array
      const User = mongoose.model("User");
      await User.updateOne(
        { _id: this.owner },
        { $pull: { devices: this._id } }
      );
      next();
    } catch (error) {
      next(error);
    }
  }
);

const Device = mongoose.model("Device", deviceSchema);

export default Device;
