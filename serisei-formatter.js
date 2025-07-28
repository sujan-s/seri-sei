#!/usr/bin/env node

const fs = require("fs");

// Import all our modules
const { loadConfig } = require("./lib/config");
const { detectIndentStyle } = require("./lib/indent");
const { extractImports, extractInterfaceBlocks } = require("./lib/ast-parser");
const { groupAndFormatImports } = require("./lib/import-formatter");
const { formatInterfaceBlocks } = require("./lib/interface-formatter");
const { writeFileAtomic } = require("./lib/file-utils");

/**
 * Read the file, apply formatting, and write back if changed.
 * This version uses the AST to remove all imports and re-insert a formatted block at the top.
 * @param {string} filePath The path of the file to process.
 */
const processFile = (filePath) => {
    try {
        const config = loadConfig(filePath);
        const originalCode = fs.readFileSync(filePath, "utf8");

        // Detect existing indentation style and update config if needed
        const detectedIndent = detectIndentStyle(originalCode);
        const workingConfig = { ...config };

        // Use detected style if config uses defaults, otherwise respect explicit config
        if (config.INDENT_TYPE === "spaces" && config.INDENT_SIZE === 4) {
            // Using defaults, so adopt detected style
            workingConfig.INDENT_TYPE = detectedIndent.type;
            workingConfig.INDENT_SIZE = detectedIndent.size;
        }
        const lines = originalCode.split("\n");

        // Step 1: Extract imports and get the set of lines to remove
        const { importStatements, linesToRemove : importLinesToRemove } = extractImports(originalCode, workingConfig);

        // Track the last import line for later use
        let lastImportLine = -1;
        if (importStatements.length > 0) {
            // Find the highest line number in importLinesToRemove
            for (const lineNum of importLinesToRemove) {
                if (lineNum > lastImportLine) {
                    lastImportLine = lineNum;
                }
            }
        }

        // Step 2: Extract interface/type blocks and get their lines to remove
        const { interfaceBlocks, linesToRemove : interfaceLinesToRemove } = extractInterfaceBlocks(originalCode);

        // Combine all lines to remove (imports + interfaces)
        const allLinesToRemove = new Set([...importLinesToRemove, ...interfaceLinesToRemove]);

        // If we failed to parse the file (both imports and interfaces are empty but file has content),
        // don't proceed as it might wipe the file
        if (importStatements.length === 0 && interfaceBlocks.length === 0 && allLinesToRemove.size === 0) {
            const hasContent = lines.some(line => line.trim() && !line.trim().startsWith("//"));
            if (hasContent) {
                // File has content but nothing was extracted - likely a parse error
                // Don't format to avoid wiping the file
                return;
            }
        }

        // Step 3: Get the formatted import block
        const newImportLines = importStatements.length > 0 ? groupAndFormatImports(importStatements, workingConfig) : [];

        // Step 4: Get the formatted interface blocks
        const formattedInterfaceBlocks = interfaceBlocks.length > 0 ? formatInterfaceBlocks(interfaceBlocks, lines, workingConfig) : [];

        // Step 5: Reconstruct the file
        const finalLines = [];

        // Find the end of the file header (comments/empty lines/directives at the top)
        let headerEndIndex = 0;
        let foundFirstImport = false;
        let foundFirstInterface = false;

        for (let i = 0; i < lines.length; i++) {
            const trimmedLine = lines[i].trim();

            // Check if this is an import line
            if (allLinesToRemove.has(i) && trimmedLine.startsWith("import")) {
                foundFirstImport = true;
                break;
            }

            // Check if this is an interface/type line
            if (interfaceLinesToRemove.has(i)) {
                foundFirstInterface = true;
                break;
            }

            // Check if this is a directive (string literal at the top level)
            const isDirective = /^["']use (client|server|strict)["'];?$/.test(trimmedLine);

            // Check if this is a generated header (should be removed)
            const headerRegex = new RegExp(`^\\s*//.*\\s[${workingConfig.HEADER_CHAR}]{3,}`);
            const isGeneratedHeader = headerRegex.test(trimmedLine);

            // Skip generated headers - they'll be recreated
            if (isGeneratedHeader) {
                continue;
            }

            // Stop at the first import or first non-comment/non-directive code
            if (trimmedLine !== "" && !trimmedLine.startsWith("//") && !trimmedLine.startsWith("/*") && !isDirective) {
                break;
            }

            finalLines.push(lines[i]);
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
        // Skip comments and empty lines when determining if there's subsequent code
        let hasSubsequentCode = false;
        for (let i = headerEndIndex; i < lines.length; i++) {
            if (!allLinesToRemove.has(i)) {
                const line = lines[i].trim();
                if (line !== "" && !line.startsWith("//") && !line.startsWith("/*")) {
                    hasSubsequentCode = true;
                    break;
                }
            }
        }

        if (newImportLines.length > 0 && hasSubsequentCode) {
            finalLines.push("");
        }

        // Create a map of interface block start lines to their formatted versions
        const interfaceBlockMap = new Map();
        for (const block of formattedInterfaceBlocks) {
            interfaceBlockMap.set(block.startLine, block);
        }

        // Process the rest of the file, inserting formatted interface blocks at their original positions
        let i = headerEndIndex;
        while (i < lines.length) {
            // Check if this line is the start of a formatted interface block
            if (interfaceBlockMap.has(i)) {
                const block = interfaceBlockMap.get(i);
                finalLines.push(...block.formattedLines);
                // Skip to the end of the original block
                i = block.endLine + 1;
                continue;
            }

            // If this line should be removed (import or interface content), skip it
            if (allLinesToRemove.has(i)) {
                i++;
                continue;
            }

            // Check if this is a duplicate generated header that should be removed
            const trimmedLine = lines[i].trim();
            const headerRegex = new RegExp(`^\\s*//.*\\s[${workingConfig.HEADER_CHAR}]{3,}`);
            const isGeneratedHeader = headerRegex.test(trimmedLine);

            // Skip duplicate headers that appear after imports
            // These can occur when the file was previously formatted
            if (isGeneratedHeader && i > lastImportLine) {
                // Check if this is followed by empty lines and then code (not an import)
                let nextNonEmptyLine = i + 1;
                while (nextNonEmptyLine < lines.length && lines[nextNonEmptyLine].trim() === "") {
                    nextNonEmptyLine++;
                }

                // If the next non-empty line exists and is not an import, this is a stray header
                if (nextNonEmptyLine < lines.length) {
                    const nextLine = lines[nextNonEmptyLine].trim();
                    if (!nextLine.startsWith("import ") && !nextLine.startsWith("export ") &&
                        !nextLine.startsWith("interface ") && !nextLine.startsWith("type ")) {
                        i++;
                        continue;
                    }
                }
            }

            // For all other lines, just add them as-is
            finalLines.push(lines[i]);
            i++;
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