const { getIndentString } = require("./indent");

/**
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

/**
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

/**
 * Parses and formats inline object types
 * @param {string} objectType - The object type string
 * @param {string} baseIndent - Base indentation
 * @param {object} config - Configuration object
 * @returns {string[]} Formatted lines
 */
const parseInlineObject = (objectType, baseIndent, config) => {
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
    const propIndent = baseIndent + getIndentString(config) + getIndentString(config);
    for (const prop of properties) {
        lines.push(propIndent + prop);
    }

    // Closing brace
    lines.push(baseIndent + getIndentString(config) + "}" + afterObject);

    return lines;
};

/**
 * Formats method signatures with proper parameter alignment and trailing commas.
 * @param {string[]} methodLines - The lines of the method signature
 * @param {string} propertyIndent - The base indentation for the method
 * @param {string} alignedFirstLine - The first line with proper key alignment
 * @param {object} config - Configuration object
 * @returns {string[]} The formatted method lines
 */
const formatMethodSignature = (methodLines, propertyIndent, alignedFirstLine, config = {}) => {
    const formattedLines = [];

    // Always format methods with multi-line parameters for consistency
    // All methods should be expanded to multi-line format when EXPAND_METHODS is true
    const shouldExpand = config.EXPAND_METHODS !== false; // Default to true

    // Extract the aligned method name part from the first line
    const colonIndex = alignedFirstLine.indexOf(":");
    if (colonIndex === -1) {
        // Fallback: just indent properly
        formattedLines.push(alignedFirstLine);
        for (let i = 1; i < methodLines.length; i++) {
            formattedLines.push(propertyIndent + getIndentString(config) + methodLines[i].trim());
        }
        return formattedLines;
    }

    // Extract the method name part (everything before the parenthesis)
    const methodNameMatch = alignedFirstLine.match(/^(\s*\w+(?:<[^>]+>)?)\s*\(/);
    if (!methodNameMatch) {
        // Fallback if pattern doesn't match
        return [alignedFirstLine];
    }

    const methodIndentAndName = methodNameMatch[1];
    const methodIndent = methodIndentAndName.match(/^\s*/)[0]; // Extract just the indent

    // Extract the full signature from the original line
    const fullSignature = methodLines[0].trim();

    // Find the parameters and return type
    const signatureMatch = fullSignature.match(/\(([^)]*)\)\s*:\s*(.+)$/);
    if (!signatureMatch) {
        return [alignedFirstLine];
    }

    const [, paramsContent, returnTypeWithSemi] = signatureMatch;
    const returnType = returnTypeWithSemi.replace(/;$/, "");

    // Start building the formatted output  
    // Extract just the method name without the existing indentation
    const methodName = methodIndentAndName.trim();
    formattedLines.push(`${propertyIndent}${methodName} (`);

    // Parse and format parameters
    if (paramsContent.trim()) {
        const parameters = parseParameters(paramsContent);

        // If we have parameters and should expand, or if already multi-line, format them
        if ((parameters.length > 0 && shouldExpand
        ) || methodLines.length > 1) {
            // Parameters should be indented properly (property indent + one more level)
            const paramIndent = propertyIndent + getIndentString(config);

            // Calculate max lengths for alignment
            let maxParamLength = 0;
            let hasOptional = false;

            for (const param of parameters) {
                maxParamLength = Math.max(maxParamLength, param.name.length);
                if (param.optional) hasOptional = true;
            }

            // Format each parameter with proper alignment
            parameters.forEach((param, index) => {
                let line = paramIndent + param.name.padEnd(maxParamLength);

                if (hasOptional) {
                    line += " " + (param.optional ? "?" : " "
                    );
                }

                // Don't add the type yet if it's an inline object

                // Check if parameter type contains an inline object
                if (param.type.includes("{") && param.type.includes("}")) {
                    // Format inline object types
                    const braceIndex = param.type.indexOf("{");
                    const beforeBrace = param.type.substring(0, braceIndex).trim();
                    const afterBraceIndex = param.type.lastIndexOf("}");
                    const objectContent = param.type.substring(braceIndex + 1, afterBraceIndex).trim();
                    const afterObject = param.type.substring(afterBraceIndex + 1).trim();

                    if (objectContent) {
                        // Add the parameter line with opening brace
                        // Build the line with just the parameter name and optional marker
                        if (beforeBrace) {
                            formattedLines.push(line + " : " + beforeBrace + " {");
                        } else {
                            formattedLines.push(line + " : {");
                        }

                        // Parse and format object properties
                        // Object properties should be indented one level from the brace
                        const objPropIndent = paramIndent + getIndentString(config);
                        const properties = objectContent.split(/[;,]/).filter(p => p.trim());

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
                        formattedLines.push(`${paramIndent}}${afterObject}${index < parameters.length - 1 ? "," : ""}`);
                    } else {
                        // Fallback for complex cases
                        formattedLines.push(line + (index < parameters.length - 1 ? "," : ""
                        ));
                    }
                } else {
                    // Regular parameter without inline object
                    line += " : " + param.type;
                    formattedLines.push(line + (index < parameters.length - 1 ? "," : ""
                    ));
                }
            });
        } else {
            // Keep single-line format if not expanding
            formattedLines[0] = alignedFirstLine;
            return formattedLines;
        }
    }

    // Close parentheses and add return type
    formattedLines.push(`${propertyIndent}): ${returnType};`);

    return formattedLines;
};

module.exports = {
    parseParameters,
    parseParameter,
    parseInlineObject,
    formatMethodSignature,
};