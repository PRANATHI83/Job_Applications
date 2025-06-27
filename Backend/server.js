const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const port = 3811;

// ─── PostgreSQL Pool ──────────────────────────────
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'job_applications',
    password: process.env.DB_PASSWORD || 'admin234',
    port: process.env.DB_PORT || 5432,
});

// ─── Middleware ───────────────────────────────────
app.use(cors());
app.use(express.json());
app.use('/Uploads', express.static(path.join(__dirname, 'Uploads')));

// ─── File Upload Setup ────────────────────────────
const uploadsDir = path.join(__dirname, 'Uploads');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});

const offerUpload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'];
        if (!allowed.includes(file.mimetype)) {
            return cb(new Error('Only PDF, DOCX, JPG, JPEG, and PNG files are allowed'));
        }
        cb(null, true);
    }
});

// ─── Upload Endpoint ──────────────────────────────
app.post('/api/applications/upload', offerUpload.array('files', 10), async (req, res) => {
    try {
        const applicationId = parseInt(req.body.applicationId, 10);
        const files = req.files;

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

        const appStatus = appCheck.rows[0].status;
        if (appStatus !== 'Accepted') {
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

        // Insert new files
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

// ─── Server Listen ────────────────────────────────
app.listen(port, () => {
    console.log(`Server running on http://13.233.84.170:${port}`);
});
