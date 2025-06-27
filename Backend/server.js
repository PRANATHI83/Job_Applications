// server.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 3811;

// PostgreSQL pool
const pool = new Pool({
    user: 'postgres',
    host: 'postgres',
    database: 'job_applications',
    password: 'admin234',
    port: 5432,
});

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'Uploads')));

// Multer storage for offer documents
const offerStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            const uploadPath = path.join(__dirname, 'Uploads');
            await fs.mkdir(uploadPath, { recursive: true });
            cb(null, uploadPath);
        } catch (err) {
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${uuidv4()}`;
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});

const offerUpload = multer({
    storage: offerStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg',
            'image/jpg',
            'image/png'
        ];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF, DOCX, JPG, JPEG, and PNG files are allowed'));
        }
    }
});

// Upload offer documents
app.post('/api/applications/upload', offerUpload.array('files', 10), async (req, res) => {
    try {
        const applicationId = parseInt(req.body.applicationId, 10);
        const files = req.files;

        console.log('Received upload request for applicationId:', applicationId);

        if (!applicationId || isNaN(applicationId)) {
            return res.status(400).json({ error: 'Invalid or missing application ID' });
        }

        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const appCheck = await pool.query('SELECT status FROM applications WHERE id = $1', [applicationId]);
        if (appCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Application not found' });
        }

        if (appCheck.rows[0].status !== 'Accepted') {
            return res.status(403).json({ error: 'Files can only be uploaded for accepted applications' });
        }

        // Delete old files
        const existingFiles = await pool.query(
            'SELECT id, path FROM application_files WHERE application_id = $1',
            [applicationId]
        );
        for (const file of existingFiles.rows) {
            const localPath = path.join(__dirname, 'Uploads', path.basename(file.path));
            try {
                await fs.unlink(localPath);
            } catch (err) {
                if (err.code !== 'ENOENT') throw err;
            }
            await pool.query('DELETE FROM application_files WHERE id = $1', [file.id]);
        }

        // Save new files
        const baseUrl = `http://13.233.84.170:${port}/Uploads/`;
        const fileRecords = [];

        for (const file of files) {
            const buffer = await fs.readFile(file.path);
            const hash = crypto.createHash('sha256').update(buffer).digest('hex');
            const id = uuidv4();

            const record = {
                id,
                application_id: applicationId,
                name: file.originalname,
                path: `${baseUrl}${file.filename}`,
                size: file.size,
                mime_type: file.mimetype,
                hash
            };

            await pool.query(
                `INSERT INTO application_files (id, application_id, name, path, size, mime_type, hash)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [record.id, record.application_id, record.name, record.path, record.size, record.mime_type, record.hash]
            );

            fileRecords.push(record);
        }

        console.log(`Uploaded ${fileRecords.length} file(s) for application ${applicationId}`);
        res.status(201).json({ message: 'Files uploaded successfully', files: fileRecords });
    } catch (error) {
        console.error('Upload error:', error);
        let errorMessage = 'Failed to upload files';
        if (error.message.includes('LIMIT_FILE_SIZE')) {
            errorMessage = 'One or more files exceed the 10MB limit';
        } else if (error.message.includes('Only PDF, DOCX, JPG, JPEG, and PNG files are allowed')) {
            errorMessage = error.message;
        }
        res.status(500).json({ error: errorMessage });
    }
});

// Start server
app.listen(port, async () => {
    try {
        await pool.connect();
        console.log(`✅ Server running at http://13.233.84.170:${port}`);
    } catch (err) {
        console.error('❌ Database connection failed:', err);
        process.exit(1);
    }
});
