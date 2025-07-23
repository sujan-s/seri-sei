#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Loads configuration by searching upwards from a starting directory for a .seriseirc file.
 * Falls back to default values if no config file is found.
 * @param {string} startPath The path of the file being processed.
 * @returns {object} The resolved configuration object.
 */
const loadConfig = (startPath) => {
    const defaultConfig = {
        HEADER_CHAR     : "=",
        TO_COLUMN_WIDTH : 120,
        groups          : [
            { name       : "// EXTERNAL ",
                matchers : [
                    "\"react\"",
                    "'react'",
                    "next/",
                    "dnd-kit/",
                    "zustand",
                    "framer-motion",
                    "tiptap",
                    "axios",
                    "tanstack",
                    "vite",
                    "path",
                    "tauri",
                    "react-router-dom",
                    "@react-oauth/google",
                    "globby"
                ],
            },
            { name : "// FICTOAN ", matchers : ["fictoan-react"] },
            { name : "// CONTEXTS ", matchers : ["contexts/"] },
            { name : "// COMPONENTS ", matchers : ["components/"] },
            { name : "// CONFIGS ", matchers : ["configs/"] },
            { name : "// LIB ", matchers : ["lib/"] },
            { name : "// LOGIC ", matchers : ["logic/"] },
            { name : "// DATA ", matchers : ["mock-data/"] },
            { name : "// HOOKS ", matchers : ["hooks/"] },
            { name : "// STORES ", matchers : ["store/"] },
            { name : "// SERVICES ", matchers : ["services/"] },
            { name : "// STYLES ", matchers : ["styles/", ".css"] },
            { name : "// TYPES ", matchers : ["types", "typings"] },
            { name : "// UTILS ", matchers : ["utils/"] },
            { name : "// ASSETS ", matchers : ["assets/"] },
            { name : "// OTHER ", matchers : [] },
        ],
    };

    let currentDir = path.dirname(startPath);
    let configPath = null;

    // Search upwards from the current directory to the root
    while (currentDir !== path.parse(currentDir).root) {
        const potentialPath = path.join(currentDir, ".seriseirc");
        if (fs.existsSync(potentialPath)) {
            configPath = potentialPath;
            break;
        }
        currentDir = path.dirname(currentDir);
    }

    // Check the root directory as a last resort before giving up.
    if (!configPath) {
        const rootPath = path.join(path.parse(startPath).root, ".seriseirc");
        if (fs.existsSync(rootPath)) {
            configPath = rootPath;
        }
    }

    if (!configPath) {
        return defaultConfig;
    }

    let config = JSON.parse(JSON.stringify(defaultConfig));

    try {
        const fileContent = fs.readFileSync(configPath, "utf8");
        const lines = fileContent.split("\n");

        let inGroupsSection = false;
        let customGroups = [];

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine.startsWith("#")) {
                continue;
            }

            if (/^\[\s*groups\s*\]$/.test(trimmedLine)) {
                inGroupsSection = true;
                continue;
            }

            if (trimmedLine.startsWith("[")) { // A new section starts
                inGroupsSection = false;
                continue;
            }

            if (inGroupsSection) {
                const parts = trimmedLine.split("=");
                // Strip existing slashes from the key to prevent duplication
                const key = parts[0].trim().replace(/^\/\/\s*/, "");
                const value = parts.slice(1).join("=").trim();
                const matchers = value
                    ? value.split(",").map(m => m.trim().replace(/["']/g, "")).filter(Boolean)
                    : [];
                customGroups.push({ name : `// ${key.toUpperCase()} `, matchers });
            } else {
                const parts = trimmedLine.split("=");
                const key = parts[0].trim();
                const value = parts.slice(1).join("=").trim();
                if (key === "TO_COLUMN_WIDTH") {
                    config.TO_COLUMN_WIDTH = parseInt(value, 10) || defaultConfig.TO_COLUMN_WIDTH;
                } else if (key === "HEADER_CHAR") {
                    config.HEADER_CHAR = value || defaultConfig.HEADER_CHAR;
                }
            }
        }

        if (customGroups.length > 0) {
            customGroups.push({ name : "// OTHER ", matchers : [] });
            config.groups = customGroups;
        }

    } catch (e) {
        console.error(`Error reading or parsing ${configPath}:`, e);
        return defaultConfig;
    }

    return config;
};

/**
 * Extracts import statements and their location from an array of lines.
 * The "import block" is defined as the contiguous section from the first
 * import statement or generated header until the first line of other code.
 * @param {string[]} lines - The lines of the file.
 * @param {object} config - The configuration object.
 * @returns {{importStatements: string[], importStart: number, importEnd: number}}
 */
const extractImports = (lines, config) => {
    const { HEADER_CHAR } = config;
    const headerRegex = new RegExp(`^\\s*//.*\\s[${HEADER_CHAR}]`);
    const importStatements = [];
    let importStart = -1;
    let importEnd = -1;
    let commentBuffer = [];
    let inBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Find the start of the block. It can be a header or an import.
        if (!inBlock && (headerRegex.test(trimmedLine) || trimmedLine.startsWith("import")
        )) {
            importStart = i;
            inBlock = true;
        }

        if (!inBlock) continue;

        // Once in the block, we only care about collecting pure import statements.
        // Headers and empty lines within the block are ignored for collection but extend the block.

        if (headerRegex.test(trimmedLine)) {
            commentBuffer = []; // A header clears any preceding comments.
            continue;
        }

        if (trimmedLine.startsWith("//") || trimmedLine.startsWith("/*")) {
            commentBuffer.push(line);
            continue;
        }

        if (trimmedLine.startsWith("import ")) {
            let currentImportLines = [...commentBuffer, line];
            commentBuffer = [];
            let braceDepth = (trimmedLine.match(/\{/g) || []
            ).length - (trimmedLine.match(/\}/g) || []
            ).length;

            if (!trimmedLine.endsWith(";") || braceDepth > 0) {
                for (let j = i + 1; j < lines.length; j++) {
                    const nextLine = lines[j];
                    currentImportLines.push(nextLine);
                    braceDepth += (nextLine.match(/\{/g) || []
                    ).length;
                    braceDepth -= (nextLine.match(/\}/g) || []
                    ).length;
                    if (nextLine.includes(";") && braceDepth <= 0) {
                        i = j; // Move outer loop cursor forward
                        break;
                    }
                }
            }
            importStatements.push(currentImportLines.join("\n"));
        } else if (trimmedLine !== "") {
            // This is the first line of code after the imports.
            importEnd = i;
            break; // Exit the loop, we are done with the import block.
        }
        // If we are here, it was an empty line. Just continue, it's part of the block.
    }

    if (importStart !== -1 && importEnd === -1) {
        // This means the file ended while we were still in the import block.
        importEnd = lines.length;
    }

    return { importStatements, importStart, importEnd };
};

/**
 * Takes raw import statements and returns formatted, grouped, and sorted lines.
 * @param {string[]} importStatements - Array of import statements.
 * @param {object} config - The configuration object.
 * @returns {string[]} Formatted lines for the import block.
 */
const groupAndFormatImports = (importStatements, config) => {
    const { TO_COLUMN_WIDTH, HEADER_CHAR, groups : groupDefinitions } = config;

    const createHeader = (text) => {
        const trimmedText = text.trim();
        if (trimmedText.length >= TO_COLUMN_WIDTH - 1) return trimmedText;
        return (trimmedText + " "
        ).padEnd(TO_COLUMN_WIDTH, HEADER_CHAR);
    };

    const groups = groupDefinitions.map(group => {
        const isOtherGroup = group.name.includes("OTHER") || group.matchers.length === 0;
        const matcher = isOtherGroup ? () => true : (line) => group.matchers.some(pkg => line.includes(pkg));
        return { header : createHeader(group.name), matcher, matches : [] };
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


/**
 * Recursively formats the content of a type or interface block.
 * @param {string[]} blockContentLines - The lines of code inside the { ... } block.
 * @param {string} baseIndent - The base indentation of the parent block.
 * @returns {string[]} The formatted lines of code.
 */
const formatBlockContent = (blockContentLines, baseIndent) => {
    const properties = [];
    let currentPropLines = [];
    let braceDepth = 0;
    let parenDepth = 0;

    // Delimit properties, correctly handling multi-line nested objects and function signatures.
    for (const line of blockContentLines) {
        if (line.trim() === "" && currentPropLines.length === 0) continue;

        currentPropLines.push(line);
        braceDepth += (line.match(/\{/g) || []
        ).length;
        braceDepth -= (line.match(/\}/g) || []
        ).length;
        parenDepth += (line.match(/\(/g) || []
        ).length;
        parenDepth -= (line.match(/\)/g) || []
        ).length;

        // A property ends when all braces/parens are closed and the line ends with a valid separator.
        if (braceDepth === 0 && parenDepth === 0) {
            const trimmedLine = line.trim();
            if (trimmedLine.endsWith(";") || trimmedLine.endsWith("}") || trimmedLine.endsWith(",")) {
                properties.push(currentPropLines);
                currentPropLines = [];
            }
        }
    }
    if (currentPropLines.length > 0) properties.push(currentPropLines); // Push any remaining property lines

    // Calculate alignment for all direct child properties in this block
    let maxKeyLength = 0;
    let hasOptional = false;
    for (const prop of properties) {
        const firstLine = prop[0].trim();
        if (firstLine.startsWith("//") || firstLine.startsWith("/*")) continue;

        const match = firstLine.match(/^(\[.+?\]|[\w$]+)(\s*\?)?\s*:/);
        if (match) {
            maxKeyLength = Math.max(maxKeyLength, match[1].length);
            if (match[2]) hasOptional = true;
        }
    }

    const propertyIndent = baseIndent + "    ";
    const formattedLines = [];

    // Format each property
    for (const prop of properties) {
        const firstLine = prop[0];
        const trimmedFirstLine = firstLine.trim();

        if (trimmedFirstLine.startsWith("//") || trimmedFirstLine.startsWith("/*")) {
            formattedLines.push(...prop.map(l => propertyIndent + l.trim()));
            continue;
        }

        const match = trimmedFirstLine.match(/^(\[.+?\]|[\w$]+)(\s*\?)?\s*:\s*(.*)$/);

        if (!match) {
            // Should not happen often with the new property splitter, but as a fallback:
            formattedLines.push(...prop.map(l => propertyIndent + l.trim()));
            continue;
        }

        const [, key, optional, value] = match;
        const paddedKey = key.padEnd(maxKeyLength);
        const alignedFirstLine = `${propertyIndent}${paddedKey}${hasOptional ? (optional ? " ?" : "  "
        ) : ""} : ${value}`;

        if (prop.length === 1) {
            formattedLines.push(alignedFirstLine);
        } else {
            // This is a multi-line property.
            const openingBraceIndex = value.lastIndexOf("{");

            if (openingBraceIndex === -1) {
                // This is not a nested object, but a multi-line signature or other construct.
                // Format the first line and then indent the subsequent lines.
                formattedLines.push(alignedFirstLine);
                for (let i = 1; i < prop.length; i++) {
                    // Indent subsequent lines of the property.
                    formattedLines.push(propertyIndent + "    " + prop[i].trim());
                }
            } else {
                // This is a nested object. Format it recursively.
                const firstLineHeader = alignedFirstLine.substring(0, alignedFirstLine.lastIndexOf("{") + 1);
                formattedLines.push(firstLineHeader);

                const nestedContent = prop.slice(1, -1);
                if (nestedContent.length > 0) {
                    const formattedNestedContent = formatBlockContent(nestedContent, propertyIndent);
                    formattedLines.push(...formattedNestedContent);
                }

                const lastLine = prop[prop.length - 1];
                formattedLines.push(propertyIndent + lastLine.trim());
            }
        }
    }

    return formattedLines;
};


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

/**
 * Read the file, apply formatting, and write back if changed.
 * This version processes the file in a single pass to avoid cascading errors.
 * @param {string} filePath The path of the file to process.
 */
const processFile = (filePath) => {
    try {
        const config = loadConfig(filePath);
        const originalCode = fs.readFileSync(filePath, "utf8");
        const lines = originalCode.split("\n");

        // Step 1: Extract import information
        const { importStatements, importStart, importEnd } = extractImports(lines, config);

        if (importStart === -1) {
            // No imports found, no need to format anything.
            return;
        }

        // Step 2: Get the formatted import block
        const newImportLines = groupAndFormatImports(importStatements, config);

        // Step 3: Reconstruct the file, formatting types/interfaces along the way
        const finalLines = [];

        // Add lines before the import block
        finalLines.push(...lines.slice(0, importStart));

        // Add the new formatted import block
        finalLines.push(...newImportLines);

        // Ensure there's a blank line after imports if the next line isn't already blank.
        if (newImportLines.length > 0 && importEnd < lines.length && lines[importEnd] && lines[importEnd].trim() !== "") {
            finalLines.push("");
        }

        // Process the rest of the file
        for (let i = importEnd; i < lines.length; i++) {
            const line = lines[i];
            const isBlockStart = /^\s*(export\s+)?(interface|type)\s+[\w$]+.*\{/.test(line.trim());

            if (!isBlockStart) {
                finalLines.push(line);
                continue;
            }

            const baseIndent = (line.match(/^\s*/) || [""]
            )[0];
            let braceDepth = 0;
            let blockEndIndex = -1;
            for (let j = i; j < lines.length; j++) {
                braceDepth += (lines[j].match(/\{/g) || []
                ).length;
                braceDepth -= (lines[j].match(/\}/g) || []
                ).length;
                if (braceDepth === 0) {
                    blockEndIndex = j;
                    break;
                }
            }

            if (blockEndIndex === -1) {
                finalLines.push(line); // Unclosed block
                continue;
            }

            const blockHeader = lines[i];
            const blockFooter = lines[blockEndIndex];
            const blockContent = lines.slice(i + 1, blockEndIndex);

            finalLines.push(blockHeader);
            if (blockContent.some(l => l.trim() !== "")) {
                finalLines.push(...formatBlockContent(blockContent, baseIndent));
            } else {
                finalLines.push(...blockContent);
            }
            finalLines.push(blockFooter);

            i = blockEndIndex;
        }

        const newCode = finalLines.join("\n");

        if (newCode !== originalCode) {
            writeFileAtomic(filePath, newCode);
            console.log(`Formatted ${filePath}`);
        }
    } catch (error) {
        if (error.code === "EBUSY" || error.code === "EPERM") {
            setTimeout(() => processFile(filePath), 100);
        } else {
            console.error(`Error processing ${filePath}:`, error);
        }
    }
};

// Main execution
const filePath = process.argv[2];
if (!filePath) {
    console.error("Please provide a file path to format.");
    process.exit(1);
}

if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
}

processFile(filePath);
