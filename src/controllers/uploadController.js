const multer = require('multer');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const fileFilter = (req, file, cb) => {
  const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
  cb(ok ? null : new Error('Only jpg, png, webp images are allowed'), ok);
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

const uploadSingleImage = upload.single('file');

const uploadBufferToCloudinary = (buffer, publicId) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'nexqira-blog', public_id: publicId, resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });

const handleUploadImage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const publicId = `img_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const result = await uploadBufferToCloudinary(req.file.buffer, publicId);

    res.json({
      url: result.secure_url,
      path: result.secure_url,
      filename: result.public_id
    });
  } catch (error) {
    console.error('Cloudinary upload failed:', error);
    res.status(500).json({ message: error.message || 'Image upload failed' });
  }
};

module.exports = {
  uploadSingleImage,
  handleUploadImage
};
