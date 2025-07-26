#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;

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
            {
                name     : "// EXTERNAL ",
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
                    "globby",
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
 * AST-based import extraction function.
 * Collects ALL imports and identifies the exact lines they occupy.
 * @param {string} code - The source code content
 * @param {object} config - The configuration object
 * @returns {{importStatements: string[], linesToRemove: Set<number>}}
 */
const extractImports = (code, config) => {
    try {
        const ast = parse(code, {
            sourceType : "module",
            plugins    : [
                "typescript",
                "jsx",
                "decorators-legacy",
                "classProperties",
                "objectRestSpread",
                "asyncGenerators",
                "functionBind",
                "exportDefaultFrom",
                "exportNamespaceFrom",
                "dynamicImport",
                "nullishCoalescingOperator",
                "optionalChaining",
            ],
        });

        const importNodes = [];
        const linesToRemove = new Set();
        let firstImportLine = -1;
        let lastImportLine = -1;

        traverse(ast, {
            ImportDeclaration(path) {
                const node = path.node;
                importNodes.push(node);
                // Track the first and last import lines
                const importStartLine = node.loc.start.line - 1; // Convert to 0-based
                const importEndLine = node.loc.end.line - 1; // Convert to 0-based
                
                if (firstImportLine === -1 || importStartLine < firstImportLine) {
                    firstImportLine = importStartLine;
                }
                if (lastImportLine === -1 || importEndLine > lastImportLine) {
                    lastImportLine = importEndLine;
                }
                
                // Add every line occupied by this import to the set for removal.
                for (let i = importStartLine; i <= importEndLine; i++) {
                    linesToRemove.add(i);
                }
            },
        });

        if (importNodes.length === 0) {
            return { importStatements : [], linesToRemove : new Set() };
        }

        // Expand linesToRemove to include the entire import block
        // This includes all lines from the first import to the last import,
        // including any comments or empty lines in between
        if (firstImportLine !== -1 && lastImportLine !== -1) {
            const lines = code.split("\n");
            // Look for generated headers or comments that are part of the import block
            // Start from the line before the first import, but only include
            // empty lines and generated headers (not regular comments)
            let blockStart = firstImportLine;
            for (let i = firstImportLine - 1; i >= 0; i--) {
                const line = lines[i].trim();
                const headerRegex = new RegExp(`^\\s*//.*\\s[${config.HEADER_CHAR}]`);
                if (line === "") {
                    blockStart = i;
                } else if (headerRegex.test(line)) {
                    // This is a generated header, include it
                    blockStart = i;
                } else {
                    // This is a regular comment or code, stop here
                    break;
                }
            }
            
            // Look for the end of the import block
            let blockEnd = lastImportLine;
            for (let i = lastImportLine + 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line === "" || line.startsWith("//") || line.startsWith("/*")) {
                    blockEnd = i;
                } else {
                    break;
                }
            }
            
            // Add all lines in the import block to linesToRemove
            for (let i = blockStart; i <= blockEnd; i++) {
                linesToRemove.add(i);
            }
        }

        // Generate the import code strings from the collected AST nodes
        // Remove leading comments to avoid duplicating file headers
        const importStatements = importNodes.map((node) => {
            // Clear leading comments to prevent duplication
            const nodeCopy = { ...node, leadingComments: null };
            return generate(nodeCopy, { compact : false }).code;
        });

        return { importStatements, linesToRemove };

    } catch (error) {
        console.error(`Failed to parse file with AST: ${error.message}`);
        // Return empty results on parse error
        return { importStatements: [], linesToRemove: new Set() };
    }
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
 * This version uses the AST to remove all imports and re-insert a formatted block at the top.
 * @param {string} filePath The path of the file to process.
 */
const processFile = (filePath) => {
    try {
        const config = loadConfig(filePath);
        const originalCode = fs.readFileSync(filePath, "utf8");
        const lines = originalCode.split("\n");

        // Step 1: Extract imports and get the set of lines to remove
        const { importStatements, linesToRemove } = extractImports(originalCode, config);

        if (importStatements.length === 0) {
            // No imports found, no need to format anything.
            return;
        }

        // Step 2: Get the formatted import block
        const newImportLines = groupAndFormatImports(importStatements, config);

        // Step 3: Reconstruct the file
        const finalLines = [];

        // Find the end of the file header (comments/empty lines/directives at the top)
        let headerEndIndex = 0;
        let foundFirstImport = false;
        for (let i = 0; i < lines.length; i++) {
            const trimmedLine = lines[i].trim();
            
            // Check if this is an import line
            if (linesToRemove.has(i) && trimmedLine.startsWith("import")) {
                foundFirstImport = true;
            }
            
            // Check if this is a directive (string literal at the top level)
            const isDirective = /^["']use (client|server|strict)["'];?$/.test(trimmedLine);
            
            // Stop at the first import or first non-comment/non-directive code
            if (foundFirstImport || (trimmedLine !== "" && !trimmedLine.startsWith("//") && !trimmedLine.startsWith("/*") && !isDirective && !linesToRemove.has(i))) {
                break;
            }
            
            if (!linesToRemove.has(i)) {
                finalLines.push(lines[i]);
            }
            headerEndIndex = i + 1;
        }

        // Inject the new import block
        if (newImportLines.length > 0) {
            // If the header already ends with a blank line, don't add another.
            if (finalLines.length > 0 && finalLines[finalLines.length - 1].trim() !== "") {
                finalLines.push("");
            }
            finalLines.push(...newImportLines);
        }

        // Check if there is subsequent code to add a separator line
        let hasSubsequentCode = false;
        for (let i = headerEndIndex; i < lines.length; i++) {
            if (!linesToRemove.has(i) && lines[i].trim() !== "") {
                hasSubsequentCode = true;
                break;
            }
        }

        if (newImportLines.length > 0 && hasSubsequentCode) {
            finalLines.push("");
        }

        // Process the rest of the file, skipping old import lines
        for (let i = headerEndIndex; i < lines.length; i++) {
            if (linesToRemove.has(i)) {
                continue;
            }

            const line = lines[i];
            const isBlockStart = /^\s*(export\s+)?(interface|type)\s+[\w$]+.*\{/.test(line.trim());

            if (!isBlockStart) {
                finalLines.push(line);
                continue;
            }

            // The rest of this logic is the original, known-good type/interface formatter
            const baseIndent = (line.match(/^\s*/) || [""]
            )[0];
            let braceDepth = 0;
            let blockEndIndex = -1;
            for (let j = i; j < lines.length; j++) {
                if (!linesToRemove.has(j)) { // Ensure we don't look inside an old import
                    braceDepth += (lines[j].match(/\{/g) || []
                    ).length;
                    braceDepth -= (lines[j].match(/\}/g) || []
                    ).length;
                }
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

            // Extract content, making sure to skip any import lines that might be inside
            const blockContent = [];
            for (let k = i + 1; k < blockEndIndex; k++) {
                if (!linesToRemove.has(k)) {
                    blockContent.push(lines[k]);
                }
            }

            finalLines.push(blockHeader);
            if (blockContent.some((l) => l.trim() !== "")) {
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
