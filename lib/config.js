const fs = require("fs");
const path = require("path");

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
        EXPAND_METHODS  : true,  // Always expand methods to multi-line format
        INDENT_TYPE     : "spaces", // "spaces" | "tabs"
        INDENT_SIZE     : 4,        // number of spaces (ignored if tabs)
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
                } else if (key === "EXPAND_METHODS") {
                    config.EXPAND_METHODS = value.toLowerCase() === "true";
                } else if (key === "INDENT_TYPE") {
                    config.INDENT_TYPE = (value === "tabs" || value === "spaces"
                    ) ? value : defaultConfig.INDENT_TYPE;
                } else if (key === "INDENT_SIZE") {
                    config.INDENT_SIZE = parseInt(value, 10) || defaultConfig.INDENT_SIZE;
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

module.exports = {
    loadConfig,
};