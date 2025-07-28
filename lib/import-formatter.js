/**
 * Creates a formatted header string padded to the specified width
 * @param {string} text - The header text
 * @param {string} headerChar - The character to use for padding
 * @param {number} columnWidth - The target column width
 * @returns {string} The formatted header
 */
const createHeader = (text, headerChar, columnWidth) => {
    const trimmedText = text.trim();
    if (trimmedText.length >= columnWidth - 1) return trimmedText;
    return (trimmedText + " ").padEnd(columnWidth, headerChar);
};

/**
 * Takes raw import statements and returns formatted, grouped, and sorted lines.
 * @param {string[]} importStatements - Array of import statements.
 * @param {object} config - The configuration object.
 * @returns {string[]} Formatted lines for the import block.
 */
const groupAndFormatImports = (importStatements, config) => {
    const { TO_COLUMN_WIDTH, HEADER_CHAR, groups : groupDefinitions } = config;

    const groups = groupDefinitions.map(group => {
        const isOtherGroup = group.name.includes("OTHER") || group.matchers.length === 0;
        const matcher = isOtherGroup ? () => true : (line) => group.matchers.some(pkg => line.includes(pkg));
        return { 
            header : createHeader(group.name, HEADER_CHAR, TO_COLUMN_WIDTH), 
            matcher, 
            matches : [] 
        };
    });

    const processedImports = new Set();
    for (const imp of importStatements) {
        if (processedImports.has(imp)) continue;
        for (const group of groups) {
            const fullImport = imp.replace(/\n\s*/g, " ");
            if (group.matcher(fullImport)) {
                group.matches.push(imp);
                processedImports.add(imp);
                break;
            }
        }
    }

    const result = [];
    for (const group of groups) {
        if (group.matches.length) {
            result.push(group.header);
            result.push(...group.matches.sort());
            result.push("");
        }
    }
    if (result.length > 0 && result[result.length - 1] === "") {
        result.pop();
    }
    return result;
};

module.exports = {
    groupAndFormatImports,
    createHeader,
};