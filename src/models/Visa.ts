import mongoose from "mongoose";

const visaSchema = new mongoose.Schema({
    visa_type: {
        type: String,
        required: true,
        enum: ['Employment', 'Student', 'Tourist', 'Work Permit'],
    },
    country: {
        type: String,
        required: true,
    },
    requirements: [{ type: String, required: true }],
    coverImage: {
        type: String,
        required:true
    },
    processing_time: {
        type: String,
    },
    fee: {
        type: Number,
    },
}, {
    timestamps: true,
});

export default mongoose.model('Visa', visaSchema);
