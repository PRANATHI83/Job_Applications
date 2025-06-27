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

// PostgreSQL configuration
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

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'Uploads')));

// Configure multer for application document uploads (2MB limit)
const applicationStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            const uploadPath = path.join(__dirname, 'Uploads');
            await fs.mkdir(uploadPath, { recursive: true });
            cb(null, uploadPath);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${uuidv4()}`;
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});

const applicationUpload = multer({
    storage: applicationStorage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
    fileFilter: (req, file, cb) => {
        const fileTypes = /pdf|jpeg|jpg|png/;
        const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = fileTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only PDF, JPG, JPEG, and PNG files are allowed!'));
        }
    }
});

// Configure multer for offer document uploads (10MB limit)
const offerStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            const uploadPath = path.join(__dirname, 'Uploads');
            await fs.mkdir(uploadPath, { recursive: true });
            cb(null, uploadPath);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${uuidv4()}`;
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});

const offerUpload = multer({
    storage: offerStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = [
            'application/pdf',
            'image/jpeg',
            'image/jpg',
            'image/png',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // DOCX
        ];
        if (allowedMimeTypes.includes(file.mimetype)) {
            return cb(null, true);
        } else {
            cb(new Error('Only PDF, DOCX, JPG, JPEG, and PNG files are allowed!'));
        }
    }
});

// Serve Frontend, HR, and RetrieveOffer static files
app.use('/frontend', express.static(path.join(__dirname, '../Frontend')));
app.use('/hr', express.static(path.join(__dirname, '../HR')));
app.use('/retrieve-offer', express.static(path.join(__dirname, '../RetrieveOffer')));
app.get('/retrieve-offer', (req, res) => {
    res.sendFile(path.join(__dirname, '../RetrieveOffer/retrieve-offer.html'));
});

// Submit application
app.post('/api/applications', applicationUpload.fields([
    { name: 'resume', maxCount: 1 },
    { name: 'idProof', maxCount: 1 },
    { name: 'sscDocs', maxCount: 10 },
    { name: 'interDocs', maxCount: 10 },
    { name: 'qualificationDocs', maxCount: 10 },
    { name: 'certificates', maxCount: 10 }
]), async (req, res) => {
    try {
        const { personalInfo, workExperience, documents } = req.body;
        const files = req.files;

        if (!personalInfo || !workExperience || !documents) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const formData = {
            personalInfo: JSON.parse(personalInfo),
            education: {
                ssc: { documents: [] },
                intermediate: { documents: [] },
                qualificationDocuments: []
            },
            workExperience: JSON.parse(workExperience),
            documents: {
                resume: null,
                idProof: null,
                certificates: [],
                currentLocation: JSON.parse(documents).currentLocation,
                preferredLocation: JSON.parse(documents).preferredLocation
            },
            date: new Date().toISOString(),
            status: 'Pending'
        };

        const baseUrl = `http://54.159.175.17:${port}/Uploads/`;
        if (files.resume) {
            formData.documents.resume = {
                name: files.resume[0].originalname,
                path: `${baseUrl}${files.resume[0].filename}`
            };
        }
        if (files.idProof) {
            formData.documents.idProof = {
                name: files.idProof[0].originalname,
                path: `${baseUrl}${files.idProof[0].filename}`
            };
        }
        if (files.sscDocs) {
            formData.education.ssc.documents = files.sscDocs.map(file => ({
                name: file.originalname,
                path: `${baseUrl}${file.filename}`
            }));
        }
        if (files.interDocs) {
            formData.education.intermediate.documents = files.interDocs.map(file => ({
                name: file.originalname,
                path: `${baseUrl}${file.filename}`
            }));
        }
        if (files.qualificationDocs) {
            formData.education.qualificationDocuments = files.qualificationDocs.map(file => ({
                name: file.originalname,
                path: `${baseUrl}${file.filename}`
            }));
        }
        if (files.certificates) {
            formData.documents.certificates = files.certificates.map(file => ({
                name: file.originalname,
                path: `${baseUrl}${file.filename}`
            }));
        }

        const result = await pool.query(
            'INSERT INTO applications (personal_info, education, work_experience, documents, date, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [formData.personalInfo, formData.education, formData.workExperience, formData.documents, formData.date, formData.status]
        );

        res.status(201).json({ message: 'Application submitted successfully', id: result.rows[0].id });
    } catch (error) {
        console.error('Error submitting application:', error);
        let errorMessage = 'Failed to submit application';
        if (error.message.includes('LIMIT_FILE_SIZE')) {
            errorMessage = 'One or more files exceed the 2MB limit';
        } else if (error.message.includes('Only PDF, JPG, JPEG, and PNG files are allowed')) {
            errorMessage = error.message;
        } else if (error.code === '23505') {
            errorMessage = 'Duplicate application detected';
        }
        res.status(500).json({ error: errorMessage });
    }
});

// Get all applications with optional search and status filter
app.get('/api/applications', async (req, res) => {
    try {
        const { search, status, page = 1, limit = 10 } = req.query;
        console.log('Received query params:', { search, status, page, limit });
        const offset = (page - 1) * limit;
        let query = 'SELECT * FROM applications';
        const queryParams = [];

        let conditions = [];
        if (search) {
            console.log('Processing search query:', search);
            const searchTerms = search.trim().split(/\s+/);
            console.log('Raw search terms:', searchTerms);

            let name = null;
            let email = null;
            let currentTerm = '';
            for (const term of searchTerms) {
                if (term.startsWith('name:')) {
                    currentTerm = 'name';
                    name = term.replace('name:', '').trim();
                } else if (term.startsWith('email:')) {
                    currentTerm = 'email';
                    email = term.replace('email:', '').trim();
                } else if (currentTerm === 'name') {
                    name += ` ${term}`;
                } else if (currentTerm === 'email') {
                    email += ` ${term}`;
                }
            }

            if (name && email) {
                conditions.push(
                    `(personal_info->>'name' ILIKE $${queryParams.length + 1} AND ` +
                    `personal_info->>'email' ILIKE $${queryParams.length + 2})`
                );
                queryParams.push(`%${name.trim()}%`, `%${email.trim()}%`);
                console.log('Searching for name and email:', { name: name.trim(), email: email.trim() });
            } else if (name) {
                conditions.push(`personal_info->>'name' ILIKE $${queryParams.length + 1}`);
                queryParams.push(`%${name.trim()}%`);
                console.log('Searching for name:', name.trim());
            } else if (email) {
                conditions.push(`personal_info->>'email' ILIKE $${queryParams.length + 1}`);
                queryParams.push(`%${email.trim()}%`);
                console.log('Searching for email:', email.trim());
            } else if (search.startsWith('id:')) {
                const id = search.split(':')[1].trim();
                conditions.push(`id = $${queryParams.length + 1}`);
                queryParams.push(parseInt(id));
                console.log('Searching for id:', id);
            } else {
                conditions.push(
                    `(personal_info->>'name' ILIKE $${queryParams.length + 1} OR ` +
                    `personal_info->>'email' ILIKE $${queryParams.length + 1} OR ` +
                    `personal_info->>'phone' ILIKE $${queryParams.length + 1})`
                );
                queryParams.push(`%${search}%`);
                console.log('General search:', search);
            }
        }
        if (status && status !== 'all') {
            conditions.push(`status = $${queryParams.length + 1}`);
            queryParams.push(status);
            console.log('Filtering by status:', status);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY date DESC LIMIT $' + (queryParams.length + 1) + ' OFFSET $' + (queryParams.length + 2);
        queryParams.push(parseInt(limit), parseInt(offset));
        console.log('Executing SQL query:', query, 'with params:', queryParams);

        const result = await pool.query(query, queryParams);
        const totalResult = await pool.query(
            'SELECT COUNT(*) FROM applications' + (conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : ''),
            queryParams.slice(0, queryParams.length - 2)
        );

        console.log('Query result:', { applications: result.rows.length, total: parseInt(totalResult.rows[0].count) });
        res.json({ applications: result.rows, total: parseInt(totalResult.rows[0].count) });
    } catch (error) {
        console.error('Error fetching applications:', error);
        res.status(500).json({ error: 'Failed to fetch applications: ' + error.message });
    }
});

// Update application status
app.patch('/api/applications/:id', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!['Accepted', 'Rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        const result = await pool.query(
            'UPDATE applications SET status = $1, date = $2 WHERE id = $3 RETURNING *',
            [status, new Date().toISOString(), id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Application not found' });
        }

        res.json({ message: `Application ${status.toLowerCase()} successfully`, application: result.rows[0] });
    } catch (error) {
        console.error('Error updating application:', error);
        res.status(500).json({ error: 'Failed to update application: ' + error.message });
    }
});

// Upload offer documents
app.post('/api/applications/upload', offerUpload.array('files', 10), async (req, res) => {
    try {
        const { applicationId } = req.body;
        const files = req.files;

        if (!applicationId) {
            return res.status(400).json({ error: 'Application ID is required' });
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

        const existingFilesResult = await pool.query(
            'SELECT id, path FROM application_files WHERE application_id = $1',
            [applicationId]
        );
        for (const file of existingFilesResult.rows) {
            const localPath = path.join(__dirname, 'Uploads', path.basename(file.path));
            try {
                await fs.unlink(localPath);
            } catch (fsError) {
                if (fsError.code !== 'ENOENT') {
                    throw fsError;
                }
            }
            await pool.query('DELETE FROM application_files WHERE id = $1', [file.id]);
        }

        const baseUrl = `http://54.159.175.17:${port}/Uploads/`;
        const fileRecords = [];

        for (const file of files) {
            const fileBuffer = await fs.readFile(file.path);
            const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

            const fileId = uuidv4();
            const fileRecord = {
                id: fileId,
                application_id: parseInt(applicationId),
                name: file.originalname,
                path: `${baseUrl}${file.filename}`,
                size: file.size,
                mime_type: file.mimetype,
                hash: hash
            };

            await pool.query(
                'INSERT INTO application_files (id, application_id, name, path, size, mime_type, hash) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [fileId, fileRecord.application_id, fileRecord.name, fileRecord.path, fileRecord.size, fileRecord.mime_type, fileRecord.hash]
            );

            fileRecords.push(fileRecord);
        }

        res.status(201).json({ message: 'Files uploaded successfully', files: fileRecords });
    } catch (error) {
        console.error('Error uploading files:', error);
        let errorMessage = 'Failed to upload files';
        if (error.message.includes('LIMIT_FILE_SIZE')) {
            errorMessage = 'One or more files exceed the 10MB limit';
        } else if (error.message.includes('Only PDF, DOCX, JPG, JPEG, and PNG files are allowed')) {
            errorMessage = error.message;
        }
        res.status(500).json({ error: errorMessage });
    }
});

// Get uploaded offer documents for an application
app.get('/api/applications/:id/files', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT id, name, path, size, mime_type, uploaded_at FROM application_files WHERE application_id = $1 ORDER BY uploaded_at DESC',
            [id]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching uploaded files:', error);
        res.status(500).json({ error: 'Failed to fetch uploaded files: ' + error.message });
    }
});

// Download offer document as PDF
app.get('/api/applications/:id/files/:fileId/download', async (req, res) => {
    try {
        const { id, fileId } = req.params;

        // Fetch file details
        const fileResult = await pool.query(
            'SELECT name, path, mime_type, application_id FROM application_files WHERE id = $1 AND application_id = $2',
            [fileId, id]
        );
        if (fileResult.rows.length === 0) {
            return res.status(404).json({ error: 'File not found' });
        }

        const file = fileResult.rows[0];
        const localPath = path.join(__dirname, 'Uploads', path.basename(file.path));
        const fileBuffer = await fs.readFile(localPath);

        // Fetch application details for filename
        const appResult = await pool.query(
            'SELECT personal_info->>\'name\' AS name FROM applications WHERE id = $1',
            [id]
        );
        const candidateName = appResult.rows[0].name.replace(/\s+/g, '_');
        const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const pdfFilename = `Offer_Letter_${candidateName}_${date}.pdf`;

        // Check file type and convert if necessary
        if (file.mime_type === 'application/pdf') {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename}"`);
            res.send(fileBuffer);
        } else if (file.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            // Convert DOCX to PDF
            libre.convert(fileBuffer, '.pdf', undefined, (err, pdfBuffer) => {
                if (err) {
                    console.error('Error converting DOCX to PDF:', err);
                    return res.status(500).json({ error: 'Failed to convert file to PDF' });
                }
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename}"`);
                res.send(pdfBuffer);
            });
        } else if (['image/jpeg', 'image/jpg', 'image/png'].includes(file.mime_type)) {
            // Convert image to PDF using pdfkit
            const doc = new PDFDocument();
            const pdfStream = doc.pipe(new require('stream').PassThrough());
            const image = await sharp(fileBuffer).toBuffer();
            doc.image(image, 50, 50, { fit: [500, 700], align: 'center', valign: 'center' });
            doc.end();

            const pdfBuffer = [];
            pdfStream.on('data', chunk => pdfBuffer.push(chunk));
            pdfStream.on('end', () => {
                const finalBuffer = Buffer.concat(pdfBuffer);
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename}"`);
                res.send(finalBuffer);
            });
            pdfStream.on('error', err => {
                console.error('Error creating PDF from image:', err);
                res.status(500).json({ error: 'Failed to convert image to PDF' });
            });
        } else {
            return res.status(400).json({ error: 'Unsupported file type for PDF conversion' });
        }
    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({ error: 'Failed to download file: ' + error.message });
    }
});

// Delete an uploaded offer document
app.delete('/api/applications/files/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;

        const fileResult = await pool.query('SELECT path FROM application_files WHERE id = $1', [fileId]);
        if (fileResult.rows.length === 0) {
            return res.status(404).json({ error: 'File not found' });
        }

        const filePath = fileResult.rows[0].path;
        const localPath = path.join(__dirname, 'Uploads', path.basename(filePath));

        try {
            await fs.unlink(localPath);
        } catch (fsError) {
            if (fsError.code !== 'ENOENT') {
                throw fsError;
            }
        }

        await pool.query('DELETE FROM application_files WHERE id = $1', [fileId]);

        res.json({ message: 'File deleted successfully' });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ error: 'Failed to delete file: ' + error.message });
    }
});

// Start server
app.listen(port, async () => {
    try {
        await pool.connect();
        console.log(`Server running on http://13.233.84.170:${port}`);
    } catch (error) {
        console.error('Failed to connect to database:', error);
        process.exit(1);
    }
});