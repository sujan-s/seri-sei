
<div align="center" style="margin-top: 20px; margin-bottom: 20px;">
    <div align="center" style="margin-bottom: -32px;">
        <img
            src="https://s3.ap-south-1.amazonaws.com/sujansundareswaran.com/images-cdn/serisei-logo.svg"
            alt="Seri Sei logo"
            width="240"
        />
    </div>

# Seri Sei

### 🎯 A very opinionated pseudo-formatter that brings order to your imports and type definitions

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## ✨ Features

- 📦 **Smart import organization** - Automatically groups and sorts imports by category
- 🎨 **Type/interface formatting** - Aligns properties beautifully in type and interface declarations
- ⚙️ **Configurable** - Customize groups, headers, and formatting via `.seriseirc` files
- 🔍 **Config discovery** - Searches upward from file location to find configuration
- 🚀 **Atomic file writes** - Prevents conflicts with IDEs and other tools
- 📐 **Multi-line support** - Handles complex multi-line imports and nested type definitions

## 🚀 Quick start

```bash
# Format a single file
node serisei-formatter.js path/to/your/file.ts

# Or make it executable
chmod +x serisei-formatter.js
./serisei-formatter.js path/to/your/file.ts
```

## 📋 What it does

### Before:
```javascript
import React from "react";
import { Button } from "./components/Button";
import axios from "axios";
import { UserContext } from "./contexts/UserContext";
import { formatDate } from "./utils/date";

interface User {
name: string;
email: string;
id: number;
isActive?: boolean;
}
```

### After:
```javascript
// EXTERNAL =================================================================
import axios from "axios";
import React from "react";

// CONTEXTS =================================================================
import { UserContext } from "./contexts/UserContext";

// COMPONENTS ===============================================================
import { Button } from "./components/Button";

// UTILS ====================================================================
import { formatDate } from "./utils/date";

interface User {
    name       : string;
    email      : string;
    id         : number;
    isActive ? : boolean;
}
```

## ⚙️ Configuration

Create a `.seriseirc` file in your project root or any parent directory:

```ini
# Header configuration
HEADER_CHAR = =
TO_COLUMN_WIDTH = 120

# Import groups
[groups]
external = "react", 'react', next/, axios, tanstack, vite
internal = @mycompany/, @internal/
components = components/, ui/
utils = utils/, helpers/
types = types/, typings/, .d.ts
styles = styles/, .css, .scss
```

### Default groups

If no configuration is found, Serisei uses these default groups:

- **EXTERNAL** - Third-party packages (React, Next.js, etc.)
- **CONTEXTS** - React contexts
- **COMPONENTS** - Component imports
- **CONFIGS** - Configuration files
- **LIB** - Library code
- **LOGIC** - Business logic
- **DATA** - Mock data and fixtures
- **HOOKS** - React hooks
- **STORES** - State management
- **SERVICES** - API services
- **STYLES** - Stylesheets
- **TYPES** - TypeScript types
- **UTILS** - Utility functions
- **ASSETS** - Images, fonts, etc.
- **OTHER** - Everything else

## 🎯 Advanced features

### Type and interface formatting

Serisei intelligently formats TypeScript types and interfaces:

```typescript
// Before, messy AF
interface Project {
    id: string;
    name: string;
    description: string;
    startDate: Date;
    endDate?: Date;
    status: 'active' | 'completed' | 'on-hold' | 'cancelled';
    team: TeamMember[];
    budget: number;
    resources: Resource[];
    dependencies: ProjectDependency[];
    risks?: RiskAssessment[];
    milestones: Milestone[];
    deliverables: boolean;
    metrics?: MetricConfig;
    reporting: ReportFrequency;
    approval: { approved: boolean;
        approver: string; date: Date };
    changeControl: ChangeRequest[];
    communication: CommunicationPlan;
}

// After, you get a good night’s sleep
interface Project {
    id              : string;
    name            : string;
    description     : string;
    startDate       : Date;
    endDate       ? : Date;
    status          : 'active' | 'completed' | 'on-hold' | 'cancelled';
    team            : TeamMember[];
    budget          : number;
    resources       : Resource[];
    dependencies    : ProjectDependency[];
    risks         ? : RiskAssessment[];
    milestones      : Milestone[];
    deliverables    : boolean;
    metrics       ? : MetricConfig;
    reporting       : ReportFrequency;
    approval        : {
        approved : boolean;
        approver : string;
        date     : Date
    };
    changeControl   : ChangeRequest[];
    communication   : CommunicationPlan;
}
```

### Multi-line import support

Handles complex imports gracefully:

```javascript
// Properly formats multi-line imports
import {
    Component1,
    Component2,
    Component3,
    Component4
} from "@really/long/package/name/that/needs/multiple/lines";
```

### Nested object formatting

```typescript
type UserPreferences = {
    theme           : {
        primary   : string;
        secondary : string;
        mode      : "light" | "dark";
    };
    notifications ? : {
        email   : boolean;
        push    : boolean;
        sms   ? : boolean;
    };
};
```

## 🔧 How it works

1. **Config discovery** - Searches upward from the file location for `.seriseirc`
2. **Import extraction** - Identifies and extracts all import statements
3. **Grouping** - Categorizes imports based on matchers
4. **Sorting** - Sorts imports alphabetically within groups
5. **Header generation** - Creates visual separators for each group
6. **Type formatting** - Aligns properties in types and interfaces
7. **Atomic write** - Safely writes changes back to the file

## 🎨 Customization

### Custom import groups

Define your own import categories:

```ini
[groups]
# Company-specific packages
// Company = @acme/, @internal/

# Feature modules
// Features = features/, modules/

# Third-party UI libraries
// UI-libs = @mui/, @chakra-ui/, antd

# Testing
// Testing = __tests__/, .test., .spec., jest, vitest
```

### Header customization

```ini
# Use different characters for headers
HEADER_CHAR = -
TO_COLUMN_WIDTH = 60

# Results in:
# EXTERNAL ------------------------------------------------
```

## 🛠️ Installation and setup

### Global installation

```bash
# Clone the repository
git clone https://github.com/sujan-s/serisei-formatter.git
cd serisei-formatter

# On MacOS and Linux, make the script executable
chmod +x formatter.js

# Make the command globally available
npm link

# Now use it anywhere
serisei path/to/file.js
```

### Project integration

In your `package.json`
```json
{
    "scripts": {
        "serisei:all": "find src -name '*.ts' -o -name '*.tsx' | xargs -I {} serisei {}"
    }
}
```

## 🔌 Editor integration

### VSCode

Add to `.vscode/tasks.json`:

```json
{
    "version" : "2.0.0",
    "tasks"   : [
        {
            "label"          : "Format with Serisei",
            "type"           : "shell",
            "command"        : "serisei",
            "args"           : [
                "${file}"
            ],
            "presentation"   : {
                "reveal" : "silent"
            },
            "problemMatcher" : []
        }
    ]
}
```

### Pre-commit hook

```bash
#!/bin/sh
# .git/hooks/pre-commit

# Get a list of staged files that are JS/TS
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|ts|jsx|tsx)$')

# If there are no staged JS/TS files, exit
if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# Run Serisei on each staged file
echo "$STAGED_FILES" | xargs -I {} serisei {}

# Re-add the formatted files to the commit
echo "$STAGED_FILES" | xargs git add

exit 0
```
---

<div align="center">

### Made with ❤️ by

![Your Logo](your-logo.svg)

</div> | while read file; do
  node ./serisei-formatter.js "$file"
  git add "$file"
done
```

## 🐛 Troubleshooting

### Common issues

**File not updating?**
- Check file permissions
- Ensure no other process is locking the file
- The formatter uses atomic writes, so it may retry on busy files

**Configuration not found?**
- The formatter searches upward from the file location
- Ensure `.seriseirc` is in the file path or a parent directory
- Check for syntax errors in your config file

**Imports not grouping correctly?**
- Matchers are case-sensitive
- Use quotes around matchers with special characters
- The first matching group wins

## 📚 Complete configuration example

```ini
# ===========================================
# Serisei Formatter Configuration
# ===========================================

# Header Settings
# The character used to fill header lines
HEADER_CHAR = =

# Total width of header lines
TO_COLUMN_WIDTH = 120

# Import Groups
# Define custom groups and their matchers
# Format: group_name = matcher1, matcher2, "matcher with spaces"
[groups]

# External packages (npm/yarn packages)
external = "react", 'react', react-, next/, @next/, vue, @vue/, angular, express, axios, lodash, moment, date-fns

# Internal company packages
internal = @company/, @internal/, @shared/, @common/

# UI libraries and components
ui = @mui/, @material-ui/, @chakra-ui/, antd, @ant-design/, bootstrap, tailwind

# State management
state = redux, @reduxjs/, mobx, zustand, recoil, jotai, valtio

# Build tools and dev dependencies
build = webpack, vite, rollup, esbuild, @babel/, eslint, prettier, jest, @testing-library/

# Routing
routing = react-router, @reach/router, wouter, next/router, next/navigation

# API and data fetching
api = axios, fetch, swr, @tanstack/react-query, apollo, graphql

# React ecosystem
react = react, prop-types, react-dom, @types/react

# Contexts (React Context API)
contexts = contexts/, context/, providers/

# Components
components = components/, ui/, elements/, widgets/

# Pages/views
pages = pages/, views/, screens/, routes/

# Hooks
hooks = hooks/, use

# Utils and helpers
utils = utils/, utilities/, helpers/, lib/

# Services and API
services = services/, api/, endpoints/

# Store/state
store = store/, stores/, state/, redux/

# Styles
styles = styles/, .css, .scss, .sass, .less, styled-components, @emotion/

# Types and interfaces
types = types/, typing/, @types/, interfaces/, .d.ts

# Assets
assets = assets/, images/, fonts/, icons/, public/

# Configuration
config = config/, .config, settings/

# Tests
tests = __tests__/, .test., .spec., test/, tests/, testing/

# Other (catch-all - must be last)
other = 
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a PR.

## 📝 License

MIT. Have at it.

---

### Made with ❤️ by
<div>
    <a href="https://sujansundareswaran.com/" target="_blank">
        <img
            src="https://s3.ap-south-1.amazonaws.com/sujansundareswaran.com/images-cdn/sujan-logo.svg"
            alt="Sujan logo"
            width="64"
        />
    </a>
</div>
