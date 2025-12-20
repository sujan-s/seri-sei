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
    return (trimmedText + " "
    ).padEnd(columnWidth, headerChar);
};

/**
 * Formats a single import statement, breaking it into multi-line if it exceeds the column width
 * @param {string} importStatement - The import statement to format
 * @param {number} columnWidth - The maximum column width
 * @returns {string} The formatted import statement (potentially multi-line)
 */
const formatImportStatement = (importStatement, columnWidth) => {
    // If the import is already multi-line or within column width, return as-is
    const singleLine = importStatement.replace(/\n\s*/g, " ");
    if (singleLine.length <= columnWidth) {
        return importStatement;
    }

    // Parse the import statement to extract components
    // Matches: import [default,] { named, imports } from "module"
    const defaultImportMatch = singleLine.match(/^import\s+([^{,]+?)\s*,?\s*\{/);
    const namedImportsMatch = singleLine.match(/\{\s*([^}]+)\s*\}/);
    const moduleMatch = singleLine.match(/from\s+["']([^"']+)["']/);
    const sideEffectMatch = singleLine.match(/^import\s+["']([^"']+)["'];?$/);
    const typeImportMatch = singleLine.match(/^import\s+type\s+/);

    // Handle side-effect imports (no named imports)
    if (sideEffectMatch) {
        return importStatement;
    }

    // Handle default-only imports
    if (!namedImportsMatch) {
        return importStatement;
    }

    const defaultImport = defaultImportMatch ? defaultImportMatch[1].trim() : null;
    const namedImports = namedImportsMatch[1].split(",").map(name => name.trim()).filter(Boolean);
    const moduleName = moduleMatch ? moduleMatch[1] : "";
    const isTypeImport = typeImportMatch !== null;

    // Build multi-line format
    const lines = [];
    const importKeyword = isTypeImport ? "import type" : "import";

    if (defaultImport) {
        lines.push(`${importKeyword} ${defaultImport}, {`);
    } else {
        lines.push(`${importKeyword} {`);
    }

    // Add each named import on its own line with 4-space indentation
    namedImports.forEach(namedImport => {
        lines.push(`    ${namedImport},`);
    });

    lines.push(`} from "${moduleName}";`);

    return lines.join("\n");
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
        const matcher = isOtherGroup ? () => true : (line) => group.matchers.some(pkg => {
            // For exact package names (quoted), do exact matching
            if (pkg.startsWith("\"") || pkg.startsWith("'")) {
                return line.includes(pkg);
            }
            // For file extensions (starting with .), use simple includes
            if (pkg.startsWith(".")) {
                return line.includes(pkg);
            }
            // For path-like matchers (ending with /), use simple includes
            if (pkg.endsWith("/")) {
                return line.includes(pkg);
            }
            // For package names, check if it's a complete package name match
            // This handles cases like "react" not matching "fictoan-react"
            const quotedPkg = `"${pkg}"`;
            const singleQuotedPkg = `'${pkg}'`;
            return line.includes(quotedPkg) || line.includes(singleQuotedPkg);
        });
        return {
            header  : createHeader(group.name, HEADER_CHAR, TO_COLUMN_WIDTH),
            matcher,
            matches : [],
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

            // Format each import statement (break into multi-line if needed)
            const formattedImports = group.matches
                .map(imp => formatImportStatement(imp, TO_COLUMN_WIDTH))
                .sort();

            result.push(...formattedImports);
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
    formatImportStatement,
};