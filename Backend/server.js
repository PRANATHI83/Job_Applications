// ... [keep existing imports]
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const libre = require('libreoffice-convert');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');

const app = express();
const port = 3811;

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

// ----[Omitted unchanged multer configs & static folders]----

// ✅ Upload offer documents
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

        // Validate application status
        const appCheck = await pool.query('SELECT status FROM applications WHERE id = $1', [applicationId]);
        if (appCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Application not found' });
        }

        const appStatus = appCheck.rows[0].status;
        console.log(`Application ${applicationId} status:`, appStatus);

        if (appStatus !== 'Accepted') {
            return res.status(403).json({ error: 'Files can only be uploaded for accepted applications' });
        }

        // 🧹 Delete previous files
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

        // 📦 Save new files
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

// ✅ Fetch uploaded files
app.get('/api/applications/:id/files', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT id, name, path, size, mime_type, uploaded_at FROM application_files WHERE application_id = $1 ORDER BY uploaded_at DESC',
            [id]
        );

        console.log(`Fetched ${result.rows.length} uploaded file(s) for application ${id}`);
        res.json(result.rows);
    } catch (error) {
        console.error('Fetch files error:', error);
        res.status(500).json({ error: 'Failed to fetch uploaded files: ' + error.message });
    }
});

// ✅ Keep all other routes unchanged...
// (PATCH, GET applications, POST application, file download, file delete, etc.)

// Start server
app.listen(port, async () => {
    try {
        await pool.connect();
        console.log(`🚀 Server running at http://13.233.84.170:${port}`);
    } catch (error) {
        console.error('Database connection failed:', error);
        process.exit(1);
    }
});
