import mongoose from "mongoose";

const BlogSchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug: { type: String, unique: true },
  content: { type: String, required: true },
  excerpt: String,
  coverImage: String,
  category: { type: String, enum: ["visa", "jobs", "tips", "stories"], required: true },
  tags: [String],
  author: {
    name: String,
    avatar: String,
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("Blog", BlogSchema);
