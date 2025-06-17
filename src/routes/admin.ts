import express from "express";
import { Request } from 'express';
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import multer from "multer";
import crypto from "crypto";
import User from "../models/User";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import Job from "../models/Job";
import Visa from "../models/Visa";
import VisaApplication from "../models/VisaApplication";
import JobApplication from "../models/JobApplication";
dotenv.config();
const router = express.Router();

const adminPassword = process.env.ADMIN_PASSWORD;

//s3 credentials
const accessKey = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const region = process.env.AWS_REGION;
const bucketName = process.env.AWS_BUCKET_NAME;
if (!accessKey || !secretAccessKey || !region || !bucketName) {
    throw new Error("all S3 credentials are required")
}

//s3 object
const s3 = new S3Client({
    credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretAccessKey
    },
    region: region
});


//creating sudo admin
const sudoAdmin = async () => {
    try {
        const admin = await User.findOne({ email: "admin@example.com" });
        if (admin) {
            console.log("Admin user already exists")
            return;
        }
        //hashing the password
        const salt = await bcrypt.genSalt(Number(process.env.SALT) || 10);
        const hashedPassword = await bcrypt.hash(adminPassword || "adminpassword", salt);
        const newAdmin = new User({
            userName: "admin",
            email: "admin@example.com",
            phone: "0790792533",
            passwordHash: hashedPassword,
            role: "admin",
            isVerified: true
        });
        await newAdmin.save();
        console.log("Admin user created successfully");
    } catch (error) {
        console.error('Error seeding admin user:', error);
    }
}

sudoAdmin();

const storage = multer.memoryStorage();
const upload = multer({ storage });
const randomImageName = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");

//adding a job
router.post("/addjob", upload.single("coverImage"), async (req: Request, res: any) => {
    try {
        const { title, location, region, description, industry, requirements, employer_name, contract_duration, salary } = req.body;
        const coverImage = randomImageName();
        if (!req.file || !req.file.buffer) {
            return res.status(404).json({ message: "cover photo not uploaded" });
        }
        // s3 params
        const params = {
            Bucket: bucketName,
            Key: coverImage,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
        }
        const command = new PutObjectCommand(params);
        await s3.send(command)
        const newJob = new Job({
            title,
            location,
            region,
            description,
            industry,
            requirements,
            employer_name,
            contract_duration,
            salary,
            coverImage
        })

        await newJob.save()
        res.status(201).json({ message: "Job successful added" })
    } catch (error) {
        //Multer errors
        if (error instanceof multer.MulterError && error.code as string === "LIMIT_FILE_TYPES") {
            return res.status(400).json({ message: "Invalid file type.Please upload a valid image" });
        }
        console.log(error);
        res.status(500).json({ message: "Internal Server Error" });
        res.status(400).json({ message: 'Failed to add job', error });
    }
})

// Helper to fetch all visa + job applications combined
router.get('/applications', async (req, res) => {
    try {
        const [visaApps, jobApps] = await Promise.all([
            VisaApplication.find().populate('visa_id user_id').sort({ submitted_at: -1 }),
            JobApplication.find().populate('job_id user_id').sort({ submitted_at: -1 }),
        ]);

        const visaWithType = await Promise.all(
            visaApps.map(async (app) => {
                const appObj = app.toObject() as any; // or use an interface below
                appObj.type = 'visa';

                if (app.cv_file_url) {
                    appObj.cv_file_url = await generateSignedUrl(app.cv_file_url);
                }

                if (app.passport_file_url) {
                    appObj.passport_file_url = await generateSignedUrl(app.passport_file_url);
                }

                return appObj;
            })
        );

        const jobWithType = await Promise.all(
            jobApps.map(async (app) => {
                const appObj = app.toObject() as any;
                appObj.type = 'job';

                if (app.cv_file_url) {
                    appObj.cv_file_url = await generateSignedUrl(app.cv_file_url);
                }

                if (app.passport_file_url) {
                    appObj.passport_file_url = await generateSignedUrl(app.passport_file_url);
                }

                return appObj;
            })
        );

        const combined = [...visaWithType, ...jobWithType].sort(
            (a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
        );

        res.json(combined);
    } catch (error) {
        console.error('Error fetching applications:', error);
        res.status(500).json({ message: 'Server error' });
    }
});



// Approve/Reject application by type and id
router.patch('/application/:type/:id', async (req: Request, res: any) => {
    const { type, id } = req.params;
    const { status } = req.body;

    if (!['visa', 'job'].includes(type)) {
        return res.status(400).json({ message: 'Invalid application type' });
    }

    if (!['Pending', 'Approved', 'Rejected'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status value' });
    }

    try {
        let updatedApp;
        if (type === 'visa') {
            updatedApp = await VisaApplication.findByIdAndUpdate(
                id,
                { status },
                { new: true }
            );
        } else {
            updatedApp = await JobApplication.findByIdAndUpdate(
                id,
                { status },
                { new: true }
            );
        }

        if (!updatedApp) {
            return res.status(404).json({ message: 'Application not found' });
        }

        res.json(updatedApp);
    } catch (error) {
        console.error('Error updating application:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post("/addVisa", upload.single("coverImage"), async (req: Request, res: any) => {
    try {
        const { visa_type, country, requirements, processing_time, fee } = req.body;
        const coverImage = randomImageName();
        if (!req.file || !req.file.buffer) {
            return res.status(404).json({ message: "cover photo not uploaded" });
        }
        // s3 params
        const params = {
            Bucket: bucketName,
            Key: coverImage,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
        }
        const command = new PutObjectCommand(params);
        await s3.send(command)
        const newVisa = new Visa({
            visa_type,
            country,
            requirements,
            processing_time,
            fee,
            coverImage
        })

        await newVisa.save()
        res.status(201).json({ message: "Visa successful added" })
    } catch (error) {
        //Multer errors
        if (error instanceof multer.MulterError && error.code as string === "LIMIT_FILE_TYPES") {
            return res.status(400).json({ message: "Invalid file type.Please upload a valid image" });
        }
        console.log(error);
        res.status(500).json({ message: "Internal Server Error" });
        res.status(400).json({ message: 'Failed to add visa', error });
    }
})


async function generateSignedUrl(coverImage?: string | null): Promise<string> {
    if (!coverImage) {
        throw new Error("Invalid image key provided")
    }
    const getObjectParams = {
        Bucket: bucketName,
        Key: coverImage,
    }

    const command = new GetObjectCommand(getObjectParams);
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
    return url;
}

export default router;

