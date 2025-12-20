/**
 * Detects the indentation style used in the given code
 * @param {string} code - The source code to analyze
 * @returns {{type: string, size: number}} The detected indentation type and size
 */
const detectIndentStyle = (code) => {
    const lines = code.split("\n");
    let tabCount = 0;
    let spaceCount = 0;
    const spaceSizes = [];

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
                if (spaceSize > 0 && spaceSize <= 8) {
                    spaceSizes.push(spaceSize);
                }
            }
        }
    }

    // If we have tabs, prefer tabs
    if (tabCount > spaceCount) {
        return { type : "tabs", size : 1 };
    }

    // Find the base indentation unit by calculating GCD of all indentation sizes
    // This correctly identifies 4 as the base unit even if there are many 8-space indents
    if (spaceSizes.length === 0) {
        return { type : "spaces", size : 4 }; // default
    }

    // Calculate GCD of all indentation sizes
    const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
    let indentSize = spaceSizes[0];
    for (let i = 1; i < spaceSizes.length; i++) {
        indentSize = gcd(indentSize, spaceSizes[i]);
        if (indentSize === 1) {
            // If GCD is 1, fall back to minimum common indentation
            break;
        }
    }

    // If GCD is 1 or seems wrong, use the minimum indentation size
    if (indentSize === 1) {
        indentSize = Math.min(...spaceSizes);
    }

    // Ensure the detected size is reasonable (2, 3, 4, or 8)
    if (![2, 3, 4, 8].includes(indentSize)) {
        indentSize = 4; // default fallback
    }

    return { type : "spaces", size : indentSize };
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