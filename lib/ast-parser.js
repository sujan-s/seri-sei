const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;

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
            const headerRegex = new RegExp(`^\\s*//.*\\s[${config.HEADER_CHAR}]{3,}`);

            // Include any empty lines or generated headers immediately before the first import
            let blockStart = firstImportLine;
            for (let i = firstImportLine - 1; i >= 0; i--) {
                const line = lines[i].trim();
                if (line === "") {
                    blockStart = i;
                } else if (headerRegex.test(line)) {
                    // This is a generated header, include it for removal
                    blockStart = i;
                } else {
                    // This is a regular comment or code, stop here
                    break;
                }
            }

            // Look for the end of the import block and include any scattered generated headers
            let blockEnd = lastImportLine;
            for (let i = lastImportLine + 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line === "" || headerRegex.test(line)) {
                    // Include empty lines and generated headers after imports
                    blockEnd = i;
                } else if (line.startsWith("//") || line.startsWith("/*")) {
                    // Regular comments - don't include these
                    break;
                } else {
                    // Non-comment code
                    break;
                }
            }

            // Add all lines in the import block to linesToRemove
            for (let i = blockStart; i <= blockEnd; i++) {
                linesToRemove.add(i);
            }

            // Additional pass: scan the ENTIRE file for any generated headers and remove them all
            // This ensures we catch all duplicate headers regardless of where they appear
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (headerRegex.test(line)) {
                    linesToRemove.add(i);
                    // Also remove empty lines immediately after duplicate headers
                    if (i + 1 < lines.length && lines[i + 1].trim() === "") {
                        linesToRemove.add(i + 1);
                    }
                }
            }
        }

        // Generate the import code strings from the collected AST nodes
        // Remove all comments to avoid duplicating headers
        const importStatements = importNodes.map((node) => {
            // Clear both leading and trailing comments to prevent duplication
            const nodeCopy = { ...node, leadingComments : null, trailingComments : null };
            return generate(nodeCopy, { compact : false }).code;
        });

        return { importStatements, linesToRemove };

    } catch (error) {
        console.error(`Failed to parse file with AST: ${error.message}`);
        // Return empty results on parse error
        return { importStatements : [], linesToRemove : new Set() };
    }
};

/**
 * AST-based interface/type extraction function.
 * Collects ALL interface and type declarations and identifies the exact lines they occupy.
 * @param {string} code - The source code content
 * @returns {{interfaceBlocks: Array<{node: object, startLine: number, endLine: number}>, linesToRemove: Set<number>}}
 */
const extractInterfaceBlocks = (code) => {
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

        const interfaceBlocks = [];
        const linesToRemove = new Set();

        traverse(ast, {
            TSInterfaceDeclaration(path) {
                const node = path.node;
                const startLine = node.loc.start.line - 1; // Convert to 0-based
                const endLine = node.loc.end.line - 1; // Convert to 0-based

                interfaceBlocks.push({ node, startLine, endLine });

                // Add every line occupied by this interface to the set for removal
                for (let i = startLine; i <= endLine; i++) {
                    linesToRemove.add(i);
                }
            },
            TSTypeAliasDeclaration(path) {
                const node = path.node;
                const startLine = node.loc.start.line - 1; // Convert to 0-based
                const endLine = node.loc.end.line - 1; // Convert to 0-based

                interfaceBlocks.push({ node, startLine, endLine });

                // Add every line occupied by this type to the set for removal
                for (let i = startLine; i <= endLine; i++) {
                    linesToRemove.add(i);
                }
            },
            ExportNamedDeclaration(path) {
                const node = path.node;
                // Check if this is an exported interface or type
                if (node.declaration &&
                    (node.declaration.type === "TSInterfaceDeclaration" ||
                        node.declaration.type === "TSTypeAliasDeclaration"
                    )) {
                    const startLine = node.loc.start.line - 1; // Convert to 0-based
                    const endLine = node.loc.end.line - 1; // Convert to 0-based

                    interfaceBlocks.push({ node, startLine, endLine });

                    // Add every line occupied by this exported interface/type to the set for removal
                    for (let i = startLine; i <= endLine; i++) {
                        linesToRemove.add(i);
                    }

                    // Skip the inner declaration to avoid double-counting
                    path.skip();
                }
            },
        });

        return { interfaceBlocks, linesToRemove };

    } catch (error) {
        console.error(`Failed to parse file with AST for interfaces: ${error.message}`);
        // Return empty results on parse error
        return { interfaceBlocks : [], linesToRemove : new Set() };
    }
};

module.exports = {
    extractImports,
    extractInterfaceBlocks,
};