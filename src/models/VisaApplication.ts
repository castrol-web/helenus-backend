import mongoose from "mongoose";

const applicationSchema = new mongoose.Schema({
  applicant_name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  phone: {
    type: String,
    required: true,
  },
  visa_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Visa',
  },
  cv_file_url: {
    type: String,
  },
  passport_file_url: {
    type: String,
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending',
  },
  submitted_at: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

export default mongoose.model('VisaApplication', applicationSchema);
