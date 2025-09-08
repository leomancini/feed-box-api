import { mongoose } from "../utils/database.js";

const userSchema = new mongoose.Schema(
  {
    googleId: {
      type: String
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    picture: {
      type: String,
      default: null
    },
    isActive: {
      type: Boolean,
      default: true
    },
    lastLogin: {
      type: Date,
      default: Date.now
    },
    // Role-based access control
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user"
    },
    // Track devices owned by this user
    devices: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Device"
      }
    ]
  },
  {
    timestamps: true // Adds createdAt and updatedAt
  }
);

// Index for faster queries
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });

// Virtual for device count
userSchema.virtual("deviceCount", {
  ref: "Device",
  localField: "_id",
  foreignField: "owner",
  count: true
});

// Ensure virtual fields are serialized
userSchema.set("toJSON", { virtuals: true });

// Instance methods
userSchema.methods.updateLastLogin = function () {
  this.lastLogin = new Date();
  return this.save();
};

userSchema.methods.addDevice = function (deviceId) {
  if (!this.devices.includes(deviceId)) {
    this.devices.push(deviceId);
    return this.save();
  }
  return Promise.resolve(this);
};

userSchema.methods.removeDevice = function (deviceId) {
  this.devices = this.devices.filter((id) => !id.equals(deviceId));
  return this.save();
};

// Static methods
userSchema.statics.findByGoogleId = function (googleId) {
  return this.findOne({ googleId }).populate("devices");
};

userSchema.statics.findByEmail = function (email) {
  return this.findOne({ email: email.toLowerCase() }).populate("devices");
};

const User = mongoose.model("User", userSchema);

export default User;
