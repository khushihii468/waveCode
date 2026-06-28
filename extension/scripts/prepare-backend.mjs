import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extensionDirectory = resolve(scriptDirectory, '..');
const repositoryDirectory = resolve(extensionDirectory, '..');
const vendorDirectory = resolve(extensionDirectory, 'vendor');
const backendSource = resolve(repositoryDirectory, 'backend');
const modelSource = resolve(repositoryDirectory, 'model');
const backendTarget = resolve(vendorDirectory, 'backend');
const modelTarget = resolve(vendorDirectory, 'model');

rmSync(vendorDirectory, { recursive: true, force: true });
mkdirSync(vendorDirectory, { recursive: true });

if (!existsSync(backendSource)) {
  throw new Error(`Backend directory not found: ${backendSource}`);
}

cpSync(backendSource, backendTarget, { recursive: true });
if (existsSync(modelSource)) {
  cpSync(modelSource, modelTarget, { recursive: true });
}

console.log('Prepared bundled backend in extension/vendor');

