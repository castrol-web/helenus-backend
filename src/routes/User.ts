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