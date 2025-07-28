/**
 * Detects the indentation style used in the given code
 * @param {string} code - The source code to analyze
 * @returns {{type: string, size: number}} The detected indentation type and size
 */
const detectIndentStyle = (code) => {
    const lines = code.split("\n");
    let tabCount = 0;
    let spaceCount = 0;
    const spaceSizes = new Map();

    for (const line of lines) {
        if (line.trim() === "") continue;

        const match = line.match(/^(\s+)/);
        if (match) {
            const indent = match[1];
            if (indent.includes("\t")) {
                tabCount++;
            } else {
                spaceCount++;
                const spaceSize = indent.length;
                spaceSizes.set(spaceSize, (spaceSizes.get(spaceSize) || 0
                ) + 1);
            }
        }
    }

    // If we have tabs, prefer tabs
    if (tabCount > spaceCount) {
        return { type : "tabs", size : 1 };
    }

    // Find the most common space size that's likely an indent level
    let mostCommonSize = 4; // default
    let maxCount = 0;
    for (const [size, count] of spaceSizes) {
        if (size > 0 && size <= 8 && count > maxCount) {
            mostCommonSize = size;
            maxCount = count;
        }
    }

    return { type : "spaces", size : mostCommonSize };
};

/**
 * Returns the appropriate indentation string based on config
 * @param {object} config - The configuration object
 * @returns {string} The indentation string to use
 */
const getIndentString = (config) => {
    if (config.INDENT_TYPE === "tabs") {
        return "\t";
    }
    return " ".repeat(config.INDENT_SIZE);
};

/**
 * Normalizes indentation in a line based on the detected level and config
 * @param {string} line - The line to normalize
 * @param {number} level - The indentation level (0 = no indent, 1 = one level, etc.)
 * @param {object} config - The configuration object
 * @returns {string} The line with normalized indentation
 */
const normalizeIndentation = (line, level, config) => {
    const trimmedLine = line.trim();
    if (trimmedLine === "") return "";

    const indentString = getIndentString(config);
    return indentString.repeat(level) + trimmedLine;
};

module.exports = {
    detectIndentStyle,
    getIndentString,
    normalizeIndentation,
};