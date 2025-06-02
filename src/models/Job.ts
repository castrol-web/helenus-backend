import mongoose from "mongoose";

const jobSchema = new mongoose.Schema({
  title: { type: String, required: true },
  location: { type: String, required: true },
  coverImage: { type: String, required: true },
  region: { type: String, enum: ['Africa', 'Asia', 'Europe', 'Gulf'], required: true },
  description: { type: String, required: true },
  industry: { type: String, required: true },
  requirements: [{ type: String, required: true }],
  employer_name: { type: String },
  contract_duration: { type: String },
  salary: { type: Number },
}, { timestamps: true });

export default mongoose.model('Job', jobSchema);
