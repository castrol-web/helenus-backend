import express from "express"
import { Request } from 'express';
import Blog from "../models/Blog";
import dotenv from "dotenv";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import multer from "multer";
import crypto from "crypto";
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

//storing the image in memory storage
const storage = multer.memoryStorage();

const randomImageName = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");
//upload object for the image 
const upload = multer({ storage: storage });

// GET all blogs
router.get('/all', async (req: Request, res: any) => {
    try {
        const articles = await Blog.find().sort({ createdAt: -1 });
        if (!articles || articles.length === 0) {
            return res.status(404).json({ message: "No blog found" });
        }

        type BlogWithImage = ReturnType<typeof Blog.prototype.toObject> & { coverImage: string };
        const blogArray: BlogWithImage[] = [];

        const blogPromises = articles.map(async article => {
            const url = await generateSignedUrl(article.coverImage);
            blogArray.push({ article, coverImage: url });
        });

        await Promise.all(blogPromises);
        res.status(201).json({ blogArray });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});


// GET a single blog by slug
type SlugParams = {
    slug: string;
}

router.get('/blog/:slug', async (req: Request<SlugParams>, res: any) => {
    try {
        const article = await Blog.findOne({ slug: req.params.slug });
        if (!article) return res.status(404).json({ message: 'Article not found' });
        res.json(article);
    } catch (error) {
        res.status(400).json({ message: 'Failed to fetch blog with corresponding slug', error });
    }
});

// POST create new article
router.post('/create-blog', upload.single("coverImage"), async (req: Request, res: any) => {
    try {
        const { title, slug, content, excerpt, category, tags, author } = req.body;
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
        await s3.send(command);
        //checking unique slug
        const newBlog = new Blog({
            title,
            slug,
            content,
            excerpt,
            coverImage,
            category,
            tags,
            author,
        })
        await newBlog.save();
        res.status(201).json({ message: "Blog Added successfully", newBlog });
    } catch (error) {
        //Multer errors
        if (error instanceof multer.MulterError && error.code as string === "LIMIT_FILE_TYPES") {
            return res.status(400).json({ message: "Invalid file type.Please upload a valid image" });
        }
        console.log(error);
        res.status(500).json({ message: "Internal Server Error" });
        res.status(400).json({ message: 'Failed to create blog', error });
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
