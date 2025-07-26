#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;

/** ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
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

/** ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
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
            const nodeCopy = { ...node, leadingComments : null };
            return generate(nodeCopy, { compact : false }).code;
        });

        return { importStatements, linesToRemove };

    } catch (error) {
        console.error(`Failed to parse file with AST: ${error.message}`);
        // Return empty results on parse error
        return { importStatements : [], linesToRemove : new Set() };
    }
};

/** ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
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

/** ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
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


/** ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
 * Formats interface blocks using AST nodes.
 * @param {Array<{node: object, startLine: number, endLine: number}>} interfaceBlocks - Array of interface block data
 * @param {string[]} originalLines - The original file lines
 * @returns {Array<{startLine: number, endLine: number, formattedLines: string[]}>} Formatted interface blocks
 */
const formatInterfaceBlocks = (interfaceBlocks, originalLines) => {
    const formattedBlocks = [];

    for (const block of interfaceBlocks) {
        const { node, startLine, endLine } = block;

        // Extract the original lines for this interface/type block
        const blockLines = [];
        for (let i = startLine; i <= endLine; i++) {
            blockLines.push(originalLines[i]);
        }

        // Get the base indentation from the first line
        const baseIndent = (blockLines[0].match(/^\s*/) || [""]
        )[0];

        // Find the opening brace position
        let braceLineIndex = -1;
        let braceColumnIndex = -1;
        for (let i = 0; i < blockLines.length; i++) {
            const braceIndex = blockLines[i].indexOf("{");
            if (braceIndex !== -1) {
                braceLineIndex = i;
                braceColumnIndex = braceIndex;
                break;
            }
        }

        // If no opening brace found, this might be a simple type alias
        if (braceLineIndex === -1) {
            // For type aliases without braces, just keep the original formatting
            formattedBlocks.push({
                startLine,
                endLine,
                formattedLines : blockLines,
            });
            continue;
        }

        // Extract the content between braces
        const blockContent = [];
        let foundContent = false;

        // Start from the line after the opening brace
        let contentStartLine = braceLineIndex;
        let contentEndLine = blockLines.length - 1;

        // If the opening brace is at the end of the first line, start from next line
        if (braceColumnIndex < blockLines[braceLineIndex].length - 1) {
            // There's content after the opening brace on the same line
            const afterBrace = blockLines[braceLineIndex].substring(braceColumnIndex + 1).trim();
            if (afterBrace && !afterBrace.startsWith("}")) {
                blockContent.push(baseIndent + "    " + afterBrace);
                foundContent = true;
            }
        }

        // Process middle lines (between first and last)
        for (let i = braceLineIndex + 1; i < blockLines.length - 1; i++) {
            blockContent.push(blockLines[i]);
            if (blockLines[i].trim() !== "") {
                foundContent = true;
            }
        }

        // Handle the last line if it contains content before the closing brace
        if (blockLines.length > 1) {
            const lastLine = blockLines[blockLines.length - 1];
            const closingBraceIndex = lastLine.lastIndexOf("}");
            if (closingBraceIndex > 0) {
                const beforeBrace = lastLine.substring(0, closingBraceIndex).trim();
                if (beforeBrace) {
                    blockContent.push(baseIndent + "    " + beforeBrace);
                    foundContent = true;
                }
            }
        }

        // Format the block content
        let formattedContent = [];
        if (foundContent && blockContent.some(line => line.trim() !== "")) {
            formattedContent = formatBlockContent(blockContent, baseIndent);
        }

        // Reconstruct the formatted block
        const formattedLines = [];

        // Add all lines before the brace line as-is (handles multi-line declarations)
        for (let i = 0; i < braceLineIndex; i++) {
            formattedLines.push(blockLines[i]);
        }

        // Add the header line (everything up to and including the opening brace)
        const headerLine = blockLines[braceLineIndex].substring(0, braceColumnIndex + 1);
        formattedLines.push(headerLine);

        // Add the formatted content
        formattedLines.push(...formattedContent);

        // Add the closing brace line
        const lastLine = blockLines[blockLines.length - 1];
        const closingBraceIndex = lastLine.lastIndexOf("}");
        const closingLine = baseIndent + lastLine.substring(closingBraceIndex);
        formattedLines.push(closingLine);

        formattedBlocks.push({
            startLine,
            endLine,
            formattedLines,
        });
    }

    return formattedBlocks;
};

/** ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
 * Parses parameter string into structured format
 * @param {string} parametersStr - The parameters string to parse
 * @returns {Array<{name: string, optional: boolean, type: string}>} Parsed parameters
 */
const parseParameters = (parametersStr) => {
    const parameters = [];
    let currentParam = "";
    let depth = 0;
    let inString = false;
    let stringChar = "";

    for (let i = 0; i < parametersStr.length; i++) {
        const char = parametersStr[i];
        const prevChar = i > 0 ? parametersStr[i - 1] : "";

        // Handle string literals
        if ((char === "\"" || char === "'"
        ) && prevChar !== "\\") {
            if (!inString) {
                inString = true;
                stringChar = char;
            } else if (char === stringChar) {
                inString = false;
            }
        }

        if (!inString) {
            // Track nested structures
            if (char === "(" || char === "{" || char === "<") depth++;
            else if (char === ")" || char === "}" || char === ">") depth--;

            // Split on comma only at depth 0
            if (char === "," && depth === 0) {
                if (currentParam.trim()) {
                    parameters.push(parseParameter(currentParam.trim()));
                }
                currentParam = "";
                continue;
            }
        }

        currentParam += char;
    }

    // Don't forget the last parameter
    if (currentParam.trim()) {
        parameters.push(parseParameter(currentParam.trim()));
    }

    return parameters;
};

/** ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
 * Parses a single parameter into name, optional flag, and type
 * @param {string} param - The parameter string to parse
 * @returns {{name: string, optional: boolean, type: string}} Parsed parameter
 */
const parseParameter = (param) => {
    // Find the first colon that's not inside brackets
    let colonIndex = -1;
    let depth = 0;
    let inString = false;
    let stringChar = "";

    for (let i = 0; i < param.length; i++) {
        const char = param[i];
        const prevChar = i > 0 ? param[i - 1] : "";

        if ((char === "\"" || char === "'"
        ) && prevChar !== "\\") {
            if (!inString) {
                inString = true;
                stringChar = char;
            } else if (char === stringChar) {
                inString = false;
            }
        }

        if (!inString) {
            if (char === "(" || char === "{" || char === "<") depth++;
            else if (char === ")" || char === "}" || char === ">") depth--;
            else if (char === ":" && depth === 0) {
                colonIndex = i;
                break;
            }
        }
    }

    if (colonIndex === -1) {
        return { name : param, optional : false, type : "" };
    }

    const namePart = param.substring(0, colonIndex).trim();
    const typePart = param.substring(colonIndex + 1).trim();

    // Check if parameter is optional
    const optional = namePart.endsWith("?");
    const name = optional ? namePart.slice(0, -1).trim() : namePart;

    return { name, optional, type : typePart };
};

/** ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
 * Parses and formats inline object types
 * @param {string} objectType - The object type string
 * @param {string} baseIndent - Base indentation
 * @returns {string[]} Formatted lines
 */
const parseInlineObject = (objectType, baseIndent) => {
    // For inline objects in parameters, format them on multiple lines
    const lines = [];

    // Find the opening brace
    const braceIndex = objectType.indexOf("{");
    if (braceIndex === -1) {
        return [objectType];
    }

    const beforeBrace = objectType.substring(0, braceIndex).trim();
    const afterBrace = objectType.substring(braceIndex);

    // Extract object content
    const objectContent = afterBrace.substring(1, afterBrace.lastIndexOf("}")).trim();
    const afterObject = afterBrace.substring(afterBrace.lastIndexOf("}") + 1);

    if (!objectContent) {
        return [objectType];
    }

    // First line with opening brace
    lines.push(beforeBrace + " {");

    // Parse object properties
    const properties = [];
    let currentProp = "";
    let depth = 0;

    for (let i = 0; i < objectContent.length; i++) {
        const char = objectContent[i];

        if (char === "{" || char === "(" || char === "<") depth++;
        else if (char === "}" || char === ")" || char === ">") depth--;

        if ((char === ";" || char === ","
        ) && depth === 0) {
            if (currentProp.trim()) {
                properties.push(currentProp.trim() + char);
            }
            currentProp = "";
        } else {
            currentProp += char;
        }
    }

    if (currentProp.trim()) {
        properties.push(currentProp.trim());
    }

    // Format each property with proper indentation
    const propIndent = baseIndent + "        ";
    for (const prop of properties) {
        lines.push(propIndent + prop);
    }

    // Closing brace
    lines.push(baseIndent + "    }" + afterObject);

    return lines;
};

/** ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
 * Formats method signatures with proper parameter alignment and trailing commas.
 * @param {string[]} methodLines - The lines of the method signature
 * @param {string} propertyIndent - The base indentation for the method
 * @param {string} alignedFirstLine - The first line with proper key alignment
 * @returns {string[]} The formatted method lines
 */
const formatMethodSignature = (methodLines, propertyIndent, alignedFirstLine) => {
    const formattedLines = [];

    // Always format methods with multi-line parameters for consistency
    // Even single-line methods should be expanded
    
    // For single-line methods, force multi-line format
    if (methodLines.length === 1) {
        // Extract everything we need from the single line
        const singleLine = methodLines[0];
        // The alignedFirstLine already has the proper formatting up to the colon
    }


    // Extract the aligned method name part from the first line
    const colonIndex = alignedFirstLine.indexOf(" : ");
    if (colonIndex === -1) {
        // Fallback: just indent properly
        formattedLines.push(alignedFirstLine);
        for (let i = 1; i < methodLines.length; i++) {
            formattedLines.push(propertyIndent + "    " + methodLines[i].trim());
        }
        return formattedLines;
    }

    const methodNamePart = alignedFirstLine.substring(0, colonIndex);

    // Combine all lines and normalize whitespace
    const fullSignature = methodLines.map(line => line.trim()).join(" ").replace(/\s+/g, " ");

    // Extract the signature part after the key
    const signatureMatch = fullSignature.match(/:\s*(.+)$/);
    if (!signatureMatch) {
        return methodLines.map((line, i) =>
            i === 0 ? alignedFirstLine : propertyIndent + "    " + line.trim(),
        );
    }

    const signature = signatureMatch[1];

    // Find opening parenthesis
    const openParenIndex = signature.indexOf("(");
    if (openParenIndex === -1) {
        // Not a method signature
        return methodLines.map((line, i) =>
            i === 0 ? alignedFirstLine : propertyIndent + "    " + line.trim(),
        );
    }

    // Extract method name/generics and the rest
    const methodPrefix = signature.substring(0, openParenIndex);

    // Find the matching closing parenthesis
    let parenDepth = 0;
    let closeParenIndex = -1;
    for (let i = openParenIndex; i < signature.length; i++) {
        if (signature[i] === "(") parenDepth++;
        else if (signature[i] === ")") {
            parenDepth--;
            if (parenDepth === 0) {
                closeParenIndex = i;
                break;
            }
        }
    }

    if (closeParenIndex === -1) {
        // Malformed signature
        return methodLines.map((line, i) =>
            i === 0 ? alignedFirstLine : propertyIndent + "    " + line.trim(),
        );
    }

    const parametersStr = signature.substring(openParenIndex + 1, closeParenIndex);
    const returnType = signature.substring(closeParenIndex + 1);

    // Start building the formatted output - add space before opening paren
    // Handle generic parameters properly
    const genericMatch = methodPrefix.match(/^(.+?)(<.+>)$/);
    if (genericMatch) {
        formattedLines.push(`${methodNamePart} : ${genericMatch[1]}${genericMatch[2]} (`);
    } else {
        formattedLines.push(`${methodNamePart} : ${methodPrefix} (`);
    }

    // Parse and format parameters
    if (parametersStr.trim()) {
        const parameters = parseParameters(parametersStr);
        const paramIndent = propertyIndent + "    ";

        // Calculate max lengths for alignment
        let maxParamLength = 0;
        let hasOptional = false;

        for (const param of parameters) {
            maxParamLength = Math.max(maxParamLength, param.name.length);
            if (param.optional) hasOptional = true;
        }

        // Format each parameter
        parameters.forEach((param, index) => {
            let line = paramIndent + param.name.padEnd(maxParamLength);

            if (hasOptional) {
                line += param.optional ? " ?" : "  ";
            }

            line += " : " + param.type;

            // Check if parameter type contains an inline object
            if (param.type.includes("{") && param.type.includes("}")) {
                // Format inline object types
                const braceIndex = param.type.indexOf("{");
                const beforeBrace = param.type.substring(0, braceIndex).trim();
                const objectContent = param.type.substring(braceIndex);

                // Extract properties from the inline object
                const objMatch = objectContent.match(/^\{(.+)\}(.*)$/);
                if (objMatch) {
                    const props = objMatch[1].trim();
                    const afterObj = objMatch[2];

                    // Add the parameter line with opening brace
                    formattedLines.push(line.substring(0, line.lastIndexOf(":") + 1) + " " + beforeBrace + " {");

                    // Parse and format object properties
                    const objPropIndent = paramIndent + "        ";
                    const properties = props.split(/[;,]/).filter(p => p.trim());

                    // Calculate alignment for object properties
                    let maxPropLength = 0;
                    const parsedProps = [];

                    for (const prop of properties) {
                        const colonIdx = prop.indexOf(":");
                        if (colonIdx > 0) {
                            const propName = prop.substring(0, colonIdx).trim();
                            const propType = prop.substring(colonIdx + 1).trim();
                            maxPropLength = Math.max(maxPropLength, propName.length);
                            parsedProps.push({ name : propName, type : propType });
                        }
                    }

                    // Format object properties with alignment
                    parsedProps.forEach((prop, propIndex) => {
                        const isLastProp = propIndex === parsedProps.length - 1;
                        formattedLines.push(
                            `${objPropIndent}${prop.name.padEnd(maxPropLength)} : ${prop.type}${isLastProp ? "" : ";"}`,
                        );
                    });

                    // Close the object
                    formattedLines.push(`${paramIndent}    }${afterObj}${index < parameters.length - 1 ? "," : ""}`);
                } else {
                    // Fallback for complex cases
                    formattedLines.push(line + (index < parameters.length - 1 ? "," : ""
                    ));
                }
            } else {
                // Regular parameter without inline object
                formattedLines.push(line + (index < parameters.length - 1 ? "," : ""
                ));
            }
        });
    }

    // Close parentheses and add return type
    formattedLines.push(`${propertyIndent})${returnType}`);

    return formattedLines;
};

/** ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
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

    // First, split lines that contain multiple semicolon-separated properties
    const expandedLines = [];
    for (const line of blockContentLines) {
        if (line.trim() === "") {
            expandedLines.push(line);
            continue;
        }

        // Check if line contains multiple properties separated by semicolons
        // Only split if we're not inside braces/parens and there are multiple semicolons
        const trimmedLine = line.trim();
        if (trimmedLine.includes(";") && !trimmedLine.startsWith("//") && !trimmedLine.startsWith("/*")) {
            // Check if semicolons are inside braces - if so, don't split
            let braceDepth = 0;
            let shouldSplit = false;

            for (let j = 0; j < trimmedLine.length; j++) {
                const char = trimmedLine[j];
                if (char === "{") braceDepth++;
                else if (char === "}") braceDepth--;
                else if (char === ";" && braceDepth === 0) {
                    // Found a semicolon outside of braces
                    shouldSplit = true;
                    break;
                }
            }

            if (shouldSplit) {
                // Split by semicolon but preserve the base indentation
                const baseIndent = (line.match(/^\s*/) || [""]
                )[0];
                const parts = [];
                let currentPart = "";
                let braceDepth = 0;

                for (let j = 0; j < trimmedLine.length; j++) {
                    const char = trimmedLine[j];
                    currentPart += char;

                    if (char === "{") braceDepth++;
                    else if (char === "}") braceDepth--;
                    else if (char === ";" && braceDepth === 0) {
                        parts.push(currentPart);
                        currentPart = "";
                    }
                }

                if (currentPart.trim()) {
                    parts.push(currentPart);
                }

                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i].trim();
                    if (part) {
                        expandedLines.push(baseIndent + part);
                    }
                }
            } else {
                expandedLines.push(line);
            }
        } else {
            expandedLines.push(line);
        }
    }

    // Delimit properties, correctly handling multi-line nested objects and function signatures.
    for (const line of expandedLines) {
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
    for (let propIndex = 0; propIndex < properties.length; propIndex++) {
        const prop = properties[propIndex];
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

        // Check if this is a method (contains parentheses)
        const isMethod = value.includes("(") || (prop.length > 1 && prop.some(line => line.includes("(")));

        // Add spacing before methods (except the first property)
        if (isMethod && propIndex > 0 && formattedLines.length > 0) {
            formattedLines.push("");
        }
        const paddedKey = key.padEnd(maxKeyLength);
        // For methods, we need to add space before the parenthesis
        let formattedValue = value;
        if (isMethod) {
            // Add space before opening parenthesis if not already present
            formattedValue = value.replace(/(\S)\(/, '$1 (');
        }
        
        const alignedFirstLine = `${propertyIndent}${paddedKey}${hasOptional ? (optional ? " ?" : "  "
        ) : ""} : ${formattedValue}`;

        if (isMethod) {
            // Always use method formatter for methods
            const methodFormattedLines = formatMethodSignature(prop, propertyIndent, alignedFirstLine);
            formattedLines.push(...methodFormattedLines);
        } else if (prop.length === 1) {
            formattedLines.push(alignedFirstLine);
        } else {
            // This is a multi-line property.
            const openingBraceIndex = value.lastIndexOf("{");

            if (openingBraceIndex === -1) {
                // This is not a nested object, but a multi-line signature or other construct.
                // Use the method signature formatter
                const methodFormattedLines = formatMethodSignature(prop, propertyIndent, alignedFirstLine);
                formattedLines.push(...methodFormattedLines);
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


/** ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
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

/** ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
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
        const { importStatements, linesToRemove : importLinesToRemove } = extractImports(originalCode, config);

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
        const newImportLines = importStatements.length > 0 ? groupAndFormatImports(importStatements, config) : [];

        // Step 4: Get the formatted interface blocks
        const formattedInterfaceBlocks = interfaceBlocks.length > 0 ? formatInterfaceBlocks(interfaceBlocks, lines) : [];

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

// Main execution //////////////////////////////////////////////////////////////////////////////////////////////////////
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
