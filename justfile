set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

# List recipes
default:
    @just --list

# Vendor PDF.js, generate fixtures, build: everything a fresh clone needs
setup:
    pnpm install
    pnpm prepare-pdfjs
    pnpm fixtures
    pnpm build

# Typecheck + lint + unit tests
check:
    pnpm check

# Headless VS Code integration tests
itest:
    pnpm build
    pnpm test:integration

# Bump the PDF.js pin: edit pdfjs.lock.json first, then run this
pdfjs-update:
    pnpm prepare-pdfjs --force
    pnpm build
