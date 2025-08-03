const { getIndentString } = require("./indent");
const { formatMethodSignature } = require("./method-formatter");

/**
 * Formats interface blocks using AST nodes.
 * @param {Array<{node: object, startLine: number, endLine: number}>} interfaceBlocks - Array of interface block data
 * @param {string[]} originalLines - The original file lines
 * @param {object} config - Configuration object
 * @returns {Array<{startLine: number, endLine: number, formattedLines: string[]}>} Formatted interface blocks
 */
const formatInterfaceBlocks = (interfaceBlocks, originalLines, config) => {
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

        // Check if this is a union type (has = followed by | on next line or same line)
        let isUnionType = false;
        for (let i = 0; i < blockLines.length; i++) {
            if (blockLines[i].includes("=") && i < blockLines.length - 1 && blockLines[i + 1].trim().startsWith("|")) {
                isUnionType = true;
                break;
            }
            if (blockLines[i].match(/=\s*\|/)) {
                isUnionType = true;
                break;
            }
        }

        // If no opening brace found, this might be a simple type alias or union type
        if (braceLineIndex === -1) {
            if (isUnionType) {
                // Handle union types specially
                const formattedUnion = formatUnionType(blockLines, baseIndent, config);
                formattedBlocks.push({
                    startLine,
                    endLine,
                    formattedLines : formattedUnion,
                });
            } else {
                // For type aliases without braces, just keep the original formatting
                formattedBlocks.push({
                    startLine,
                    endLine,
                    formattedLines : blockLines,
                });
            }
            continue;
        }

        // Check if this is a single-line block (opening and closing brace on same line)
        const isSingleLineBlock = blockLines.length === 1 &&
            blockLines[0].includes("{") &&
            blockLines[0].includes("}");

        if (isUnionType) {
            // Handle union types specially
            const formattedUnion = formatUnionType(blockLines, baseIndent, config);
            formattedBlocks.push({
                startLine,
                endLine,
                formattedLines : formattedUnion,
            });
            continue;
        }

        if (isSingleLineBlock) {
            // For single-line blocks, we should expand them
            const formattedSingleLine = formatSingleLineBlock(blockLines[0], baseIndent, config);
            formattedBlocks.push({
                startLine,
                endLine,
                formattedLines : formattedSingleLine,
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
                blockContent.push(baseIndent + getIndentString(config) + afterBrace);
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
                    blockContent.push(baseIndent + getIndentString(config) + beforeBrace);
                    foundContent = true;
                }
            }
        }

        // Format the block content
        let formattedContent = [];
        if (foundContent && blockContent.some(line => line.trim() !== "")) {
            formattedContent = formatBlockContent(blockContent, baseIndent, config);
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

/**
 * Recursively formats the content of a type or interface block.
 * @param {string[]} blockContentLines - The lines of code inside the { ... } block.
 * @param {string} baseIndent - The base indentation of the parent block.
 * @param {object} config - Configuration object
 * @returns {string[]} The formatted lines of code.
 */
const formatBlockContent = (blockContentLines, baseIndent, config = {}) => {
    // Check if this is a union type by looking for lines starting with |
    const isUnionType = blockContentLines.some(line => line.trim().startsWith("|"));

    if (isUnionType) {
        // For union types, preserve the structure but apply consistent formatting
        const formattedLines = [];
        const propertyIndent = baseIndent + getIndentString(config);

        for (const line of blockContentLines) {
            const trimmed = line.trim();
            if (trimmed === "") continue;

            // Preserve union type lines with proper indentation
            formattedLines.push(propertyIndent + trimmed);
        }

        return formattedLines;
    }

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

    const propertyIndent = baseIndent + getIndentString(config);
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

        // Match both regular properties and method signatures
        // For methods: name(params): type
        // For properties: name: type
        // Need to handle nested parentheses in parameters
        let match = null;

        // First try to match as a method with parentheses
        const methodMatch = trimmedFirstLine.match(/^([\w$]+(?:<[^>]+>)?)\s*\(/);
        if (methodMatch) {
            // This is a method, extract name and find the matching closing paren
            const methodName = methodMatch[1];
            let parenDepth = 0;
            let closingParenIndex = -1;

            for (let i = methodMatch[0].length - 1; i < trimmedFirstLine.length; i++) {
                if (trimmedFirstLine[i] === "(") parenDepth++;
                else if (trimmedFirstLine[i] === ")") {
                    parenDepth--;
                    if (parenDepth === 0) {
                        closingParenIndex = i;
                        break;
                    }
                }
            }

            if (closingParenIndex !== -1) {
                const params = trimmedFirstLine.substring(methodMatch[0].length - 1, closingParenIndex + 1);
                const rest = trimmedFirstLine.substring(closingParenIndex + 1);
                const typeMatch = rest.match(/^\s*:\s*(.*)$/);
                if (typeMatch) {
                    match = [trimmedFirstLine, methodName, params, null, typeMatch[1]];
                }
            }
        } else {
            // Try to match as a property
            match = trimmedFirstLine.match(/^([\w$]+(?:<[^>]+>)?)\s*(\?)?\s*:\s*(.*)$/);
            if (match) {
                // Reformat to match expected structure: [full, name, params, optional, type]
                match = [match[0], match[1], null, match[2], match[3]];
            }
        }

        if (!match) {
            // Should not happen often with the new property splitter, but as a fallback:
            formattedLines.push(...prop.map(l => propertyIndent + l.trim()));
            continue;
        }

        const [, key, params, optional, value] = match;

        // For methods, include the params in the value
        const fullValue = params ? params + " : " + value : value;

        // Check if this is a method (has params)
        // Force all methods to be formatted as multi-line
        const isMethod = !!params;

        // Add spacing before methods (except the first property)
        if (isMethod && propIndex > 0 && formattedLines.length > 0) {
            formattedLines.push("");
        }
        const paddedKey = key.padEnd(maxKeyLength);
        // For methods, format differently than properties
        let alignedFirstLine;
        if (isMethod && params) {
            // Methods: name (params): returnType
            const methodWithSpace = params.replace(/^\(/, " (");
            alignedFirstLine = `${propertyIndent}${paddedKey}${methodWithSpace}: ${value}`;
        } else {
            // Properties: name : type
            alignedFirstLine = `${propertyIndent}${paddedKey}${hasOptional ? (optional ? " ?" : "  "
            ) : ""} : ${fullValue}`;
        }

        if (isMethod) {
            // Always use method formatter for methods
            const methodFormattedLines = formatMethodSignature(prop, propertyIndent, alignedFirstLine, config);
            formattedLines.push(...methodFormattedLines);
        } else if (prop.length === 1) {
            formattedLines.push(alignedFirstLine);
        } else {
            // This is a multi-line property.
            const openingBraceIndex = value.lastIndexOf("{");

            if (openingBraceIndex === -1) {
                // This is not a nested object, but a multi-line signature or other construct.
                // Use the method signature formatter
                const methodFormattedLines = formatMethodSignature(prop, propertyIndent, alignedFirstLine, config);
                formattedLines.push(...methodFormattedLines);
            } else {
                // This is a nested object. Format it recursively.
                const firstLineHeader = alignedFirstLine.substring(0, alignedFirstLine.lastIndexOf("{") + 1);
                formattedLines.push(firstLineHeader);

                const nestedContent = prop.slice(1, -1);
                if (nestedContent.length > 0) {
                    const formattedNestedContent = formatBlockContent(nestedContent, propertyIndent, config);
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
 * Formats a union type definition
 */
const formatUnionType = (blockLines, baseIndent, config) => {
    const indent = getIndentString(config);
    const formattedLines = [];

    // Find the line with the equals sign
    let equalsLineIndex = -1;
    for (let i = 0; i < blockLines.length; i++) {
        if (blockLines[i].includes("=")) {
            equalsLineIndex = i;
            break;
        }
    }

    // Add the type declaration line
    formattedLines.push(blockLines[equalsLineIndex]);

    // Process union members
    for (let i = equalsLineIndex + 1; i < blockLines.length; i++) {
        const line = blockLines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith("|")) {
            // This is a union member
            const content = trimmed.substring(1).trim();

            // Check if it's a single-line object type
            if (content.includes("{") && content.includes("}")) {
                // Extract the comment if any
                const commentMatch = content.match(/^(.+?)(\/\/.*)$/);
                const objectPart = commentMatch ? commentMatch[1].trim() : content;
                const comment = commentMatch ? commentMatch[2] : "";

                // Extract properties and format them
                const props = extractPropertiesFromLine(objectPart);

                formattedLines.push(baseIndent + indent + "| {");
                for (const prop of props) {
                    formattedLines.push(baseIndent + indent + indent + prop);
                }

                // Just close the current member
                formattedLines.push(baseIndent + indent + "}" + (comment ? " " + comment : ""
                ));
            } else {
                formattedLines.push(baseIndent + indent + trimmed);
            }
        } else if (trimmed !== "") {
            formattedLines.push(line);
        }
    }

    return formattedLines;
};

/**
 * Formats a single-line block into multi-line format
 */
const formatSingleLineBlock = (line, baseIndent, config) => {
    const indent = getIndentString(config);
    const match = line.match(/^(.+?{)\s*(.+?)\s*}(.*)$/);

    if (!match) {
        return [line];
    }

    const [, prefix, content, suffix] = match;
    const props = extractPropertiesFromLine("{" + content + "}");

    const formattedLines = [prefix];
    for (const prop of props) {
        formattedLines.push(baseIndent + indent + prop);
    }
    formattedLines.push(baseIndent + "}" + suffix);

    return formattedLines;
};

/**
 * Extracts properties from a single-line object type definition
 */
const extractPropertiesFromLine = (content) => {
    // Remove outer braces
    const inner = content.slice(1, -1).trim();
    const props = [];

    // Split by semicolon or comma
    const parts = inner.split(/[;,]/).filter(p => p.trim());

    // Find max property name length for alignment
    let maxNameLength = 0;
    const parsedProps = [];

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        // Match property pattern: name?: type or name: type
        const match = trimmed.match(/^(\w+)(\s*\?)?\s*:\s*(.+)$/);
        if (match) {
            const [, name, optional, type] = match;
            maxNameLength = Math.max(maxNameLength, name.length);
            parsedProps.push({ name, optional : !!optional, type : type.trim() });
        }
    }

    // Format with alignment
    for (const prop of parsedProps) {
        const paddedName = prop.name.padEnd(maxNameLength);
        if (prop.optional) {
            props.push(`${paddedName} ? : ${prop.type};`);
        } else {
            props.push(`${paddedName}   : ${prop.type};`);
        }
    }

    return props;
};

module.exports = {
    formatInterfaceBlocks,
    formatBlockContent,
};