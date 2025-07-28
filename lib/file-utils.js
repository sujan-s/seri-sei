const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Write file atomically to avoid conflicts with IDEs
 * @param {string} filePath - Path to write to
 * @param {string} content - Content to write
 */
const writeFileAtomic = (filePath, content) => {
    const tempFile = path.join(os.tmpdir(), `${path.basename(filePath)}.${Date.now()}.tmp`);
    try {
        fs.writeFileSync(tempFile, content, "utf8");
        fs.renameSync(tempFile, filePath);
    } catch (error) {
        try {
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        } catch (e) {
            console.error(`Failed to clean up temporary file ${tempFile}`, e);
        }
        throw error;
    }
};

module.exports = {
    writeFileAtomic,
};