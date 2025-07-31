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
    const fullSignature = methodLines.map(l => l.trim()).join(" ").replace(/\s+/g, " ");

    const keyMatch = fullSignature.match(/^([\w$]+(?:<[^>]+>)?)\s*:/);
    if (!keyMatch) {
        return [alignedFirstLine, ...methodLines.slice(1)];
    }
    const signatureOnly = fullSignature.substring(keyMatch[0].length).trim();

    if (!signatureOnly.startsWith("(")) {
        return [alignedFirstLine, ...methodLines.slice(1)];
    }

    let parenDepth = 0;
    let paramsEndIndex = -1;
    for (let i = 0; i < signatureOnly.length; i++) {
        const char = signatureOnly[i];
        if (char === "(") parenDepth++;
        else if (char === ")") {
            parenDepth--;
            if (parenDepth === 0) {
                paramsEndIndex = i;
                break;
            }
        }
    }

    if (paramsEndIndex === -1) {
        return [alignedFirstLine, ...methodLines.slice(1)];
    }

    const paramsContent = signatureOnly.substring(1, paramsEndIndex);
    const rest = signatureOnly.substring(paramsEndIndex + 1).trim();

    if (!rest.startsWith("=>")) {
        // Could be a regular method, for now, we just handle arrow functions.
        return [alignedFirstLine, ...methodLines.slice(1)];
    }

    const returnType = rest.substring(2).trim().replace(/;$/, "");

    const paddedKey = alignedFirstLine.match(/^(\s*.*?:)/)[0];
    formattedLines.push(`${paddedKey} (`);

    if (paramsContent.trim()) {
        const parameters = parseParameters(paramsContent);
        if (parameters.length > 0) {
            const paramIndent = propertyIndent + getIndentString(config);
            let maxParamLength = 0;
            let hasOptional = false;

            for (const param of parameters) {
                maxParamLength = Math.max(maxParamLength, param.name.length);
                if (param.optional) hasOptional = true;
            }

            parameters.forEach((param, index) => {
                let line = paramIndent + param.name.padEnd(maxParamLength);
                if (hasOptional) {
                    line += " " + (param.optional ? "?" : " "
                    );
                }
                line += " : " + param.type;
                if (index < parameters.length - 1 || (config.TRAILING_COMMA && parameters.length > 0
                )) {
                    line += ",";
                }
                formattedLines.push(line);
            });
        }
    }

    formattedLines.push(`${propertyIndent}) => ${returnType};`);

    return formattedLines;
};

module.exports = {
    parseParameters,
    parseParameter,
    parseInlineObject,
    formatMethodSignature,
};