# Contributing to PhotoCatalog

Thank you for your interest in contributing to PhotoCatalog! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/WeboSato/PhotoCatalog/issues)
2. If not, create a new issue with:
   - A clear, descriptive title
   - Steps to reproduce the bug
   - Expected vs actual behavior
   - Your environment (OS, Node version, etc.)
   - Screenshots if applicable

### Suggesting Features

1. Check existing issues for similar suggestions
2. Create a new issue with the "feature request" label
3. Describe the feature and its use case
4. Explain why it would benefit the project

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Write or update tests if applicable
5. Ensure the code follows the project's style
6. Commit with clear, descriptive messages
7. Push to your fork
8. Open a Pull Request

### Commit Message Guidelines

Use clear, descriptive commit messages:

```
feat: add face recognition clustering
fix: resolve thumbnail generation for HEIC files
docs: update installation instructions
refactor: improve database query performance
test: add unit tests for MetadataService
chore: update dependencies
```

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/PhotoCatalog.git
cd PhotoCatalog

# Install dependencies
npm install

# Rebuild native modules
npm run rebuild

# Start development server
npm run dev
```

## Project Structure

```
PhotoCatalog/
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.ts     # Main entry point
│   │   ├── preload.ts  # Preload script
│   │   └── services/   # Main process services
│   ├── renderer/       # React frontend
│   │   ├── components/ # UI components
│   │   ├── stores/     # State management
│   │   └── utils/      # Utilities
│   ├── services/       # Shared services
│   └── database/       # Database layer
├── public/             # Static assets
├── resources/          # App resources (icons)
└── native/             # Native C++ bindings
```

## Coding Standards

- Use TypeScript for all new code
- Follow existing code style and patterns
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions focused and small

## Testing

```bash
# Run tests
npm test

# Run linting
npm run lint
```

## Questions?

Feel free to open an issue for any questions about contributing.

Thank you for helping make PhotoCatalog better!
