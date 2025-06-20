import express from "express";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import multer from "multer";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import User from "../models/User";
import dotenv from "dotenv";
import Token from "../models/Token";
import { sendConfirmationMail } from "../util/SendMail";
import authMiddleware from "../middleware/auth.middleware";
import Job from "../models/Job";
import JobApplication from "../models/JobApplication";
import Visa from "../models/Visa";
import VisaApplication from "../models/VisaApplication";
import { transport } from "../util/nodemailer";
dotenv.config()
const router = express.Router();

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

type registerProps = {
    userName: string,
    firstName: string,
    lastName: string;
    phone: string;
    email: string;
    nationality: string;
    password: string;
}

type loginProps = {
    email: string,
    password: string
}
const secretKey = String(process.env.JWT_PRIVATE_KEY);

//storage for file upload in memory storage
const storage = multer.memoryStorage();
const randomFileName = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

const upload = multer({ storage: storage });

//user registration
router.post('/register', async (req: Request<registerProps>, res: any) => {
    try {
        const { userName, firstName, lastName, phone, email, nationality, password } = req.body;

        // Check if email exists
        const existingEmail = await User.findOne({ email });
        if (existingEmail) {
            return res.status(400).json({ message: "A user with this email already exists." });
        }

        // Check if username exists
        const existingUsername = await User.findOne({ userName });
        if (existingUsername) {
            return res.status(400).json({ message: "Username is already taken." });
        }

        // Hash password
        const salt = await bcrypt.genSalt(Number(process.env.SALT));
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create user
        const newUser = new User({
            userName,
            firstName,
            lastName,
            email,
            phone,
            nationality,
            passwordHash: hashedPassword,
            role: "client"
        });

        await newUser.save();

        // Create confirmation token
        const token = await new Token({
            userId: newUser._id,
            token: crypto.randomBytes(10).toString("hex")
        }).save();

        // Send confirmation email
        await sendConfirmationMail({
            userEmail: email,
            userName,
            token: token.token
        });

        res.status(201).json({ message: "Registration successful. Please verify your email." });

    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({
            message: 'An unexpected error occurred during registration. Please try again later.'
        });
    }
});


//user login
router.post('/login', async (req: Request<loginProps>, res: any) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            res.status(400).json({ message: "all fields are required" })
        }
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: "Invalid email or password" })
        }

        //checking if they are verified users
        if (!user.isVerified) {
            return res.status(403).json({ message: "Please verify your email address before logging in." });
        }
        //comparing given password
        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
            return res.status(401).json({ message: "invalid credentials" })
        }
        //generating token
        const token = jwt.sign({ id: user._id, role: user.role }, secretKey, { expiresIn: "1d" })
        res.status(201).json({
            token: token,
            role: user.role,
            name: user.firstName,
        });
    } catch (error) {
        console.error('Error logging in', error);
        res.status(500).json({ message: 'An error occured during logging in please try again later' });
    }
});

//fetching visa
router.get("/visa", async (req: Request, res: any) => {
    try {
        const visas = await Visa.find();
        if (!visas) {
            return res.status(404).json({ message: "no visas found" })
        }
        res.status(201).json(visas)
    } catch (error) {
        console.error('Error fetching visas', error);
        res.status(500).json({ message: 'An error occured during visas fetching, please try again later' });
    }
})

//contact us
router.post("/contact", async (req: Request, res: any) => {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
        return res.status(400).json({ message: "All fields are required." });
    }

    try {
        await transport.sendMail({
            from: `"${name}" <${email}>`,
            to: process.env.USER,//helenus email 
            subject: `[Contact Form] ${subject}`,
            html: `
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
      `,
        });

        res.status(201).json({ message: "Message sent successfully!" });
    } catch (err) {
        console.error("Failed to send contact form email", err);
        res.status(500).json({ message: "Failed to send message." });
    }
});

// GET /jobs - Return all jobs
router.get("/jobs", async (req: Request, res: any) => {
    try {
        const Alljobs = await Job.find().sort({ createdAt: -1 });
        if (!Alljobs) {
            return res.status(404).json({ message: "no jobs found" })
        }
        const jobsPromise = Alljobs.map(async (job) => {
            const fileKey = job.coverImage;
            const signedUrl = fileKey ? await generateSignedUrl(fileKey) : null;
            return {
                _id: job._id,
                title: job.title,
                location: job.location,
                region: job.region,
                description: job.description,
                industry: job.industry,
                requirements: job.requirements,
                employer_name: job.employer_name,
                contract_duration: job.contract_duration,
                salary: job.salary,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt,
                coverImage: signedUrl,
            }
        });
        const jobs = await Promise.all(jobsPromise)
        res.json(jobs);
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});


//job application
router.post('/job/:id', authMiddleware, upload.fields([{ name: 'cv_file', maxCount: 1 }, { name: 'passport_file', maxCount: 1 },]),
    async (req: Request, res: any) => {
        try {
            const { applicant_name, email, phone } = req.body;
            const job = await Job.findById(req.params.id);
            if (!job) {
                return res.status(404).json({ message: "specified job not found!" })
            }

            const files = req.files as { [fieldname: string]: Express.Multer.File[] };
            const cvFile = files['cv_file']?.[0];
            const passportFile = files['passport_file']?.[0];

            if (!cvFile || !passportFile) {
                return res.status(400).json({ message: "Both CV and Passport files are required." });
            }
            //random file names
            const CvName = randomFileName();
            const passportName = randomFileName();

            //sending cv and passport to s3
            await s3.send(new PutObjectCommand({
                Bucket: bucketName,
                Key: CvName,
                Body: cvFile.buffer,
                ContentType: cvFile.mimetype,
            }));

            await s3.send(new PutObjectCommand({
                Bucket: bucketName,
                Key: passportName,
                Body: passportFile.buffer,
                ContentType: passportFile.mimetype,
            }))

            const newJobApplication = new JobApplication({
                applicant_name,
                email,
                phone,
                job_id: req.params.id,
                user_id: req.user._id,
                cv_file_url: CvName,
                passport_file_url: passportName,
            })
            await newJobApplication.save();
            res.status(201).json({ message: "Job Application Successful" });
        } catch (error) {
            console.error('Error applying for the job', error);
            res.status(500).json({ message: 'An error occured during job application please try again later' });
        }
    });

//visa application
router.post('/visa/:id', authMiddleware, upload.fields([{ name: 'cv_file', maxCount: 1 }, { name: 'passport_file', maxCount: 1 },]),
    async (req: Request, res: any) => {
        try {
            const { applicant_name, email, phone } = req.body;
            const visa = await Visa.findById(req.params.id);
            if (!visa) {
                return res.status(404).json({ message: "specified visa not found!" })
            }

            const files = req.files as { [fieldname: string]: Express.Multer.File[] };
            const cvFile = files['cv_file']?.[0];
            const passportFile = files['passport_file']?.[0];

            if (!cvFile || !passportFile) {
                return res.status(400).json({ message: "Both CV and Passport files are required." });
            }
            //random file names
            const CvName = randomFileName();
            const passportName = randomFileName();

            //sending cv and passport to s3
            await s3.send(new PutObjectCommand({
                Bucket: bucketName,
                Key: CvName,
                Body: cvFile.buffer,
                ContentType: cvFile.mimetype,
            }));

            await s3.send(new PutObjectCommand({
                Bucket: bucketName,
                Key: passportName,
                Body: passportFile.buffer,
                ContentType: passportFile.mimetype,
            }))

            const newVisaApplication = new VisaApplication({
                applicant_name,
                email,
                phone,
                visa_id: req.params.id,
                user_id: req.user._id,
                cv_file_url: CvName,
                passport_file_url: passportName,
            })
            await newVisaApplication.save();
            res.status(201).json({ message: "Visa Application Successful" });
        } catch (error) {
            console.error('Error applying for the job', error);
            res.status(500).json({ message: 'An error occured during job application please try again later' });
        }
    });


//view my applications
router.get("/my-applications", authMiddleware, async (req: Request, res: any) => {
    try {
        const userId = req.user._id;

        const jobApps = await JobApplication.find({ user_id: userId }).populate("job_id").lean();
        const visaApps = await VisaApplication.find({ user_id: userId }).populate("visa_id").lean();

        // 2. Process Job Applications
        const jobPromises = jobApps.map(async (app) => {
            const fileKey = app.cv_file_url || app.passport_file_url;
            const documentUrl = fileKey ? await generateSignedUrl(fileKey) : null;

            return {
                id: app._id,
                type: "Job",
                applicantName: app.applicant_name,
                email: app.email,
                phone: app.phone,
                status: app.status.toLowerCase(),
                dateSubmitted: app.submitted_at,
                referenceNumber: app._id.toString().slice(-6),
                documentUrl,
                job: app.job_id,
            };
        });

        // 3. Process Visa Applications
        const visaPromises = visaApps.map(async (app) => {
            const fileKey = app.cv_file_url || app.passport_file_url;
            const documentUrl = fileKey ? await generateSignedUrl(fileKey) : null;

            return {
                id: app._id,
                type: "Visa",
                applicantName: app.applicant_name,
                email: app.email,
                phone: app.phone,
                status: app.status.toLowerCase(),
                dateSubmitted: app.submitted_at,
                referenceNumber: app._id.toString().slice(-6),
                documentUrl,
                visa: app.visa_id,
            };
        });

        // 4. Wait for All Promises
        const [jobs, visas] = await Promise.all([
            Promise.all(jobPromises),
            Promise.all(visaPromises),
        ]);

        // 5. Merge and Sort
        const applications = [...jobs, ...visas].sort(
            (a, b) => new Date(b.dateSubmitted).getTime() - new Date(a.dateSubmitted).getTime()
        );

        return res.status(201).json(applications);
    } catch (error) {
        console.error("Error fetching applications:", error);
        res.status(500).json({ message: "An error occurred while fetching applications. Please try again later." });
    }
});

//applicaton count for the user
router.get("/myapplication/count", authMiddleware, async (req: Request, res: any) => {
    try {
        const userId = req.user._id;
        if (!userId) {
            return res.status(200).json({ job: 0, visa: 0, total: 0 });
        }

        const jobCount = await JobApplication.countDocuments({ user: userId, type: "job" });
        const visaCount = await VisaApplication.countDocuments({ user: userId, type: "visa" });

        res.status(200).json({
            job: jobCount,
            visa: visaCount,
            total: jobCount + visaCount
        });
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch application counts." });
    }
});

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